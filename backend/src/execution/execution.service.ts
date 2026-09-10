import {BadRequestException,ConflictException,GoneException,HttpException,Inject,Injectable,NotFoundException,ServiceUnavailableException,type OnModuleDestroy,type OnModuleInit} from '@nestjs/common';
import {AcademicService} from '../academic/academic.service';
import {CONFIG} from '../auth/auth.service';
import {RUNTIME_CATALOG,type RuntimeId,type RuntimeAvailability,type ExecutionRequest,type ExecutionRun} from '../../../packages/contracts/src/runtimes';
import {Judge0Adapter,type RunnerConfig} from './judge0.adapter';
import {DockerAdapter} from './docker.adapter';
import {isFrameworkRuntime,parseFrameworkProject} from '../../../packages/contracts/src/projects';
type Job=ExecutionRun & {attempt_id:string;provider_token:string|null;source_code:string;stdin:string};
const resultFields='id,question_id,runtime,answer_version,status,stdout,stderr,compile_output,message,time_seconds,memory_kb,created_at,finished_at';
const active="('QUEUED','DISPATCHING','PROCESSING')";

@Injectable()
export class ExecutionService implements OnModuleInit,OnModuleDestroy {
  private interval?:NodeJS.Timeout;private working?:Promise<void>;
  readonly adapter:Judge0Adapter|DockerAdapter;
  constructor(@Inject(AcademicService) private readonly academic:AcademicService,@Inject(CONFIG) readonly config:RunnerConfig){this.adapter=config.RUNNER_PROVIDER==='docker'?new DockerAdapter(config):new Judge0Adapter(config);}
  onModuleInit(){this.interval=setInterval(()=>{void this.tick().catch(()=>console.error(JSON.stringify({event:'execution_worker_failed'})));},1500);this.interval.unref();}
  async onModuleDestroy(){if(this.interval)clearInterval(this.interval);await this.working;}
  async runtimes(userId:string,u:string):Promise<{data:RuntimeAvailability[]}>{
    await this.academic.scope(userId,u,async()=>undefined);
    const discovery=await this.adapter.discover();
    return {data:RUNTIME_CATALOG.map(runtime=>{
      const provider=discovery.languages[runtime.id];
      return {...runtime,status:runtime.kind==='WEB_PREVIEW'?'WEB_PREVIEW':runtime.kind==='EDIT_ONLY'?'EDIT_ONLY':provider?'READY':'UNAVAILABLE',execution_available:!!provider,
        reason:runtime.kind==='WEB_PREVIEW'?'Aperçu local isolé de HTML, CSS et JavaScript.':runtime.kind==='EDIT_ONLY'?'Édition et remise disponibles ; aucune base SQL de test connectée.':provider?`Exécution isolée · ${provider.name}`:Object.keys(discovery.languages).length?`Le moteur ${runtime.label} n’est pas encore installé ou validé. L’édition et la remise restent disponibles.`:discovery.reason,
        ...(provider?{provider_language:provider.name}:{})};
    })};
  }
  async enqueue(userId:string,u:string,attemptId:string,questionId:string,input:ExecutionRequest):Promise<ExecutionRun>{
    // Read first under the actor's RLS scope; never reveal service state to an unrelated student.
    const authorized=await this.academic.scope(userId,u,async c=>{
      const attempt=(await c.query<{assessment_id:string;status:string;expired:boolean}>('select assessment_id,status,deadline<=clock_timestamp() expired from public.attempts where university_id=$1 and id=$2 and student_id=$3',[u,attemptId,userId])).rows[0];
      if(!attempt)throw new NotFoundException('Tentative introuvable pour ce compte.');
      const question=(await c.query<{runtime:RuntimeId;type:string}>('select runtime,type from public.assessment_questions where university_id=$1 and assessment_id=$2 and id=$3',[u,attempt.assessment_id,questionId])).rows[0];
      if(!question||question.type!=='CODE')throw new NotFoundException('Question de code introuvable dans cette tentative.');
      if(attempt.status!=='IN_PROGRESS'||attempt.expired)throw new GoneException('Cette tentative est terminée ; son code ne peut plus être exécuté.');
      return {assessmentId:attempt.assessment_id,runtime:question.runtime};
    });
    if(!(await this.adapter.discover()).languages[authorized.runtime])throw new ServiceUnavailableException('Ce langage ne dispose pas encore d’un runner isolé connecté. Vous pouvez enregistrer et remettre votre code.');
    if(input.expected_version===undefined)throw new BadRequestException('Enregistrez votre code et transmettez sa version avant de l’exécuter.');
    if(Buffer.byteLength(input.stdin)>4000)throw new BadRequestException('L’entrée standard dépasse 4 000 octets.');
    return this.academic.scope(userId,u,async c=>{
      // Serializes the per-student quota across all attempts and API replicas.
      await c.query('insert into private.execution_locks(university_id,student_id) values($1,$2) on conflict do nothing',[u,userId]);
      await c.query('select student_id from private.execution_locks where university_id=$1 and student_id=$2 for update',[u,userId]);
      const attempt=(await c.query<{status:string;expired:boolean}>('select status,deadline<=clock_timestamp() expired from public.attempts where university_id=$1 and id=$2 and student_id=$3 for update',[u,attemptId,userId])).rows[0];
      if(!attempt||attempt.status!=='IN_PROGRESS'||attempt.expired)throw new GoneException('Cette tentative est terminée.');
      const draft=(await c.query<{answer_text:string;version:number}>('select answer_text,version from public.answer_drafts where university_id=$1 and attempt_id=$2 and question_id=$3',[u,attemptId,questionId])).rows[0];
      if(!draft||draft.version!==input.expected_version)throw new ConflictException('Enregistrez la dernière version du code avant de l’exécuter.');
      if(!draft.answer_text.trim()||Buffer.byteLength(draft.answer_text)>30000)throw new BadRequestException('Le code doit contenir entre 1 et 30 000 octets.');
      if(isFrameworkRuntime(authorized.runtime)){try{parseFrameworkProject(draft.answer_text,authorized.runtime);}catch{throw new BadRequestException('Le projet ne correspond pas au framework de la question.');}}
      const pending=await c.query(`select id from private.execution_jobs where attempt_id=$1 and status in ${active}`,[attemptId]);
      if(pending.rows.length)throw new ConflictException('Une exécution est déjà en cours pour ce devoir.');
      const quota=(await c.query<{recent:number;daily:number}>(`select count(*) filter(where created_at>clock_timestamp()-interval '1 minute')::int recent,count(*)::int daily from private.execution_jobs where university_id=$1 and student_id=$2 and created_at>clock_timestamp()-interval '1 day'`,[u,userId])).rows[0];
      if(quota.recent>=6||quota.daily>=200)throw new HttpException('Quota d’exécution atteint. Réessayez plus tard.',429);
      return (await c.query<ExecutionRun>(`insert into private.execution_jobs(university_id,assessment_id,attempt_id,question_id,student_id,runtime,answer_version,source_code,stdin) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${resultFields}`,[u,authorized.assessmentId,attemptId,questionId,userId,authorized.runtime,draft.version,draft.answer_text,input.stdin])).rows[0];
    });
  }
  get(userId:string,u:string,attemptId:string,id:string):Promise<ExecutionRun>{
    return this.academic.scope(userId,u,async c=>{
      const row=(await c.query<ExecutionRun>(`select ${resultFields} from private.execution_jobs where university_id=$1 and attempt_id=$2 and id=$3 and student_id=$4`,[u,attemptId,id,userId])).rows[0];
      if(!row)throw new NotFoundException('Exécution introuvable pour ce compte.');
      return {...row,time_seconds:row.time_seconds===null?null:Number(row.time_seconds)};
    });
  }
  async preview(userId:string,u:string,attemptId:string,id:string):Promise<{html:string}>{
    // Resolve the private provider identifier only after checking the owner under RLS.
    const job=await this.academic.scope(userId,u,async c=>{
      const row=(await c.query<{runtime:RuntimeId;status:string;provider_token:string|null}>('select runtime,status,provider_token from private.execution_jobs where university_id=$1 and attempt_id=$2 and id=$3 and student_id=$4',[u,attemptId,id,userId])).rows[0];
      if(!row)throw new NotFoundException('Exécution introuvable pour ce compte.');
      return row;
    });
    if(!isFrameworkRuntime(job.runtime)||job.status!=='SUCCEEDED'||!job.provider_token)throw new NotFoundException('Aucun aperçu disponible pour cette exécution.');
    if(!(this.adapter instanceof DockerAdapter))throw new ServiceUnavailableException('Ce fournisseur ne fournit pas d’aperçu de projet.');
    try{return await this.adapter.preview(job.provider_token);}catch{throw new GoneException('Cet aperçu temporaire a expiré ou est indisponible. Exécutez à nouveau le projet.');}
  }
  tick():Promise<void>{
    if(this.working)return this.working;
    this.working=this.processBatch().finally(()=>{this.working=undefined;});return this.working;
  }
  private async processBatch(){
    const jobs=await this.academic.db.privileged(async c=>{
      // Never resubmit an ambiguous dispatch: the provider may already have accepted it.
      await c.query(`update private.execution_jobs set status='FAILED',message='Le délai d’exécution est dépassé. Vous pouvez réessayer.',source_code='',stdin='',finished_at=clock_timestamp(),updated_at=clock_timestamp() where status in ${active} and created_at<clock_timestamp()-(case when runtime='mysql' then interval '3 minutes' else interval '2 minutes' end)`);
      await c.query("update private.execution_jobs j set status='FAILED',message='Le devoir est terminé.',source_code='',stdin='',finished_at=clock_timestamp() from public.attempts t where t.id=j.attempt_id and j.status='QUEUED' and (t.status<>'IN_PROGRESS' or t.deadline<=clock_timestamp())");
      await c.query("delete from private.execution_jobs where finished_at<clock_timestamp()-interval '7 days'");
      const rows=await c.query<Job>(`select * from private.execution_jobs where (status='QUEUED' or (status='PROCESSING' and next_poll_at<=clock_timestamp())) order by created_at for update skip locked limit 4`);
      for(const job of rows.rows)await c.query("update private.execution_jobs set status=case when status='QUEUED' then 'DISPATCHING' else status end,next_poll_at=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp() where id=$1",[job.id]);
      return rows.rows;
    });
    await Promise.all(jobs.map(job=>this.processJob(job)));
  }
  private async processJob(job:Job){
    try{
      if(job.status==='QUEUED'){
        // Source and stdin exist only until the remote queue acknowledges acceptance.
        const token=await this.adapter.submit(job.runtime,job.source_code,job.stdin);
        await this.academic.db.privileged(c=>c.query("update private.execution_jobs set provider_token=$2,status='PROCESSING',source_code='',stdin='',next_poll_at=clock_timestamp()+interval '1 second',updated_at=clock_timestamp() where id=$1 and status='DISPATCHING'",[job.id,token]));
      }else if(job.provider_token){
        const result=await this.adapter.result(job.provider_token);
        await this.academic.db.privileged(c=>c.query(`update private.execution_jobs set status=$2,stdout=$3,stderr=$4,compile_output=$5,message=$6,time_seconds=$7,memory_kb=$8,
          finished_at=case when $2='PROCESSING' then null else clock_timestamp() end,next_poll_at=clock_timestamp()+interval '2 seconds',updated_at=clock_timestamp() where id=$1 and status='PROCESSING'`,[job.id,result.status,result.stdout,result.stderr,result.compile_output,result.message,result.time_seconds,result.memory_kb]));
      }
    }catch{
      await this.academic.db.privileged(c=>c.query(`update private.execution_jobs set status='FAILED',message='Le runner est indisponible. Le code enregistré est conservé.',source_code='',stdin='',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 and status in ${active}`,[job.id]));
    }
  }
}

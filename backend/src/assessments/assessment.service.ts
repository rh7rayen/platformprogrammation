import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { parseWebProject } from '../../../packages/contracts/src/runtimes';
import {isFrameworkRuntime,parseFrameworkProject} from '../../../packages/contracts/src/projects';
import { engineeringDemo } from '../database/seed-engineering';
import { createHash, randomBytes } from 'node:crypto';
import { AcademicService } from '../academic/academic.service';
import { CONFIG } from '../auth/auth.service';
import type { AppConfig } from '../config';
import type { SqlClient } from '../database/database';
import type { AssessmentInput, AssessmentSummary, AttemptData, ExamAccessCode, ExamQuestion } from '../../../packages/contracts/src';
type AssessmentRow=AssessmentSummary & {university_id:string;author_id:string;published_at:string|null};
type AttemptRow=AttemptData['attempt'] & {university_id:string};
export const normalizeCode=(code:string)=>code.replace(/[\s-]/g,'').toUpperCase();
export const accessCodeHash=(code:string)=>createHash('sha256').update(normalizeCode(code)).digest('hex');
const publicQuestionFields='id,position,type,title,statement,points,options,starter_code,runtime';

@Injectable()
export class AssessmentService implements OnModuleInit,OnModuleDestroy {
  private interval?:NodeJS.Timeout;
  private sweeping?:Promise<void>;
  constructor(@Inject(AcademicService) readonly academic:AcademicService,@Inject(CONFIG) private readonly config:AppConfig) {}
  onModuleInit(){this.interval=setInterval(()=>{void this.sweepExpired().catch(()=>console.error(JSON.stringify({event:'attempt_sweeper_failed'})));},5000);this.interval.unref();}
  async onModuleDestroy(){if(this.interval)clearInterval(this.interval);await this.sweeping;}
  sweepExpired():Promise<void>{
    if(this.sweeping)return this.sweeping;
    this.sweeping=this.academic.db.privileged(async c=>{
      const rows=await c.query<{id:string}>('select id from public.attempts where status=\'IN_PROGRESS\' and deadline<=clock_timestamp() order by deadline limit 100');
      for(const row of rows.rows) await c.query('select * from private.finalize_attempt($1,true)',[row.id]);
    }).finally(()=>{this.sweeping=undefined;});
    return this.sweeping;
  }
  private async managed(c:SqlClient,u:string,id:string,lock=false):Promise<AssessmentRow>{
    const result=await c.query<AssessmentRow>(`select * from public.assessments where university_id=$1 and id=$2 ${lock?'for update':''}`,[u,id]);
    if(!result.rows[0])throw new NotFoundException('Devoir introuvable.');
    const allowed=await c.query<{allowed:boolean}>('select private.manages_assessment($1,$2) allowed',[u,id]);
    if(!allowed.rows[0].allowed)throw new ForbiddenException('Ce devoir est réservé aux enseignants affectés.');
    return result.rows[0];
  }
  async list(userId:string,u:string){
    return this.academic.scope(userId,u,async c=>{
      const rows=await c.query<AssessmentSummary>(`select a.*,s.name subject_name,cl.name class_name,
        private.can_teach_offering(a.university_id,a.course_offering_id) can_manage,
        t.id attempt_id,t.status attempt_status,
        (not a.requires_code or k.redeemed_at is not null or t.id is not null) has_access,
        case when clock_timestamp()<a.opens_at then 'UPCOMING' when clock_timestamp()>=a.closes_at then 'CLOSED' else 'OPEN' end availability
        from public.assessments a join public.course_offerings o on o.id=a.course_offering_id
        join public.subjects s on s.id=o.subject_id join public.classes cl on cl.id=o.class_id
        left join public.attempts t on t.assessment_id=a.id and t.student_id=$2
        left join private.assessment_access_codes k on k.assessment_id=a.id and k.student_id=$2
        where a.university_id=$1 order by a.created_at desc,a.id limit 100`,[u,userId]);
      const offerings=await c.query(`select o.id,o.name,o.class_id,cl.name class_name,s.name subject_name from public.course_offerings o join public.classes cl on cl.id=o.class_id join public.subjects s on s.id=o.subject_id where o.university_id=$1 and private.can_teach_offering(o.university_id,o.id) order by cl.name,s.name`,[u]);
      return {data:rows.rows.map(row=>{const example=Object.entries(engineeringDemo.assessments).find(([,id])=>id===row.id)?.[0] as keyof typeof engineeringDemo.codes|undefined;return {...row,total_points:Number(row.total_points),...(this.config.APP_MODE==='demo'&&row.id==='80000000-0000-4000-8000-000000000001'&&userId==='20000000-0000-4000-8000-000000000003'?{demo_code:'PYTHON-DEMO'}:{}),...(this.config.APP_MODE==='demo'&&userId===engineeringDemo.student&&example?{demo_code:engineeringDemo.codes[example]}:{})};}),offerings:offerings.rows};
    });
  }
  private async writeQuestions(c:SqlClient,u:string,id:string,questions:AssessmentInput['questions']){
    for(const [position,q] of questions.entries()){
      const row=await c.query<{id:string}>('insert into public.assessment_questions(university_id,assessment_id,position,type,title,statement,points,options,starter_code,runtime) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id',[u,id,position,q.type,q.title,q.statement,q.points,JSON.stringify(q.options),q.starter_code,q.runtime]);
      await c.query('insert into private.assessment_solutions(question_id,university_id,assessment_id,expected_option_id) values($1,$2,$3,$4)',[row.rows[0].id,u,id,q.expected_option_id]);
    }
    await c.query('update public.assessments set question_count=$3,total_points=$4 where university_id=$1 and id=$2',[u,id,questions.length,questions.reduce((sum,q)=>sum+q.points,0)]);
  }
  create(userId:string,u:string,input:AssessmentInput){
    return this.academic.scope(userId,u,async c=>{
      const result=await c.query<{id:string}>('insert into public.assessments(university_id,author_id,course_offering_id,title,description,kind,opens_at,closes_at,duration_minutes,allow_paste,requires_code) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id',[u,userId,input.course_offering_id,input.title,input.description,input.kind,input.opens_at,input.closes_at,input.duration_minutes,input.allow_paste,input.requires_code]);
      await this.writeQuestions(c,u,result.rows[0].id,input.questions);
      return result.rows[0];
    });
  }
  update(userId:string,u:string,id:string,input:AssessmentInput){
    return this.academic.scope(userId,u,async c=>{
      const current=await this.managed(c,u,id,true);
      if(current.publication_status!=='DRAFT')throw new ConflictException('Un devoir publié ne peut plus être modifié.');
      await c.query('update public.assessments set course_offering_id=$3,title=$4,description=$5,kind=$6,opens_at=$7,closes_at=$8,duration_minutes=$9,allow_paste=$10,requires_code=$11 where university_id=$1 and id=$2',[u,id,input.course_offering_id,input.title,input.description,input.kind,input.opens_at,input.closes_at,input.duration_minutes,input.allow_paste,input.requires_code]);
      await c.query('delete from public.assessment_questions where university_id=$1 and assessment_id=$2',[u,id]);
      await this.writeQuestions(c,u,id,input.questions);
      return {id};
    });
  }
  details(userId:string,u:string,id:string){
    return this.academic.scope(userId,u,async c=>{
      const assessment=await this.managed(c,u,id);
      const questions=await c.query(`select q.*,s.expected_option_id from public.assessment_questions q join private.assessment_solutions s on s.question_id=q.id where q.university_id=$1 and q.assessment_id=$2 order by position`,[u,id]);
      return {...assessment,questions:questions.rows.map(q=>({...q,points:Number(q.points)}))};
    });
  }
  async publish(userId:string,u:string,id:string){
    return this.academic.scope(userId,u,async c=>{
      const assessment=await this.managed(c,u,id,true);
      if(assessment.publication_status==='PUBLISHED')return {id,published:true,already_published:true,access_codes:[],email_delivery:'NOT_SENT'};
      const questions=await c.query('select id from public.assessment_questions where university_id=$1 and assessment_id=$2',[u,id]);
      const clock=await c.query<{valid:boolean}>('select $1::timestamptz>clock_timestamp() valid',[assessment.closes_at]);
      if(!questions.rows.length||!clock.rows[0].valid)throw new BadRequestException('Ajoutez des questions et une fermeture dans le futur.');
      const students=await c.query<{id:string;full_name:string;email:string}>(`select distinct p.id,p.full_name,p.email from public.enrollments e
        join public.profiles p on p.id=e.student_id join public.university_memberships m on m.university_id=e.university_id and m.user_id=e.student_id
        join public.course_offerings o on o.class_id=e.class_id and o.university_id=e.university_id
        where e.university_id=$1 and o.id=$2 and e.ended_at is null and m.status='ACTIVE' order by p.full_name`,[u,assessment.course_offering_id]);
      if(!students.rows.length)throw new BadRequestException('Aucun étudiant actif inscrit dans la classe de cet enseignement.');
      const accessCodes:ExamAccessCode[]=[];
      for(const student of students.rows){
        const code=randomBytes(10).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-');
        await c.query('insert into public.assessment_assignments(university_id,assessment_id,student_id) values($1,$2,$3)',[u,id,student.id]);
        await c.query('insert into private.assessment_access_codes(university_id,assessment_id,student_id,code_hash) values($1,$2,$3,$4)',[u,id,student.id,accessCodeHash(code)]);
        accessCodes.push({student_id:student.id,student_name:student.full_name,email:student.email,code});
      }
      await c.query("update public.assessments set publication_status='PUBLISHED',published_at=clock_timestamp() where id=$1",[id]);
      return {id,published:true,already_published:false,access_codes:accessCodes,email_delivery:'NOT_SENT'};
    });
  }
  redeem(userId:string,u:string,code:string){
    return this.academic.scope(userId,u,async c=>{
      const result=await c.query<{assessment_id:string}>(`update private.assessment_access_codes k set redeemed_at=coalesce(k.redeemed_at,clock_timestamp())
        from public.assessments a where k.assessment_id=a.id and k.university_id=$1 and k.student_id=$2 and k.code_hash=$3
        and a.publication_status='PUBLISHED' and a.closes_at>clock_timestamp() returning k.assessment_id`,[u,userId,accessCodeHash(code)]);
      if(!result.rows[0])throw new BadRequestException('Code invalide, expiré ou réservé à un autre compte.');
      return result.rows[0];
    });
  }
  start(userId:string,u:string,id:string){
    return this.academic.scope(userId,u,async c=>{
      const assigned=await c.query('select id from public.assessment_assignments where university_id=$1 and assessment_id=$2 and student_id=$3 for update',[u,id,userId]);
      if(!assigned.rows.length)throw new ForbiddenException('Vous ne faites pas partie des destinataires de ce devoir.');
      const existing=await c.query<{id:string}>('select id from public.attempts where university_id=$1 and assessment_id=$2 and student_id=$3',[u,id,userId]);
      if(existing.rows[0])return (await c.query<AttemptRow>('select * from private.finalize_attempt($1,true)',[existing.rows[0].id])).rows[0];
      const assessment=(await c.query<AssessmentRow&{is_open:boolean;has_access:boolean}>(`select a.*,a.opens_at<=clock_timestamp() and clock_timestamp()<a.closes_at is_open,
        (not a.requires_code or exists(select 1 from private.assessment_access_codes k where k.assessment_id=a.id and k.student_id=$3 and k.redeemed_at is not null)) has_access
        from public.assessments a where a.university_id=$1 and a.id=$2`,[u,id,userId])).rows[0];
      if(!assessment||assessment.publication_status!=='PUBLISHED'||!assessment.is_open)throw new ConflictException('Ce devoir n’est pas ouvert actuellement.');
      if(!assessment.has_access)throw new ForbiddenException('Saisissez votre code personnel avant de commencer.');
      const result=await c.query<AttemptRow>(`insert into public.attempts(university_id,assessment_id,student_id,started_at,deadline)
        select $1,$2,$3,clock_timestamp(),least(closes_at,clock_timestamp()+make_interval(mins=>duration_minutes)) from public.assessments where id=$2 returning *`,[u,id,userId]);
      return result.rows[0];
    });
  }
  private async own(c:SqlClient,u:string,userId:string,id:string,lock=false){
    const result=await c.query<AttemptRow>(`select * from public.attempts where university_id=$1 and id=$2 and student_id=$3 ${lock?'for update':''}`,[u,id,userId]);
    if(!result.rows[0])throw new NotFoundException('Tentative introuvable pour ce compte.');
    return result.rows[0];
  }
  attempt(userId:string,u:string,id:string):Promise<AttemptData>{
    return this.academic.scope(userId,u,async c=>{
      await this.own(c,u,userId,id);
      const attempt=(await c.query<AttemptRow>('select * from private.finalize_attempt($1,true)',[id])).rows[0];
      const assessment=(await c.query<AttemptData['assessment']>('select id,title,description,allow_paste,duration_minutes,kind from public.assessments where id=$1',[attempt.assessment_id])).rows[0];
      const questions=await c.query<ExamQuestion>(`select ${publicQuestionFields} from public.assessment_questions where university_id=$1 and assessment_id=$2 order by position`,[u,attempt.assessment_id]);
      const answers=await c.query<AttemptData['answers'][number]>('select question_id,answer_text,version,saved_at from public.answer_drafts where university_id=$1 and attempt_id=$2',[u,id]);
      const results=await c.query<{question_id:string;score:string;max_points:string;feedback:string}>('select a.question_id,a.score,a.max_points,a.feedback from public.submission_answers a join public.submissions s on s.id=a.submission_id where s.attempt_id=$1',[id]);
      const time=await c.query<{server_time:string}>('select clock_timestamp() server_time');
      return {attempt,assessment,questions:questions.rows.map(q=>({...q,points:Number(q.points)})),answers:answers.rows,server_time:time.rows[0].server_time,
        results:results.rows.length?{total_score:results.rows.reduce((sum,r)=>sum+Number(r.score),0),total_points:results.rows.reduce((sum,r)=>sum+Number(r.max_points),0),answers:results.rows.map(r=>({question_id:r.question_id,score:Number(r.score),feedback:r.feedback}))}:null};
    });
  }
  async save(userId:string,u:string,id:string,questionId:string,answerText:string,expectedVersion:number){
    const result=await this.academic.scope(userId,u,async c=>{
      const attempt=await this.own(c,u,userId,id,true);
      const check=await c.query<{expired:boolean}>('select clock_timestamp()>=$1::timestamptz expired',[attempt.deadline]);
      if(attempt.status!=='IN_PROGRESS'||check.rows[0].expired){await c.query('select * from private.finalize_attempt($1,true)',[id]);return {closed:true as const};}
      const question=(await c.query<{type:string;runtime:string;options:{id:string}[]}>('select type,runtime,options from public.assessment_questions where university_id=$1 and assessment_id=$2 and id=$3',[u,attempt.assessment_id,questionId])).rows[0];
      if(!question)throw new NotFoundException('Question étrangère à cette tentative.');
      if(question.type==='CODE'&&Buffer.byteLength(answerText)>30000)throw new BadRequestException('Le code ou projet dépasse 30 000 octets.');
      if(question.runtime==='web'&&answerText!==''){try{parseWebProject(answerText);}catch{throw new BadRequestException('Projet Web invalide : seuls index.html, style.css et script.js sont acceptés.');}}
      if(isFrameworkRuntime(question.runtime)&&answerText!==''){try{parseFrameworkProject(answerText,question.runtime);}catch{throw new BadRequestException('Projet invalide : les fichiers et le framework doivent correspondre à la question.');}}
      if(question.type==='SINGLE_CHOICE'&&answerText!==''&&!question.options.some(o=>o.id===answerText))throw new BadRequestException('Choix de réponse invalide.');
      const current=await c.query<{version:number}>('select version from public.answer_drafts where attempt_id=$1 and question_id=$2',[id,questionId]);
      if((current.rows[0]?.version??0)!==expectedVersion)throw new ConflictException('Une version plus récente existe sur le serveur. Rechargez-la avant de poursuivre.');
      const saved=await c.query<{version:number;saved_at:string}>(`insert into public.answer_drafts(university_id,assessment_id,attempt_id,question_id,answer_text,version) values($1,$2,$3,$4,$5,1)
        on conflict(attempt_id,question_id) do update set answer_text=excluded.answer_text,version=answer_drafts.version+1,saved_at=clock_timestamp() returning version,saved_at`,[u,attempt.assessment_id,id,questionId,answerText]);
      return {closed:false as const,...saved.rows[0]};
    });
    if(result.closed)throw new GoneException('Le devoir est terminé. Seule la dernière réponse enregistrée a été conservée.');
    return result;
  }
  finalize(userId:string,u:string,id:string){return this.academic.scope(userId,u,async c=>{await this.own(c,u,userId,id);return (await c.query<AttemptRow>('select * from private.finalize_attempt($1,false)',[id])).rows[0];});}
  submissions(userId:string,u:string,id:string){return this.academic.scope(userId,u,async c=>{
    const assessment=await this.managed(c,u,id);
    const rows=await c.query(`select s.id,s.attempt_id,s.student_id,coalesce(p.full_name,'Étudiant (profil non visible)') student_name,s.submitted_at,t.status,
      coalesce(sum(a.score),0) total_score,sum(a.max_points) total_points,count(*) filter(where a.score is null)::int pending_count
      from public.submissions s join public.attempts t on t.id=s.attempt_id left join public.profiles p on p.id=s.student_id
      join public.submission_answers a on a.submission_id=s.id where s.university_id=$1 and s.assessment_id=$2
      group by s.id,p.full_name,t.status order by s.submitted_at desc`,[u,id]);
    return {assessment,data:rows.rows.map(r=>({...r,total_score:Number(r.total_score),total_points:Number(r.total_points)}))};
  });}
  submission(userId:string,u:string,id:string,submissionId:string){return this.academic.scope(userId,u,async c=>{
    await this.managed(c,u,id);
    const result=await c.query('select * from public.submission_answers where university_id=$1 and assessment_id=$2 and submission_id=$3 order by (question->>\'position\')::int',[u,id,submissionId]);
    if(!result.rows.length)throw new NotFoundException('Copie introuvable.');
    return {answers:result.rows.map(r=>({...r,score:r.score===null?null:Number(r.score),max_points:Number(r.max_points)}))};
  });}
  grade(userId:string,u:string,id:string,submissionId:string,input:{question_id:string;score:number;feedback:string;expected_version:number}){return this.academic.scope(userId,u,async c=>{
    const assessment=await this.managed(c,u,id,true);
    if(assessment.results_published_at)throw new ConflictException('Les résultats ont été publiés. Cette version ne permet pas de les modifier ensuite.');
    const answer=(await c.query<{score:number|null;max_points:number;grade_version:number}>('select score,max_points,grade_version from public.submission_answers where university_id=$1 and assessment_id=$2 and submission_id=$3 and question_id=$4 for update',[u,id,submissionId,input.question_id])).rows[0];
    if(!answer)throw new NotFoundException('Réponse introuvable.');
    if(input.score>Number(answer.max_points))throw new BadRequestException('La note dépasse le barème de la question.');
    if(input.expected_version!==answer.grade_version)throw new ConflictException('Une autre correction a été enregistrée. Rechargez la copie.');
    await c.query('insert into public.grade_adjustments(university_id,assessment_id,submission_id,question_id,actor_id,old_score,new_score,reason) values($1,$2,$3,$4,$5,$6,$7,$8)',[u,id,submissionId,input.question_id,userId,answer.score,input.score,input.feedback]);
    const result=await c.query('update public.submission_answers set score=$1,feedback=$2,grade_version=grade_version+1 where submission_id=$3 and question_id=$4 returning question_id,score,feedback,grade_version',[input.score,input.feedback,submissionId,input.question_id]);
    return result.rows[0];
  });}
  publishResults(userId:string,u:string,id:string){return this.academic.scope(userId,u,async c=>{
    const assessment=await this.managed(c,u,id,true);
    if(assessment.results_published_at)return {published:true};
    const validation=await c.query<{closed:boolean;pending:number;submitted:number}>(`select $2::timestamptz<=clock_timestamp() closed,
      (select count(*) from public.submission_answers where assessment_id=$1 and score is null)::int+(select count(*) from public.attempts where assessment_id=$1 and status='IN_PROGRESS')::int pending,
      (select count(*) from public.submissions where assessment_id=$1)::int submitted`,[id,assessment.closes_at]);
    if(!validation.rows[0].closed||validation.rows[0].pending||!validation.rows[0].submitted)throw new ConflictException('Fermez la période du devoir et terminez toutes les corrections avant de publier les résultats.');
    await c.query('update public.assessments set results_published_at=clock_timestamp() where id=$1',[id]);return {published:true};
  });}
}

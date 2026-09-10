import {BadRequestException,ForbiddenException,HttpException,Inject,Injectable,ServiceUnavailableException,type OnModuleDestroy,type OnModuleInit} from '@nestjs/common';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {AcademicService} from '../academic/academic.service';
import {CONFIG} from '../auth/auth.service';
import type {AppConfig} from '../config';
import type {SqlClient} from '../database/database';
import {accessCodeHash} from '../assessments/assessment.service';
type MailPayload={from:string;to:string[];subject:string;text:string};
type Job={id:string;university_id:string;assessment_id:string;encrypted_payload:string;attempt_count:number};
export function sealMail(payload:MailPayload,key:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'base64'),iv);return [iv.toString('base64'),Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]).toString('base64'),cipher.getAuthTag().toString('base64')].join('.');}
export function openMail(value:string,key:string):MailPayload{const [iv,body,tag]=value.split('.'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64'),Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,'base64')),decipher.final()]).toString('utf8'));}
@Injectable()
export class InvitationService implements OnModuleInit,OnModuleDestroy {
  private timer?:NodeJS.Timeout;private working?:Promise<void>;
  constructor(@Inject(AcademicService) readonly academic:AcademicService,@Inject(CONFIG) readonly config:AppConfig){}
  available(){return this.config.EMAIL_ENABLED==='true'&&this.config.RESEND_API_KEY.length>10&&/^[^\r\n]+@[^\r\n]+$/.test(this.config.EMAIL_FROM)&&Buffer.from(this.config.EMAIL_ENCRYPTION_KEY,'base64').length===32&&this.config.WEB_ORIGIN.startsWith('https://');}
  onModuleInit(){if(this.available()){this.timer=setInterval(()=>void this.drain().catch(()=>console.error(JSON.stringify({event:'mail_worker_failed'}))),5000);this.timer.unref();}}
  async onModuleDestroy(){clearInterval(this.timer);await this.working;}
  private async managed(c:SqlClient,u:string,id:string){const check=await c.query<{allowed:boolean}>('select private.manages_assessment($1,$2) allowed',[u,id]);if(!check.rows[0].allowed)throw new ForbiddenException('Seul un enseignant affecté peut gérer ces invitations.');}
  recipients(userId:string,u:string,id:string){return this.academic.scope(userId,u,async c=>{
    await this.managed(c,u,id);
    const rows=await c.query(`select a.student_id,p.full_name,p.email,t.id attempt_id,m.id email_job_id,m.status email_status,m.sent_at,m.last_error,
      greatest(0,3-retries.count)::int retry_remaining,
      coalesce(m.status in ('FAILED','EXPIRED') and t.id is null and retries.count<3 and e.closes_at>clock_timestamp() and member.status='ACTIVE',false) can_retry
      from public.assessment_assignments a join public.profiles p on p.id=a.student_id
      join public.assessments e on e.id=a.assessment_id
      join public.university_memberships member on member.university_id=a.university_id and member.user_id=a.student_id
      left join public.attempts t on t.assessment_id=a.assessment_id and t.student_id=a.student_id
      left join lateral(select j.id,j.status,j.sent_at,j.last_error from private.exam_mail_jobs j where j.assessment_id=a.assessment_id and j.student_id=a.student_id order by j.created_at desc,j.id desc limit 1) m on true
      left join lateral(select count(*)::int count from private.exam_mail_jobs j where j.assessment_id=a.assessment_id and j.student_id=a.student_id and j.is_reissue and j.created_at>clock_timestamp()-interval '24 hours') retries on true
      where a.university_id=$1 and a.assessment_id=$2 order by p.full_name limit 200`,[u,id]);
    return {data:rows.rows,email_available:this.available(),message:this.available()?'Envoi disponible. SENT indique l’acceptation par le fournisseur, pas la lecture.':'Configurer un domaine email vérifié, une clé Resend, une clé de chiffrement et une adresse HTTPS publique pour envoyer.'};
  });}
  queue(userId:string,u:string,id:string,emails:string[],retryFailed=false){return this.academic.scope(userId,u,async c=>{
    await this.managed(c,u,id);
    if(!this.available())throw new ServiceUnavailableException('L’envoi d’emails n’est pas configuré. Aucun message n’a été envoyé.');
    const exam=(await c.query<{title:string;closes_at:string;duration_minutes:number}>('select title,closes_at,duration_minutes from public.assessments where id=$1 and publication_status=\'PUBLISHED\' and closes_at>clock_timestamp() for update',[id])).rows[0];
    if(!exam)throw new BadRequestException('Publiez un devoir dont la période n’est pas terminée.');
    const recipients=await c.query<{student_id:string;full_name:string;email:string}>(`select a.student_id,p.full_name,p.email from public.assessment_assignments a join public.profiles p on p.id=a.student_id join public.university_memberships m on m.university_id=a.university_id and m.user_id=a.student_id where a.university_id=$1 and a.assessment_id=$2 and m.status='ACTIVE' and lower(p.email)=any($3::text[])`,[u,id,emails.map(e=>e.toLowerCase())]);
    if(recipients.rows.length!==new Set(emails.map(e=>e.toLowerCase())).size)throw new BadRequestException('Une adresse ne correspond pas à un étudiant actif destinataire de ce devoir.');
    let queued=0,skipped=0,reissued=0;
    for(const person of recipients.rows){
      if((await c.query('select id from public.attempts where assessment_id=$1 and student_id=$2',[id,person.student_id])).rows.length){skipped++;continue;}
      const previous=(await c.query<{id:string;status:string}>('select id,status from private.exam_mail_jobs where assessment_id=$1 and student_id=$2 order by created_at desc,id desc limit 1',[id,person.student_id])).rows[0];
      // A retry is an explicit new teacher action, never an automatic code rotation.
      if((previous&&(!retryFailed||!['FAILED','EXPIRED'].includes(previous.status)))||(!previous&&retryFailed)){skipped++;continue;}
      if(previous){
        const quota=(await c.query<{count:number}>("select count(*)::int count from private.exam_mail_jobs where assessment_id=$1 and student_id=$2 and is_reissue and created_at>clock_timestamp()-interval '24 hours'",[id,person.student_id])).rows[0].count;
        if(quota>=3)throw new HttpException('Trois réémissions ont déjà été demandées en 24 heures pour un destinataire. Réessayez après ce délai.',429);
      }
      const code=randomBytes(10).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-');
      const payload:MailPayload={from:this.config.EMAIL_FROM,to:[person.email],subject:`Votre devoir : ${exam.title}`,text:`Bonjour ${person.full_name},\n\nVotre devoir « ${exam.title} » est disponible sur UniExam.\nConnectez-vous avec votre compte étudiant : ${this.config.WEB_ORIGIN}/?view=exams\nCode personnel : ${code}\nDurée : ${exam.duration_minutes} minutes. Fermeture : ${new Date(exam.closes_at).toISOString()}.\n\nLe temps démarre lorsque vous confirmez le début du devoir. Ce code remplace le code communiqué avant cet envoi. Ne le partagez pas.\nVotre enseignant`};
      await c.query('update private.assessment_access_codes set code_hash=$3,redeemed_at=null where assessment_id=$1 and student_id=$2',[id,person.student_id,accessCodeHash(code)]);
      await c.query('insert into private.exam_mail_jobs(university_id,assessment_id,student_id,requested_by,encrypted_payload,is_reissue) values($1,$2,$3,$4,$5,$6)',[u,id,person.student_id,userId,sealMail(payload,this.config.EMAIL_ENCRYPTION_KEY),!!previous]);queued++;if(previous)reissued++;
    }
    return {queued,reissued,skipped,status:queued?'QUEUED':'UNCHANGED',message:queued?'Messages placés en file. Consultez leur état de livraison.':'Aucun nouvel envoi : les invitations sélectionnées sont déjà traitées, en cours, ou les étudiants ont commencé.'};
  });}
  drain():Promise<void>{if(this.working)return this.working;if(!this.available())return Promise.resolve();this.working=this.processBatch().finally(()=>{this.working=undefined;});return this.working;}
  private async processBatch(){
    const jobs=await this.academic.db.privileged(async c=>{
      await c.query("update private.exam_mail_jobs set status='EXPIRED',encrypted_payload=null,last_error='Période d’envoi dépassée' where status in ('QUEUED','SENDING') and (created_at<clock_timestamp()-interval '12 hours' or exists(select 1 from public.assessments a where a.id=assessment_id and a.closes_at<=clock_timestamp()))");
      const rows=await c.query<Job>("select id,university_id,assessment_id,encrypted_payload,attempt_count from private.exam_mail_jobs where status in ('QUEUED','SENDING') and next_attempt_at<=clock_timestamp() and attempt_count<5 order by created_at limit 5 for update skip locked");
      for(const row of rows.rows)await c.query("update private.exam_mail_jobs set status='SENDING',attempt_count=attempt_count+1,next_attempt_at=clock_timestamp()+interval '1 minute' where id=$1",[row.id]);
      return rows.rows;
    });
    // Five parallel requests finish within the 60s claim lease (15s each).
    // Serial dispatch could exceed the lease and let a replica reclaim a job.
    await Promise.all(jobs.map(async job=>{
      try{
        const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.config.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`exam-invitation/${job.id}`},body:JSON.stringify(openMail(job.encrypted_payload,this.config.EMAIL_ENCRYPTION_KEY)),signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error(`Fournisseur email : HTTP ${response.status}`);
        const result=await response.json() as {id?:string};if(!result.id)throw new Error('Réponse fournisseur incomplète');
        await this.academic.db.privileged(c=>c.query("update private.exam_mail_jobs set status='SENT',sent_at=clock_timestamp(),provider_id=$2,encrypted_payload=null,last_error=null where id=$1 and status='SENDING' and attempt_count=$3",[job.id,result.id,job.attempt_count+1]));
      }catch(e){const final=job.attempt_count>=4;await this.academic.db.privileged(c=>c.query('update private.exam_mail_jobs set status=$2,last_error=$3,encrypted_payload=case when $4 then null else encrypted_payload end,next_attempt_at=clock_timestamp()+interval \'1 minute\' where id=$1 and status=\'SENDING\' and attempt_count=$5',[job.id,final?'FAILED':'QUEUED',e instanceof Error&&e.message.startsWith('Fournisseur email')?e.message:'Envoi non confirmé ; vérification ou nouvel essai nécessaire',final,job.attempt_count+1]));}
    }));
  }
}

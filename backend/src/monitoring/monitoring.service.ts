import { BadRequestException, ConflictException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AcademicService } from '../academic/academic.service';
import type { SqlClient } from '../database/database';
import { MAX_RECORDING_CHUNK_BYTES, RecordingStorage } from './recording-storage';

type Attempt={id:string;assessment_id:string;status:string;deadline:string;submitted_at:string|null};
type Session={id:string;status:string;lease_until:string;expires_at:string};
type Chunk={id:string;session_id:string;sequence:number;object_path:string;size_bytes:number;mime_type:string;status:string;created_at:string};
export type ChunkInput={sequence:number;size_bytes:number;mime_type:'video/webm'|'video/mp4'};
const MAX_ATTEMPT_BYTES=512*1024*1024;

@Injectable()
export class MonitoringService {
  constructor(@Inject(AcademicService) private readonly academic:AcademicService,@Inject(RecordingStorage) private readonly storage:RecordingStorage){}
  private async own(c:SqlClient,u:string,t:string,userId:string,lock=false){
    const row=(await c.query<Attempt>(`select id,assessment_id,status,deadline,submitted_at from public.attempts where university_id=$1 and id=$2 and student_id=$3 ${lock?'for update':''}`,[u,t,userId])).rows[0];
    if(!row)throw new NotFoundException('Tentative introuvable.');
    return row;
  }
  private async review(c:SqlClient,u:string,t:string){
    const row=(await c.query<{allowed:boolean}>('select private.may_review_recording($1,$2) allowed',[u,t])).rows[0];
    if(!row.allowed)throw new NotFoundException('Enregistrement introuvable ou non accessible.');
  }
  private async session(c:SqlClient,u:string,t:string,id:string){
    const row=(await c.query<Session>('select * from public.recording_sessions where university_id=$1 and attempt_id=$2 and id=$3 for update',[u,t,id])).rows[0];
    if(!row)throw new NotFoundException('Session vidéo introuvable.');
    return row;
  }
  async status(userId:string,u:string,t:string){
    const sessions=await this.academic.scope(userId,u,async c=>{
      await this.own(c,u,t,userId);
      return (await c.query('select id,status,started_at,stopped_at,lease_until,expires_at from public.recording_sessions where university_id=$1 and attempt_id=$2 order by started_at desc',[u,t])).rows;
    });
    let state='NOT_CONFIGURED',message='Le stockage vidéo privé n’est pas configuré.';
    if(this.storage.configured){try{await this.storage.ready();state='READY';message='Les vidéos sont transférées vers un stockage privé.';}catch{state='UNAVAILABLE';message='Le stockage vidéo est temporairement indisponible.';}}
    return {state,message,sessions,max_chunk_bytes:MAX_RECORDING_CHUNK_BYTES,retention_days:this.storage.retentionDays,segment_seconds:15,consent_version:'screen-v1'};
  }
  async start(userId:string,u:string,t:string){
    // Authorize before contacting cloud storage or revealing its configuration.
    await this.academic.scope(userId,u,c=>this.own(c,u,t,userId));
    await this.storage.ready();
    return this.academic.scope(userId,u,async c=>{
      const attempt=await this.own(c,u,t,userId,true);
      if(attempt.status!=='IN_PROGRESS'||Date.parse(attempt.deadline)<=Date.now())throw new GoneException('La tentative est terminée.');
      await c.query("update public.recording_sessions set status='INTERRUPTED',stopped_at=clock_timestamp() where university_id=$1 and attempt_id=$2 and status='RECORDING' and lease_until<=clock_timestamp()",[u,t]);
      const sessions=(await c.query<Session>('select id,status from public.recording_sessions where university_id=$1 and attempt_id=$2',[u,t])).rows;
      if(sessions.some(s=>s.status==='RECORDING'))throw new ConflictException('Un enregistrement est déjà actif. Arrêtez-le ou attendez une minute après une interruption.');
      if(sessions.length>=4)throw new ConflictException('La limite de quatre sessions vidéo pour cette tentative est atteinte.');
      return (await c.query("insert into public.recording_sessions(university_id,assessment_id,attempt_id,student_id,consent_version,expires_at) values($1,$2,$3,$4,'screen-v1',clock_timestamp()+$5::int*interval '1 day') returning id,status,started_at,expires_at",[u,attempt.assessment_id,t,userId,this.storage.retentionDays])).rows[0];
    });
  }
  async reserve(userId:string,u:string,t:string,s:string,input:ChunkInput){
    const chunk=await this.academic.scope(userId,u,async c=>{
      const attempt=await this.own(c,u,t,userId,true),session=await this.session(c,u,t,s);
      if(session.status!=='RECORDING'||Date.parse(session.lease_until)<=Date.now())throw new GoneException('La session vidéo est terminée ou interrompue.');
      const old=(await c.query<Chunk>('select * from public.recording_chunks where session_id=$1 and sequence=$2',[s,input.sequence])).rows[0];
      if(old){if(old.size_bytes!==input.size_bytes||old.mime_type!==input.mime_type)throw new ConflictException('Le numéro de segment est déjà utilisé.');return old;}
      const end=Math.min(Date.parse(attempt.deadline),attempt.submitted_at?Date.parse(attempt.submitted_at):Infinity);
      if(Date.now()>=end){
        const finalCount=(await c.query<{count:string}>('select count(*) count from public.recording_chunks where session_id=$1 and created_at >= $2::timestamptz',[s,new Date(end).toISOString()])).rows[0];
        if(Date.now()>end+120000||Number(finalCount.count)>=1)throw new GoneException('Seul le dernier segment peut être transféré après la fin de la tentative.');
      }
      const stats=(await c.query<{bytes:string;count:string;pending:string}>('select coalesce(sum(size_bytes),0) bytes,count(*) count,count(*) filter(where status=\'PENDING\') pending from public.recording_chunks where university_id=$1 and attempt_id=$2',[u,t])).rows[0];
      const sequence=(await c.query<{next:number}>('select coalesce(max(sequence)+1,0) next from public.recording_chunks where session_id=$1',[s])).rows[0].next;
      if(input.sequence!==sequence)throw new ConflictException('L’ordre des segments est incorrect.');
      if(Number(stats.pending)>1)throw new ConflictException('Terminez les transferts en attente avant de continuer.');
      if(Number(stats.bytes)+input.size_bytes>MAX_ATTEMPT_BYTES||Number(stats.count)>=2000)throw new ConflictException('Le quota vidéo de cette tentative est atteint.');
      const id=randomUUID(),path=`${u}/${t}/${s}/${id}.${input.mime_type==='video/mp4'?'mp4':'webm'}`;
      await c.query("update public.recording_sessions set lease_until=clock_timestamp()+interval '60 seconds' where id=$1",[s]);
      return (await c.query<Chunk>('insert into public.recording_chunks(id,university_id,attempt_id,session_id,sequence,object_path,size_bytes,mime_type) values($1,$2,$3,$4,$5,$6,$7,$8) returning *',[id,u,t,s,input.sequence,path,input.size_bytes,input.mime_type])).rows[0];
    });
    return {id:chunk.id,sequence:chunk.sequence,status:chunk.status,...(chunk.status==='PENDING'?{upload_url:await this.storage.uploadUrl(chunk.object_path),method:'PUT',headers:{'Content-Type':chunk.mime_type,'x-upsert':'false'}}:{})};
  }
  async complete(userId:string,u:string,t:string,s:string,id:string){
    const chunk=await this.academic.scope(userId,u,async c=>{
      await this.own(c,u,t,userId);
      const row=(await c.query<Chunk>('select * from public.recording_chunks where university_id=$1 and attempt_id=$2 and session_id=$3 and id=$4',[u,t,s,id])).rows[0];
      if(!row)throw new NotFoundException('Segment introuvable.');
      if(row.status==='DELETED'||(row.status!=='READY'&&Date.now()-Date.parse(row.created_at)>120000))throw new GoneException('Le délai de confirmation du segment est dépassé.');
      return row;
    });
    if(chunk.status==='READY')return {id,status:'READY'};
    const info=await this.storage.info(chunk.object_path);
    if(info.size!==chunk.size_bytes||info.mimeType!==chunk.mime_type)throw new BadRequestException('La taille ou le format reçu ne correspond pas au segment annoncé.');
    return this.academic.scope(userId,u,async c=>{
      await this.own(c,u,t,userId);
      await this.session(c,u,t,s);
      const updated=await c.query("update public.recording_chunks set status='READY',completed_at=clock_timestamp() where university_id=$1 and attempt_id=$2 and session_id=$3 and id=$4 and status='PENDING' and created_at>clock_timestamp()-interval '2 minutes' returning id,status",[u,t,s,id]);
      if(updated.rows[0])return updated.rows[0];
      const current=(await c.query<{status:string}>('select status from public.recording_chunks where id=$1',[id])).rows[0];
      if(current?.status==='READY')return {id,status:'READY'};
      throw new GoneException('Le délai de confirmation du segment est dépassé.');
    });
  }
  stop(userId:string,u:string,t:string,s:string){return this.academic.scope(userId,u,async c=>{
    await this.own(c,u,t,userId,true);await this.session(c,u,t,s);
    await c.query("update public.recording_sessions set status='STOPPED',stopped_at=clock_timestamp() where id=$1 and status='RECORDING'",[s]);
    return {id:s,status:'STOPPED'};
  });}
  list(userId:string,u:string,t:string){return this.academic.scope(userId,u,async c=>{
    await this.review(c,u,t);
    const data=(await c.query(`select s.id,s.status,s.started_at,s.stopped_at,s.lease_until,s.expires_at,
      coalesce(jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'size_bytes',c.size_bytes,'mime_type',c.mime_type,'status',c.status,'created_at',c.created_at) order by c.sequence) filter(where c.id is not null),'[]') chunks
      from public.recording_sessions s left join public.recording_chunks c on c.session_id=s.id
      where s.university_id=$1 and s.attempt_id=$2 group by s.id order by s.started_at`,[u,t])).rows;
    return {data,configured:this.storage.configured,notice:'Le partage choisi et les interruptions sont visibles. Une vidéo ne permet pas, à elle seule, de conclure à une fraude ou à un usage d’IA.'};
  });}
  async play(userId:string,u:string,t:string,id:string){
    const chunk=await this.academic.scope(userId,u,async c=>{
      await this.review(c,u,t);
      const row=(await c.query<Chunk>("select c.* from public.recording_chunks c join public.recording_sessions s on s.id=c.session_id where c.university_id=$1 and c.attempt_id=$2 and c.id=$3 and c.status='READY' and s.expires_at>clock_timestamp()",[u,t,id])).rows[0];
      if(!row)throw new NotFoundException('Segment indisponible ou arrivé à expiration.');return row;
    });
    return {url:await this.storage.playUrl(chunk.object_path),expires_in:120};
  }
  // Invoked by the maintenance CLI / scheduled worker, never by a browser request.
  async purgeExpired(){
    if(!this.storage.configured)return {deleted:0,state:'NOT_CONFIGURED'};
    const rows=await this.academic.db.privileged(c=>c.query<{id:string;object_path:string}>("select c.id,c.object_path from public.recording_chunks c join public.recording_sessions s on s.id=c.session_id where c.status<>'DELETED' and (s.expires_at<=clock_timestamp() or (c.status='PENDING' and c.created_at<clock_timestamp()-interval '3 hours')) order by c.created_at limit 100"));
    await this.storage.remove(rows.rows.map(r=>r.object_path));
    if(rows.rows.length)await this.academic.db.privileged(c=>c.query("update public.recording_chunks set status='DELETED' where id=any($1::uuid[])",[rows.rows.map(r=>r.id)]));
    return {deleted:rows.rows.length,state:'OK'};
  }
}

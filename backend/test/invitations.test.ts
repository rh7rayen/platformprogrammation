import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {createApp} from '../src/app';
import {loadConfig,type AppConfig} from '../src/config';
import {demoIds as ids} from '../src/database/seed';
import {seedEngineering} from '../src/database/seed-engineering';
import {AcademicService} from '../src/academic/academic.service';
import {AssessmentService,accessCodeHash} from '../src/assessments/assessment.service';
import {InvitationService,openMail,sealMail} from '../src/invitations/invitation.service';
import {assessmentSchema} from '../../packages/contracts/src/assessments';
let runtime:Awaited<ReturnType<typeof createApp>>,academic:AcademicService,exams:AssessmentService,mail:InvitationService,config:AppConfig,base:string;
const tokens:Record<string,string>={},key=randomBytes(32).toString('base64');
const rejectsStatus=(status:number)=>(error:unknown)=>error instanceof HttpException&&error.getStatus()===status;
before(async()=>{
  // Automatic workers remain disabled. Every provider call below uses an explicit
  // fetch contract stub which has no network fallback. No email is really sent.
  const appConfig=loadConfig({APP_MODE:'demo',NODE_ENV:'test',EMAIL_ENABLED:'false',RUNNER_ENABLED:'false',AI_ENABLED:'false',RECORDINGS_ENABLED:'false'});
  runtime=await createApp(appConfig,{memory:true,quiet:true});await seedEngineering(runtime.database);
  academic=runtime.app.get(AcademicService);exams=runtime.app.get(AssessmentService);
  config={...appConfig,EMAIL_ENABLED:'true',RESEND_API_KEY:'contract-test-resend-api-key',EMAIL_FROM:'devoirs@uniexam.example',EMAIL_ENCRYPTION_KEY:key,WEB_ORIGIN:'https://exam.uniexam.example'};
  mail=new InvitationService(academic,config); // onModuleInit is deliberately not called.
  await runtime.app.listen(0,'127.0.0.1');base=`${await runtime.app.getUrl()}/api/v1`;
  for(const [actor,id] of Object.entries({teacher:ids.teacher,student:ids.student,admin:ids.admin,otherTeacher:ids.engineeringTeacher,foreign:ids.otherAdmin})){
    const response=await fetch(`${base}/auth/demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:id})});assert.equal(response.status,201);tokens[actor]=(await response.json()).access_token;
  }
},{timeout:120000});
after(async()=>{await mail?.onModuleDestroy();await runtime?.close();});
async function request(id:string,path:string,actor='teacher',body?:unknown){const response=await fetch(`${base}/universities/${ids.university}/assessments/${id}/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${tokens[actor]}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
async function createExam(){
  const created=await exams.create(ids.teacher,ids.university,assessmentSchema.parse({title:'Invitation de contrat email',course_offering_id:ids.offering,opens_at:new Date(Date.now()-1000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:30,questions:[{type:'LONG_TEXT',title:'Réponse argumentée',statement:'Développez votre réponse avec un exemple.',points:20}]}));
  const publication=await exams.publish(ids.teacher,ids.university,created.id);
  return {id:created.id,originalCode:publication.access_codes[0].code};
}
type Captured={url:string;headers:Headers;body:{from:string;to:string[];subject:string;text:string}};
async function withProviderStub(work:()=>Promise<void>,reply:(request:Captured)=>Promise<Response>|Response){
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    assert.equal(url,'https://api.resend.com/emails','The contract test never permits an unexpected network destination.');
    assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.ok(init?.signal);
    return reply({url,headers:new Headers(init?.headers),body:JSON.parse(String(init?.body))});
  };
  try{await work();}finally{globalThis.fetch=original;}
}

test('AES-GCM mail encryption is randomized, reversible and rejects tampering or a different key',()=>{
  const payload={from:'exam@uniexam.example',to:['nour@uniexam.example'],subject:'Contrat seulement',text:'Code personnel secret'};
  const first=sealMail(payload,key),second=sealMail(payload,key);
  assert.notEqual(first,second);assert.deepEqual(openMail(first,key),payload);assert.ok(!first.includes(payload.text));
  const parts=first.split('.'),bytes=Buffer.from(parts[1],'base64');bytes[0]^=1;parts[1]=bytes.toString('base64');
  assert.throws(()=>openMail(parts.join('.'),key));assert.throws(()=>openMail(first,randomBytes(32).toString('base64')));assert.throws(()=>openMail('not-an-envelope',key));
});
test('HTTP invitation routes validate input and disabled configuration without sending anything',async()=>{
  const exam=await createExam();const recipients=await request(exam.id,'recipients');
  assert.equal(recipients.status,200);assert.equal(recipients.body.email_available,false);assert.deepEqual(recipients.body.data.map((r:{email:string})=>r.email),['nour@uniexam.example']);
  assert.equal((await request(exam.id,'invitations','teacher',{emails:['nour@uniexam.example']})).status,503);
  assert.equal((await request(exam.id,'invitations','teacher',{emails:[]})).status,400);
  assert.equal((await request(exam.id,'invitations','teacher',{emails:['bad-address']})).status,400);
  assert.equal((await request(exam.id,'invitations','teacher',{emails:['nour@uniexam.example'],subject:'Injected subject'})).status,400);
  await runtime.database.privileged(async c=>assert.equal((await c.query('select id from private.exam_mail_jobs where assessment_id=$1',[exam.id])).rows.length,0));
  for(const overrides of [{EMAIL_ENABLED:'false'},{RESEND_API_KEY:''},{EMAIL_FROM:'sender\r\nInjected: value@example.test'},{EMAIL_ENCRYPTION_KEY:'bad'},{WEB_ORIGIN:'http://localhost:3000'}])assert.equal(new InvitationService(academic,{...config,...overrides} as AppConfig).available(),false);
});
test('only the assigned teacher can invite actual active recipients, across HTTP and service scopes',async()=>{
  const exam=await createExam();
  for(const actor of ['student','admin','otherTeacher','foreign'])assert.equal((await request(exam.id,'recipients',actor)).status,403);
  for(const user of [ids.student,ids.admin,ids.engineeringTeacher,ids.otherAdmin])await assert.rejects(mail.queue(user,ids.university,exam.id,['nour@uniexam.example']),rejectsStatus(403));
  for(const email of ['adam@uniexam.example','lina@uniexam.example','unknown@uniexam.example'])await assert.rejects(mail.queue(ids.teacher,ids.university,exam.id,[email]),rejectsStatus(400));
  await assert.rejects(mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example','adam@uniexam.example']),rejectsStatus(400));
  await runtime.database.privileged(async c=>assert.equal((await c.query('select id from private.exam_mail_jobs where assessment_id=$1',[exam.id])).rows.length,0));
});
test('queueing is atomic and idempotent, encrypts the personal code and rotates the earlier manual code',async()=>{
  const exam=await createExam();
  const pair=await Promise.all([mail.queue(ids.teacher,ids.university,exam.id,['NOUR@UNIEXAM.EXAMPLE','nour@uniexam.example']),mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'])]);
  assert.equal(pair.reduce((sum,r)=>sum+r.queued,0),1);assert.equal(pair.reduce((sum,r)=>sum+r.skipped,0),1);
  const row=await runtime.database.privileged(async c=>(await c.query<{encrypted_payload:string;code_hash:string}>('select j.encrypted_payload,k.code_hash from private.exam_mail_jobs j join private.assessment_access_codes k on k.assessment_id=j.assessment_id and k.student_id=j.student_id where j.assessment_id=$1',[exam.id])).rows[0]);
  const payload=openMail(row.encrypted_payload,key);assert.deepEqual(payload.to,['nour@uniexam.example']);assert.ok(payload.text.includes('https://exam.uniexam.example/?view=exams'));
  const code=payload.text.match(/Code personnel : ([A-F0-9-]+)/)![1];assert.equal(row.code_hash,accessCodeHash(code));assert.ok(!row.encrypted_payload.includes(code));assert.ok(!row.encrypted_payload.includes('nour@uniexam.example'));
  await assert.rejects(exams.redeem(ids.student,ids.university,exam.originalCode),rejectsStatus(400));
  assert.equal((await exams.redeem(ids.student,ids.university,code)).assessment_id,exam.id);
  const deliveries:Captured[]=[];
  await withProviderStub(async()=>{await Promise.all([mail.drain(),new InvitationService(academic,config).drain()]);},request=>{deliveries.push(request);return Response.json({id:'test-contract-delivery-accepted'});});
  assert.equal(deliveries.length,1);assert.equal(deliveries[0].headers.get('Authorization'),`Bearer ${config.RESEND_API_KEY}`);assert.match(deliveries[0].headers.get('Idempotency-Key')!,/^exam-invitation\/[a-f0-9-]+$/);
  assert.equal(deliveries[0].body.text,payload.text);
  const final=await runtime.database.privileged(async c=>(await c.query('select status,provider_id,encrypted_payload from private.exam_mail_jobs where assessment_id=$1',[exam.id])).rows[0]);
  assert.equal(final.status,'SENT');assert.equal(final.provider_id,'test-contract-delivery-accepted');assert.equal(final.encrypted_payload,null);
  const status=await mail.recipients(ids.teacher,ids.university,exam.id);assert.equal(status.data[0].email_status,'SENT');assert.ok(status.message.includes('pas la lecture'));
  await runtime.database.asUser(ids.student,async c=>assert.equal((await c.query('select * from private.exam_mail_jobs')).rows.length,0));
});
test('provider retry keeps its idempotency key; final failures erase encrypted content and never report SENT',async()=>{
  const exam=await createExam();await mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example']);
  const calls:Captured[]=[];
  await withProviderStub(async()=>{
    await mail.drain();
    const failed=await runtime.database.privileged(async c=>(await c.query('select status,attempt_count,encrypted_payload from private.exam_mail_jobs where assessment_id=$1',[exam.id])).rows[0]);
    assert.equal(failed.status,'QUEUED');assert.equal(failed.attempt_count,1);assert.ok(failed.encrypted_payload);
    await runtime.database.privileged(c=>c.query("update private.exam_mail_jobs set next_attempt_at=clock_timestamp()-interval '1 second',attempt_count=4 where assessment_id=$1",[exam.id]));
    await mail.drain();
  },request=>{calls.push(request);return Response.json({message:'contract temporary rejection'},{status:503});});
  assert.equal(calls.length,2);assert.equal(calls[0].headers.get('Idempotency-Key'),calls[1].headers.get('Idempotency-Key'));
  const final=await runtime.database.privileged(async c=>(await c.query('select status,attempt_count,encrypted_payload,sent_at from private.exam_mail_jobs where assessment_id=$1',[exam.id])).rows[0]);
  assert.equal(final.status,'FAILED');assert.equal(final.attempt_count,5);assert.equal(final.encrypted_payload,null);assert.equal(final.sent_at,null);
});
test('started attempts are skipped and expired queued invitations are purged without a provider call',async()=>{
  const started=await createExam();await exams.redeem(ids.student,ids.university,started.originalCode);await exams.start(ids.student,ids.university,started.id);
  assert.deepEqual((await mail.queue(ids.teacher,ids.university,started.id,['nour@uniexam.example'])).skipped,1);
  const expired=await createExam();await mail.queue(ids.teacher,ids.university,expired.id,['nour@uniexam.example']);
  await runtime.database.privileged(c=>c.query("update private.exam_mail_jobs set created_at=clock_timestamp()-interval '13 hours' where assessment_id=$1",[expired.id]));
  await withProviderStub(()=>mail.drain(),()=>{assert.fail('Expired invitation must never reach the provider.');});
  const result=await runtime.database.privileged(async c=>(await c.query('select status,encrypted_payload from private.exam_mail_jobs where assessment_id=$1',[expired.id])).rows[0]);
  assert.equal(result.status,'EXPIRED');assert.equal(result.encrypted_payload,null);
});
test('explicit reissue preserves failed history, rotates the code and uses a new provider idempotency identity',async()=>{
  const exam=await createExam();await mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example']);
  const first=await runtime.database.privileged(async c=>(await c.query<{id:string;encrypted_payload:string}>('select id,encrypted_payload from private.exam_mail_jobs where assessment_id=$1',[exam.id])).rows[0]);
  const originalCode=openMail(first.encrypted_payload,key).text.match(/Code personnel : ([A-F0-9-]+)/)![1];
  await runtime.database.privileged(c=>c.query('update private.exam_mail_jobs set attempt_count=4 where id=$1',[first.id]));
  const deliveries:Captured[]=[];
  await withProviderStub(()=>mail.drain(),request=>{deliveries.push(request);return Response.json({message:'contract rejected'},{status:503});});
  const eligible=(await mail.recipients(ids.teacher,ids.university,exam.id)).data[0];assert.equal(eligible.can_retry,true);assert.equal(eligible.retry_remaining,3);assert.equal(eligible.email_job_id,first.id);
  assert.equal((await mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'])).queued,0,'A normal send must not silently replace a failed invitation.');
  const [one,two]=await Promise.all([mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'],true),mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'],true)]);
  assert.equal(one.reissued+two.reissued,1);assert.equal(one.queued+two.queued,1);assert.equal(one.skipped+two.skipped,1);
  const history=await runtime.database.privileged(async c=>(await c.query<{id:string;status:string;encrypted_payload:string;is_reissue:boolean}>('select id,status,encrypted_payload,is_reissue from private.exam_mail_jobs where assessment_id=$1 order by created_at,id',[exam.id])).rows);
  assert.equal(history.length,2);assert.equal(history[0].id,first.id);assert.equal(history[0].status,'FAILED');assert.equal(history[0].encrypted_payload,null);
  const next=history[1];assert.notEqual(next.id,first.id);assert.equal(next.is_reissue,true);assert.equal(next.status,'QUEUED');
  const newCode=openMail(next.encrypted_payload,key).text.match(/Code personnel : ([A-F0-9-]+)/)![1];assert.notEqual(newCode,originalCode);
  await assert.rejects(exams.redeem(ids.student,ids.university,originalCode),rejectsStatus(400));
  const recipients=await mail.recipients(ids.teacher,ids.university,exam.id);assert.equal(recipients.data.length,1);assert.equal(recipients.data[0].email_job_id,next.id);assert.equal(recipients.data[0].retry_remaining,2);assert.equal(recipients.data[0].can_retry,false);
  await withProviderStub(()=>mail.drain(),request=>{deliveries.push(request);return Response.json({id:'test-contract-reissued-accepted'});});
  assert.notEqual(deliveries[0].headers.get('Idempotency-Key'),deliveries[1].headers.get('Idempotency-Key'));
  assert.equal((await mail.recipients(ids.teacher,ids.university,exam.id)).data[0].email_status,'SENT');
  assert.equal((await mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'],true)).queued,0,'Accepted deliveries must not be resent.');
});
test('reissue quota survives new service instances and allows at most three explicit reissues per rolling day',async()=>{
  const exam=await createExam();await mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example']);
  const failLatest=()=>runtime.database.privileged(c=>c.query("update private.exam_mail_jobs set status='FAILED',encrypted_payload=null where assessment_id=$1 and status in ('QUEUED','SENDING')",[exam.id]));
  for(let n=0;n<3;n++){
    await failLatest();const fresh=new InvitationService(academic,config);
    assert.equal((await fresh.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'],true)).reissued,1);
  }
  await failLatest();
  const status=(await mail.recipients(ids.teacher,ids.university,exam.id)).data[0];assert.equal(status.retry_remaining,0);assert.equal(status.can_retry,false);
  await assert.rejects(new InvitationService(academic,config).queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'],true),rejectsStatus(429));
  await runtime.database.privileged(async c=>{
    assert.equal((await c.query('select id from private.exam_mail_jobs where assessment_id=$1',[exam.id])).rows.length,4);
    await c.query("update private.exam_mail_jobs set created_at=clock_timestamp()-interval '25 hours' where assessment_id=$1 and is_reissue",[exam.id]);
  });
  assert.equal((await mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'],true)).reissued,1);
  await withProviderStub(()=>mail.drain(),()=>Response.json({id:'test-contract-after-rolling-window'}));
});
test('a late provider acknowledgement cannot revive an expired job after its explicit replacement',async()=>{
  const exam=await createExam();await mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example']);
  const original=await runtime.database.privileged(async c=>(await c.query<{id:string}>('select id from private.exam_mail_jobs where assessment_id=$1',[exam.id])).rows[0].id);
  let acknowledge!:()=>void,arrived!:()=>void;
  const responseGate=new Promise<void>(resolve=>{acknowledge=resolve;}),arrival=new Promise<void>(resolve=>{arrived=resolve;});let calls=0;
  await withProviderStub(async()=>{
    const pending=mail.drain();await arrival;
    await runtime.database.privileged(c=>c.query("update private.exam_mail_jobs set created_at=clock_timestamp()-interval '13 hours' where id=$1",[original]));
    await new InvitationService(academic,config).drain();
    assert.equal((await mail.queue(ids.teacher,ids.university,exam.id,['nour@uniexam.example'],true)).reissued,1);
    acknowledge();await pending;
    const old=await runtime.database.privileged(async c=>(await c.query('select status,sent_at from private.exam_mail_jobs where id=$1',[original])).rows[0]);
    assert.equal(old.status,'EXPIRED');assert.equal(old.sent_at,null);
    await mail.drain();
  },async()=>{calls++;if(calls===1){arrived();await responseGate;}return Response.json({id:`test-contract-delivery-${calls}`});});
  assert.equal(calls,2);assert.equal((await mail.recipients(ids.teacher,ids.university,exam.id)).data[0].email_status,'SENT');
});

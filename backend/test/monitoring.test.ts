import 'reflect-metadata';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app';
import {loadConfig} from '../src/config';
import {demoIds as ids} from '../src/database/seed';
import {AcademicService} from '../src/academic/academic.service';
import {AssessmentService} from '../src/assessments/assessment.service';
import {MonitoringService} from '../src/monitoring/monitoring.service';
import {RecordingStorage,type RecordingObject} from '../src/monitoring/recording-storage';
import {HttpException} from '@nestjs/common';

let runtime:Awaited<ReturnType<typeof createApp>>,service:MonitoringService,attempt:string,session:string,chunk:string;
// These are contract tests for storage. No screen is captured, and no cloud object is created.
const objects=new Map<string,RecordingObject>(),removed:string[]=[];
let enabled=true;
const fakeStorage={get configured(){return enabled;},retentionDays:30,
  async ready(){if(!enabled)throw new Error('Storage unavailable');},
  async uploadUrl(path:string){return `https://storage.example.invalid/${path}?signature=test-only`;},
  async info(path:string){const o=objects.get(path);if(!o)throw new Error('Missing cloud object');return o;},
  async playUrl(path:string){return `https://storage.example.invalid/${path}?read=test-only`;},
  async remove(paths:string[]){paths.forEach(p=>{removed.push(p);objects.delete(p);});},
};
const fails=(status:number)=>(error:unknown)=>error instanceof HttpException&&error.getStatus()===status;
before(async()=>{
  runtime=await createApp(loadConfig({APP_MODE:'demo',NODE_ENV:'test',AI_ENABLED:'false',RECORDINGS_ENABLED:'false',RUNNER_ENABLED:'false',EMAIL_ENABLED:'false'}),{memory:true,quiet:true});
  const exams=runtime.app.get(AssessmentService);
  await exams.redeem(ids.student,ids.university,'PYTHON-DEMO');
  attempt=(await exams.start(ids.student,ids.university,'80000000-0000-4000-8000-000000000001')).id;
  service=new MonitoringService(runtime.app.get(AcademicService),fakeStorage as RecordingStorage);
},{timeout:120000});
after(async()=>{await runtime?.close();});
test('video is unavailable without credentials, including local demo mode',async()=>{
  const real=new RecordingStorage(loadConfig({RECORDINGS_ENABLED:'false',SUPABASE_SERVICE_ROLE_KEY:''}));
  assert.equal(real.configured,false);await assert.rejects(real.ready(),fails(503));
  const unconfigured=new MonitoringService(runtime.app.get(AcademicService),real);
  const result=await unconfigured.status(ids.student,ids.university,attempt);assert.equal(result.state,'NOT_CONFIGURED');
  await assert.rejects(unconfigured.start(ids.student,ids.university,attempt),fails(503));
  assert.equal((await runtime.database.privileged(c=>c.query('select id from public.recording_sessions'))).rows.length,0);
});
test('owner checks precede cloud access; administrators cannot read student recordings',async()=>{
  await assert.rejects(service.start(ids.otherStudent,ids.university,attempt),fails(404));
  await assert.rejects(service.status(ids.otherAdmin,ids.university,attempt),fails(403));
  await assert.rejects(service.list(ids.admin,ids.university,attempt),fails(404));
  await assert.rejects(service.list(ids.languageTeacher,ids.university,attempt),fails(404));
});
test('one active recording session is created under concurrent starts',async()=>{
  const results=await Promise.allSettled([service.start(ids.student,ids.university,attempt),service.start(ids.student,ids.university,attempt)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const success=results.find(r=>r.status==='fulfilled');assert.ok(success?.status==='fulfilled');session=String(success.value.id);
  const persisted=await runtime.database.privileged(c=>c.query<{consent_version:string;student_id:string}>('select consent_version,student_id from public.recording_sessions where id=$1',[session]));
  assert.equal(persisted.rows[0].consent_version,'screen-v1');assert.equal(persisted.rows[0].student_id,ids.student);
});
test('chunk reservations are ordered, tenant scoped, bounded and idempotent',async()=>{
  const payload={sequence:0,size_bytes:1234,mime_type:'video/webm' as const};
  const first=await service.reserve(ids.student,ids.university,attempt,session,payload);chunk=first.id;
  const second=await service.reserve(ids.student,ids.university,attempt,session,payload);assert.equal(first.id,second.id);
  assert.ok(first.upload_url?.includes(`${ids.university}/${attempt}/${session}/`));
  await assert.rejects(service.reserve(ids.otherStudent,ids.university,attempt,session,payload),fails(404));
  await assert.rejects(service.reserve(ids.student,ids.university,attempt,session,{...payload,size_bytes:2000}),fails(409));
  await assert.rejects(service.reserve(ids.student,ids.university,attempt,session,{...payload,sequence:3}),fails(409));
  await assert.rejects(service.reserve(ids.student,ids.university,attempt,session,{...payload,sequence:1,size_bytes:4194305}),error=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code==='23514'));
});
test('completion checks actual storage metadata and teacher-only expiring playback',async()=>{
  const row=(await runtime.database.privileged(c=>c.query<{object_path:string}>('select object_path from public.recording_chunks where id=$1',[chunk]))).rows[0];
  objects.set(row.object_path,{size:1235,mimeType:'video/webm'});
  await assert.rejects(service.complete(ids.student,ids.university,attempt,session,chunk),fails(400));
  objects.set(row.object_path,{size:1234,mimeType:'video/webm'});
  assert.equal((await service.complete(ids.student,ids.university,attempt,session,chunk)).status,'READY');
  assert.equal((await service.complete(ids.student,ids.university,attempt,session,chunk)).status,'READY');
  await assert.rejects(service.play(ids.otherStudent,ids.university,attempt,chunk),fails(404));
  await assert.rejects(service.play(ids.student,ids.university,attempt,chunk),fails(404));
  await assert.rejects(service.play(ids.admin,ids.university,attempt,chunk),fails(404));
  const review=await service.list(ids.teacher,ids.university,attempt);assert.equal(review.data.length,1);assert.ok(!JSON.stringify(review).includes('object_path'));
  const play=await service.play(ids.teacher,ids.university,attempt,chunk);assert.equal(play.expires_in,120);
  assert.equal((await runtime.database.asUser(ids.otherStudent,c=>c.query('select * from public.recording_chunks'))).rows.length,0);
  assert.equal((await runtime.database.asUser(ids.admin,c=>c.query('select * from public.recording_chunks'))).rows.length,0);
});
test('stopping is idempotent, expired leases cannot continue and expired objects are purged',async()=>{
  await service.stop(ids.student,ids.university,attempt,session);await service.stop(ids.student,ids.university,attempt,session);
  await assert.rejects(service.reserve(ids.student,ids.university,attempt,session,{sequence:1,size_bytes:10,mime_type:'video/webm'}),fails(410));
  const second=await service.start(ids.student,ids.university,attempt);
  await runtime.database.privileged(c=>c.query("update public.recording_sessions set lease_until=clock_timestamp()-interval '1 second' where id=$1",[second.id]));
  await assert.rejects(service.reserve(ids.student,ids.university,attempt,String(second.id),{sequence:0,size_bytes:10,mime_type:'video/webm'}),fails(410));
  await runtime.database.privileged(c=>c.query("update public.recording_sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1",[session]));
  await assert.rejects(service.play(ids.teacher,ids.university,attempt,chunk),fails(404));
  const result=await service.purgeExpired();assert.equal(result.deleted,1);assert.equal(removed.length,1);
  assert.equal((await service.purgeExpired()).deleted,0);
});
test('final submission disallows new recordings and only accepts a last segment for an existing session',async()=>{
  const third=await service.start(ids.student,ids.university,attempt);
  await runtime.app.get(AssessmentService).finalize(ids.student,ids.university,attempt);
  await assert.rejects(service.start(ids.student,ids.university,attempt),fails(410));
  await service.reserve(ids.student,ids.university,attempt,String(third.id),{sequence:0,size_bytes:10,mime_type:'video/webm'});
  await assert.rejects(service.reserve(ids.student,ids.university,attempt,String(third.id),{sequence:1,size_bytes:10,mime_type:'video/webm'}),fails(410));
});

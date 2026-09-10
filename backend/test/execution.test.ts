import 'reflect-metadata';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {HttpException} from '@nestjs/common';
import {Database} from '../src/database/database';
import {seedDemo,demoIds as ids} from '../src/database/seed';
import {seedDemoAssessments} from '../src/database/seed-assessments';
import {loadConfig} from '../src/config';
import {AcademicService} from '../src/academic/academic.service';
import {AssessmentService} from '../src/assessments/assessment.service';
import {ExecutionService} from '../src/execution/execution.service';
import {Judge0Adapter,type RunnerConfig} from '../src/execution/judge0.adapter';
import {assessmentSchema} from '../../packages/contracts/src/assessments';
import {RUNTIME_CATALOG,defaultWebProject,executionRequestSchema,type RuntimeId} from '../../packages/contracts/src/runtimes';

// This HTTP fixture validates the Judge0 protocol. It NEVER compiles or executes source.
const contractOutput='TEST-CONTRACT OUTPUT — not actual execution';
let db:Database,academic:AcademicService,exams:AssessmentService,execution:ExecutionService,provider:Server,config:RunnerConfig;
let providerStatus=3,providerVersion='1.13.1',providerNetwork=false,oversizedOutput=false;
const received:Record<string,unknown>[]=[];
const rejectStatus=(status:number)=>(error:unknown)=>error instanceof HttpException&&error.getStatus()===status;
before(async()=>{
  provider=createServer(async(req,res)=>{
    if(req.headers['x-auth-token']!=='contract-only-test-token'){res.writeHead(401).end();return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/about'){res.end(JSON.stringify({version:providerVersion}));return;}
    if(req.url==='/config_info'){res.end(JSON.stringify({enable_network:providerNetwork,allow_enable_network:false}));return;}
    if(req.url==='/languages'){res.end(JSON.stringify([{id:71,name:'Python (contract)'},{id:68,name:'PHP (contract)'},{id:62,name:'Java (contract)'}]));return;}
    if(req.method==='POST'&&req.url?.startsWith('/submissions?')){
      let body='';for await(const part of req)body+=part.toString();received.push(JSON.parse(body));
      res.writeHead(201).end(JSON.stringify({token:`contract-test-token-${received.length}`}));return;
    }
    if(req.method==='GET'&&req.url?.startsWith('/submissions/')){
      res.end(JSON.stringify({status:{id:providerStatus},stdout:Buffer.from(oversizedOutput?'x'.repeat(32769):contractOutput).toString('base64'),stderr:null,compile_output:providerStatus===6?Buffer.from('Contract compiler error').toString('base64'):null,time:'0.001',memory:1024}));return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const address=provider.address();assert.ok(address&&typeof address!=='string');
  config={...loadConfig({APP_MODE:'demo',NODE_ENV:'test',AI_ENABLED:'false',EMAIL_ENABLED:'false',RECORDINGS_ENABLED:'false',RUNNER_PROVIDER:'judge0'}),RUNNER_ENABLED:'true',RUNNER_BASE_URL:`http://127.0.0.1:${address.port}`,RUNNER_AUTH_TOKEN:'contract-only-test-token',RUNNER_LANGUAGE_IDS:JSON.stringify({python:71,php:68,java:62})};
  db=new Database(config);await db.connect(true);await seedDemo(db);await seedDemoAssessments(db);
  academic=new AcademicService(db);exams=new AssessmentService(academic,config);execution=new ExecutionService(academic,config);
},{timeout:120000});
after(async()=>{await execution?.onModuleDestroy();await db?.close();await new Promise<void>(resolve=>provider?.close(()=>resolve()));});
async function codingAttempt(runtime:RuntimeId='python'){
  const definition=RUNTIME_CATALOG.find(r=>r.id===runtime)!;
  const a=await exams.create(ids.teacher,ids.university,assessmentSchema.parse({title:`Contrat exécution ${runtime}`,course_offering_id:ids.offering,opens_at:new Date(Date.now()-60000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:30,requires_code:false,questions:[{type:'CODE',title:'Écrire un programme',statement:'Écrivez un programme pour le test.',points:20,runtime,starter_code:definition.starterCode}]}));
  await exams.publish(ids.teacher,ids.university,a.id);
  const attempt=await exams.start(ids.student,ids.university,a.id),data=await exams.attempt(ids.student,ids.university,attempt.id),question=data.questions[0];
  await exams.save(ids.student,ids.university,attempt.id,question.id,question.starter_code,0);
  return {attempt:attempt.id,question:question.id,assessment:a.id,source:question.starter_code};
}
async function finish(id:string){
  await execution.tick();
  await db.privileged(c=>c.query("update private.execution_jobs set next_poll_at=clock_timestamp()-interval '1 second' where id=$1",[id]));
  await execution.tick();
}

test('catalogue provides twenty editors and only verified configured remote runtimes are executable',async()=>{
  const catalog=await execution.runtimes(ids.student,ids.university);
  assert.equal(catalog.data.length,20);assert.deepEqual(catalog.data.map(item=>item.id).sort(),RUNTIME_CATALOG.map(item=>item.id).sort());assert.equal(catalog.data.find(r=>r.id==='php')!.status,'READY');
  assert.equal(catalog.data.find(r=>r.id==='java')!.provider_language,'Java (contract)');
  assert.equal(catalog.data.find(r=>r.id==='rust')!.execution_available,false);
  assert.equal(catalog.data.find(r=>r.id==='web')!.status,'WEB_PREVIEW');
  assert.equal(catalog.data.find(r=>r.id==='sql')!.status,'UNAVAILABLE');assert.equal(catalog.data.find(r=>r.id==='sql')!.execution_available,false);
  for(const id of ['react','angular','symfony','laravel','mysql','oracle_plsql']){const runtime=catalog.data.find(item=>item.id===id)!;assert.equal(runtime.status,'UNAVAILABLE');assert.equal(runtime.execution_available,false);}
  await assert.rejects(execution.runtimes(ids.otherAdmin,ids.university),rejectStatus(403));
  const disabled=new ExecutionService(academic,{...config,RUNNER_ENABLED:'false'});
  assert.equal((await disabled.runtimes(ids.student,ids.university)).data.find(r=>r.id==='python')!.status,'UNAVAILABLE');
});
test('provider checks reject vulnerable versions, network access, public demo providers and language mismatches',async()=>{
  providerVersion='1.13.0';assert.deepEqual((await new Judge0Adapter(config).discover()).languages,{});providerVersion='1.13.1';
  providerNetwork=true;assert.deepEqual((await new Judge0Adapter(config).discover()).languages,{});providerNetwork=false;
  assert.deepEqual((await new Judge0Adapter({...config,RUNNER_BASE_URL:'https://ce.judge0.com'}).discover()).languages,{});
  assert.deepEqual((await new Judge0Adapter({...config,RUNNER_LANGUAGE_IDS:'{"php":62}'}).discover()).languages,{});
  assert.deepEqual((await new Judge0Adapter({...config,RUNNER_AUTH_TOKEN:''}).discover()).languages,{});
});
test('test-contract asynchronous PHP run is persisted, isolated by actor and never returns provider credentials or source',async()=>{
  const work=await codingAttempt('php');
  await assert.rejects(execution.enqueue(ids.otherStudent,ids.university,work.attempt,work.question,{expected_version:1,stdin:''}),rejectStatus(404));
  await assert.rejects(execution.enqueue(ids.student,ids.university,work.attempt,ids.subject,{expected_version:1,stdin:''}),rejectStatus(404));
  await assert.rejects(execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:2,stdin:''}),rejectStatus(409));
  const run=await execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:1,stdin:'example input'});
  assert.equal(run.status,'QUEUED');assert.equal(run.answer_version,1);assert.ok(!('source_code' in run));assert.ok(!('provider_token' in run));
  await assert.rejects(execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:1,stdin:''}),rejectStatus(409));
  await finish(run.id);
  const result=await execution.get(ids.student,ids.university,work.attempt,run.id);
  assert.equal(result.status,'SUCCEEDED');assert.equal(result.stdout,contractOutput);
  const request=received.at(-1)!;assert.equal(request.language_id,68);assert.equal(request.enable_network,false);assert.equal(request.wall_time_limit,10);
  assert.equal(Buffer.from(String(request.source_code),'base64').toString(),work.source);
  assert.equal(Buffer.from(String(request.stdin),'base64').toString(),'example input');assert.equal(request.callback_url,undefined);assert.equal(request.compiler_options,undefined);assert.equal(request.command_line_arguments,undefined);
  await db.privileged(async c=>{const row=(await c.query('select source_code,stdin from private.execution_jobs where id=$1',[run.id])).rows[0];assert.equal(row.source_code,'');assert.equal(row.stdin,'');});
  await assert.rejects(execution.get(ids.otherStudent,ids.university,work.attempt,run.id),rejectStatus(404));
  await assert.rejects(execution.get(ids.teacher,ids.university,work.attempt,run.id),rejectStatus(404));
  await exams.finalize(ids.student,ids.university,work.attempt);
  await assert.rejects(execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:1,stdin:''}),rejectStatus(410));
});
test('Java compiler errors, timeout and oversized output are distinct bounded provider outcomes',async()=>{
  const work=await codingAttempt('java');providerStatus=6;
  const run=await execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:1,stdin:''});await finish(run.id);
  assert.equal((await execution.get(ids.student,ids.university,work.attempt,run.id)).status,'COMPILE_ERROR');
  assert.equal(received.at(-1)!.memory_limit,524288);
  providerStatus=5;const timeout=await execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:1,stdin:''});await finish(timeout.id);
  assert.equal((await execution.get(ids.student,ids.university,work.attempt,timeout.id)).status,'TIME_LIMIT');
  providerStatus=3;oversizedOutput=true;const huge=await execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:1,stdin:''});await finish(huge.id);
  const rejected=await execution.get(ids.student,ids.university,work.attempt,huge.id);assert.equal(rejected.status,'FAILED');assert.equal(rejected.stdout,'');oversizedOutput=false;
});
test('server validates web project structure, code byte limits and runner request fields',async()=>{
  const web=await codingAttempt('web');
  await assert.rejects(exams.save(ids.student,ids.university,web.attempt,web.question,'<script>alert(1)</script>',1),rejectStatus(400));
  await assert.rejects(exams.save(ids.student,ids.university,web.attempt,web.question,JSON.stringify({...defaultWebProject,files:{...defaultWebProject.files,'../secret':'bad'}}),1),rejectStatus(400));
  assert.equal((await exams.save(ids.student,ids.university,web.attempt,web.question,JSON.stringify(defaultWebProject),1)).version,2);
  await assert.rejects(execution.enqueue(ids.student,ids.university,web.attempt,web.question,{expected_version:2,stdin:''}),rejectStatus(503));
  const py=await codingAttempt();
  await assert.rejects(exams.save(ids.student,ids.university,py.attempt,py.question,'é'.repeat(15001),1),rejectStatus(400));
  await assert.rejects(execution.enqueue(ids.student,ids.university,py.attempt,py.question,{expected_version:1,stdin:'é'.repeat(2001)}),rejectStatus(400));
  assert.equal(executionRequestSchema.safeParse({expected_version:1,stdin:'x'.repeat(4001)}).success,false);
  assert.equal(executionRequestSchema.safeParse({expected_version:1,callback_url:'http://evil.example'}).success,false);
  assert.equal(executionRequestSchema.safeParse({expected_version:1,language_id:89}).success,false);
  assert.equal(executionRequestSchema.safeParse({expected_version:1,source_code:'unsaved replacement'}).success,false);
});
test('durable queue survives a new worker, fails stale dispatch without duplicate execution, and enforces quotas',async()=>{
  const work=await codingAttempt();
  const queued=await execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:1,stdin:''});
  const freshWorker=new ExecutionService(academic,config);await freshWorker.tick();
  assert.equal((await execution.get(ids.student,ids.university,work.attempt,queued.id)).status,'PROCESSING');
  const previous=received.length;
  await db.privileged(c=>c.query("update private.execution_jobs set status='DISPATCHING',created_at=clock_timestamp()-interval '3 minutes' where id=$1",[queued.id]));
  await freshWorker.tick();assert.equal(received.length,previous);assert.equal((await execution.get(ids.student,ids.university,work.attempt,queued.id)).status,'FAILED');
  await db.privileged(c=>c.query(`insert into private.execution_jobs(university_id,assessment_id,attempt_id,question_id,student_id,runtime,answer_version,source_code,status,created_at,finished_at)
    select university_id,assessment_id,attempt_id,question_id,student_id,runtime,answer_version,'','SUCCEEDED',clock_timestamp()-interval '2 hours',clock_timestamp() from private.execution_jobs cross join generate_series(1,200) where id=$1`,[queued.id]));
  await assert.rejects(execution.enqueue(ids.student,ids.university,work.attempt,work.question,{expected_version:1,stdin:''}),rejectStatus(429));
  await db.asUser(ids.otherStudent,async c=>assert.equal((await c.query('select id from private.execution_jobs')).rows.length,0));
});

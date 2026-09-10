import 'reflect-metadata';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {DockerAdapter} from '../src/execution/docker.adapter';
import {ExecutionService} from '../src/execution/execution.service';
import {type RunnerConfig} from '../src/execution/judge0.adapter';
import {Database} from '../src/database/database';
import {seedDemo,demoIds as ids} from '../src/database/seed';
import {AcademicService} from '../src/academic/academic.service';
import {AssessmentService} from '../src/assessments/assessment.service';
import {loadConfig} from '../src/config';
import {RUNTIME_CATALOG,type RuntimeId} from '../../packages/contracts/src/runtimes';
import {assessmentSchema} from '../../packages/contracts/src/assessments';

// Contract HTTP fixture only. No program, shell or Docker command is executed.
let fixture:Server,config:RunnerConfig,database:Database,academic:AcademicService,exams:AssessmentService,execution:ExecutionService;
let health:Record<string,unknown>={engine:'uniexam-docker',protocol:1,network_disabled:true,privileged:false};
let advertised=RUNTIME_CATALOG.map(runtime=>({id:runtime.id,version:'contract-test',image:`test-contract/${runtime.id}:fixture`,available:runtime.id!=='rust'}));
let outcome:Record<string,unknown>={status:'SUCCEEDED',stdout:'DOCKER TEST-CONTRACT ONLY',stderr:'',compile_output:'',message:'',time_seconds:0.01,memory_kb:4096};
let acceptedId=randomUUID(),healthRequests=0,catalogRequests=0;
const submissions:{runtime:RuntimeId;source:string;stdin:string}[]=[];
before(async()=>{
  fixture=createServer(async(req,res)=>{
    if(req.headers['x-auth-token']!=='docker-contract-test-token'){res.writeHead(401).end();return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/health'){healthRequests++;res.end(JSON.stringify(health));return;}
    if(req.url==='/runtimes'){catalogRequests++;res.end(JSON.stringify({runtimes:advertised}));return;}
    if(req.method==='POST'&&req.url==='/runs'){
      let body='';for await(const part of req)body+=part.toString();submissions.push(JSON.parse(body));res.writeHead(202).end(JSON.stringify({id:acceptedId}));return;
    }
    if(req.method==='GET'&&req.url?.startsWith('/runs/')){res.end(JSON.stringify(outcome));return;}
    res.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve));const address=fixture.address();assert.ok(address&&typeof address!=='string');
  config=loadConfig({APP_MODE:'demo',NODE_ENV:'test',AI_ENABLED:'false',EMAIL_ENABLED:'false',RECORDINGS_ENABLED:'false',RUNNER_ENABLED:'true',RUNNER_PROVIDER:'docker',RUNNER_BASE_URL:`http://127.0.0.1:${address.port}`,RUNNER_AUTH_TOKEN:'docker-contract-test-token'});
  database=new Database(config);await database.connect(true);await seedDemo(database);
  academic=new AcademicService(database);exams=new AssessmentService(academic,config);execution=new ExecutionService(academic,config);
},{timeout:120000});
after(async()=>{await execution?.onModuleDestroy();await database?.close();await new Promise<void>(resolve=>fixture?.close(()=>resolve()));});
const rejectsStatus=(status:number)=>(error:unknown)=>error instanceof HttpException&&error.getStatus()===status;
async function work(runtime:RuntimeId){
  const definition=RUNTIME_CATALOG.find(r=>r.id===runtime)!;
  const assessment=await exams.create(ids.teacher,ids.university,assessmentSchema.parse({title:`Docker contract ${runtime}`,course_offering_id:ids.offering,opens_at:new Date(Date.now()-1000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:30,requires_code:false,questions:[{type:'CODE',runtime,title:'Programme de contrat',statement:'Écrivez votre programme de test.',points:20,starter_code:definition.starterCode}]}));
  await exams.publish(ids.teacher,ids.university,assessment.id);const attempt=await exams.start(ids.student,ids.university,assessment.id);
  const data=await exams.attempt(ids.student,ids.university,attempt.id),question=data.questions[0];
  await exams.save(ids.student,ids.university,attempt.id,question.id,definition.starterCode,0);
  return {attempt:attempt.id,question:question.id,source:definition.starterCode};
}
async function finish(id:string){await execution.tick();await database.privileged(c=>c.query("update private.execution_jobs set next_poll_at=clock_timestamp()-interval '1 second' where id=$1",[id]));await execution.tick();}

test('Docker discovery requires protocol/security identity, matches known available runtimes and caches its probes',async()=>{
  const adapter=new DockerAdapter(config),first=await adapter.discover(),second=await adapter.discover();
  assert.deepEqual(first,second);assert.equal(healthRequests,1);assert.equal(catalogRequests,1);
  assert.ok(first.languages.php);assert.ok(first.languages.java);assert.ok(first.languages.sql);assert.equal(first.languages.rust,undefined);assert.equal(first.languages.web,undefined);
  const catalog=(await execution.runtimes(ids.student,ids.university)).data;
  assert.equal(catalog.find(runtime=>runtime.id==='sql')!.status,'READY');assert.equal(catalog.find(runtime=>runtime.id==='sql')!.kind,'REMOTE');
  assert.equal(catalog.find(runtime=>runtime.id==='rust')!.status,'UNAVAILABLE');assert.equal(catalog.find(runtime=>runtime.id==='web')!.status,'WEB_PREVIEW');
  assert.equal(loadConfig({RUNNER_PROVIDER:undefined}).RUNNER_PROVIDER,'judge0');assert.throws(()=>loadConfig({RUNNER_PROVIDER:'public-fallback'}));
});
test('Docker refuses unsafe health declarations, duplicate/unknown languages, unauthenticated and non-loopback HTTP configurations',async()=>{
  const initialHealth=health,initialCatalog=advertised;
  for(const change of [{protocol:2},{engine:'judge0'},{network_disabled:false},{privileged:true}]){health={...initialHealth,...change};assert.deepEqual((await new DockerAdapter(config).discover()).languages,{});}
  health=initialHealth;
  advertised=[...initialCatalog,initialCatalog[0]];assert.deepEqual((await new DockerAdapter(config).discover()).languages,{});
  advertised=[{id:'unrecognized' as RuntimeId,version:'contract',image:'test',available:true}];assert.deepEqual((await new DockerAdapter(config).discover()).languages,{});advertised=initialCatalog;
  for(const override of [{RUNNER_ENABLED:'false' as const},{RUNNER_AUTH_TOKEN:''},{RUNNER_BASE_URL:'http://runner.example.internal:4200'},{RUNNER_BASE_URL:'http://user:password@127.0.0.1:4200'},{RUNNER_BASE_URL:config.RUNNER_BASE_URL+'?override=yes'},{NODE_ENV:'production' as const}])assert.deepEqual((await new DockerAdapter({...config,...override}).discover()).languages,{});
});

test('Docker discovery gets twelve seconds while submission and result requests remain bounded to five seconds',async context=>{
  const deadlines:number[]=[];const timeout=AbortSignal.timeout.bind(AbortSignal);
  context.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{deadlines.push(milliseconds);return timeout(milliseconds);});
  const adapter=new DockerAdapter(config);await adapter.discover();
  const id=await adapter.submit('php','<?php echo "contract";','');await adapter.result(id);
  assert.deepEqual(deadlines,[12000,12000,5000,5000]);
});
test('Docker submissions forward only runtime, saved source and stdin; polling validates UUIDs, statuses and bounded output',async()=>{
  const adapter=new DockerAdapter(config);acceptedId=randomUUID();
  assert.equal(await adapter.submit('php','<?php echo "contract";','input'),acceptedId);
  assert.deepEqual(submissions.at(-1),{runtime:'php',source:'<?php echo "contract";',stdin:'input'});
  const before=submissions.length;
  await assert.rejects(adapter.submit('php','é'.repeat(15001),''));await assert.rejects(adapter.submit('php','<?php echo 1;','é'.repeat(2001)));await assert.rejects(adapter.submit('web','<h1>no remote web</h1>',''));assert.equal(submissions.length,before);
  await assert.rejects(adapter.result('../../auth'));const original=outcome;
  for(const status of ['QUEUED','PROCESSING','SUCCEEDED','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT','FAILED']){outcome={...original,status};assert.equal((await adapter.result(acceptedId)).status,status==='QUEUED'?'PROCESSING':status);}
  outcome={...original,stdout:'é'.repeat(16385)};await assert.rejects(adapter.result(acceptedId));
  outcome={...original,stdout:'x'.repeat(190000)};await assert.rejects(adapter.result(acceptedId));
  outcome={...original,status:'unknown'};await assert.rejects(adapter.result(acceptedId));
  outcome={...original,stdout:'hello\u0000world'};assert.equal((await adapter.result(acceptedId)).stdout,'helloworld');outcome=original;
});
test('PHP, Java and SQLite use the same durable queue, saved-version checks and student isolation with Docker provider',async()=>{
  for(const language of ['php','java','sql'] as const){
    const item=await work(language);acceptedId=randomUUID();
    await assert.rejects(execution.enqueue(ids.otherStudent,ids.university,item.attempt,item.question,{expected_version:1,stdin:''}),rejectsStatus(404));
    await assert.rejects(execution.enqueue(ids.student,ids.university,item.attempt,item.question,{expected_version:2,stdin:''}),rejectsStatus(409));
    const job=await execution.enqueue(ids.student,ids.university,item.attempt,item.question,{expected_version:1,stdin:'contract input'});assert.equal(job.status,'QUEUED');
    await finish(job.id);const result=await execution.get(ids.student,ids.university,item.attempt,job.id);
    assert.equal(result.status,'SUCCEEDED');assert.equal(result.stdout,'DOCKER TEST-CONTRACT ONLY');assert.equal(result.answer_version,1);
    assert.deepEqual(submissions.at(-1),{runtime:language,source:item.source,stdin:'contract input'});
    await assert.rejects(execution.get(ids.otherStudent,ids.university,item.attempt,job.id),rejectsStatus(404));
    await exams.finalize(ids.student,ids.university,item.attempt);await assert.rejects(execution.enqueue(ids.student,ids.university,item.attempt,item.question,{expected_version:1,stdin:''}),rejectsStatus(410));
    await database.privileged(async c=>{const stored=(await c.query('select source_code,stdin,provider_token from private.execution_jobs where id=$1',[job.id])).rows[0];assert.equal(stored.source_code,'');assert.equal(stored.stdin,'');assert.equal(stored.provider_token,acceptedId);});
  }
});

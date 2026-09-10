import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app';
import {loadConfig} from '../src/config';
import {ExecutionService} from '../src/execution/execution.service';
import {demoIds as ids} from '../src/database/seed';
import {RUNTIME_CATALOG,type RuntimeId} from '../../packages/contracts/src/runtimes';
import {defaultFrameworkProjects,frameworkIds,type FrameworkId} from '../../packages/contracts/src/projects';

// HTTP contract fixture only: no source is executed and no external provider is contacted.
let app:Awaited<ReturnType<typeof createApp>>,provider:Server,base:string,execution:ExecutionService;
const tokens:Record<string,string>={},university=`/universities/${ids.university}`,secret='synthetic-preview-contract-token';
let providerId=randomUUID(),previewCalls=0,providerCalls=0,previewStatus=200,html='<html><body>TEST-CONTRACT PREVIEW ONLY</body></html>';
const output={status:'SUCCEEDED',stdout:'TEST-CONTRACT BUILD ONLY',stderr:'',compile_output:'',message:'',time_seconds:0.01,memory_kb:null};
before(async()=>{
  provider=createServer(async(request,response)=>{
    providerCalls++;response.setHeader('content-type','application/json');
    if(request.headers['x-auth-token']!==secret){response.writeHead(401).end('{}');return;}
    if(request.url==='/health'){response.end(JSON.stringify({engine:'uniexam-docker',protocol:1,network_disabled:true,privileged:false}));return;}
    if(request.url==='/runtimes'){response.end(JSON.stringify({runtimes:RUNTIME_CATALOG.filter(item=>item.kind==='REMOTE').map(item=>({id:item.id,version:'test-contract',image:'test-contract/no-real-image',available:true}))}));return;}
    if(request.method==='POST'&&request.url==='/runs'){for await(const ignored of request)void ignored;response.writeHead(202).end(JSON.stringify({id:providerId}));return;}
    if(request.url===`/runs/${providerId}/preview`){previewCalls++;response.writeHead(previewStatus).end(JSON.stringify(previewStatus===200?{html}:{message:'test-contract artifact expired'}));return;}
    if(request.url===`/runs/${providerId}`){response.end(JSON.stringify({...output,preview_html:html,provider_token:providerId}));return;}
    response.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));const address=provider.address();assert.ok(address&&typeof address!=='string');
  app=await createApp(loadConfig({APP_MODE:'demo',NODE_ENV:'test',AI_ENABLED:'false',EMAIL_ENABLED:'false',RECORDINGS_ENABLED:'false',RUNNER_ENABLED:'true',RUNNER_PROVIDER:'docker',RUNNER_BASE_URL:`http://127.0.0.1:${address.port}`,RUNNER_AUTH_TOKEN:secret}),{memory:true,quiet:true});
  execution=app.app.get(ExecutionService);await execution.onModuleDestroy(); // deterministic worker ticks below
  await app.app.listen(0,'127.0.0.1');base=`${await app.app.getUrl()}/api/v1`;
  for(const [actor,id] of Object.entries({student:ids.student,teacher:ids.teacher,other:ids.otherStudent,foreign:ids.otherAdmin})){
    const response=await fetch(`${base}/auth/demo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user_id:id})});tokens[actor]=(await response.json()).access_token;
  }
},{timeout:120000});
after(async()=>{await app?.close();await new Promise<void>(resolve=>provider?.close(()=>resolve()));});
async function request(path:string,actor='student',method='GET',data?:unknown){const response=await fetch(`${base}${university}${path}`,{method,headers:{Authorization:`Bearer ${tokens[actor]}`,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,body:await response.json()};}
function payload(runtime:RuntimeId,starter=RUNTIME_CATALOG.find(item=>item.id===runtime)!.starterCode){return {title:`Framework contract ${runtime}`,course_offering_id:ids.offering,opens_at:new Date(Date.now()-1000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:30,requires_code:false,questions:[{type:'CODE',runtime,title:'Projet synthétique',statement:'Modifiez ce projet pour le test de contrat.',points:20,starter_code:starter}]};}
async function attempt(runtime:RuntimeId){
  const created=await request('/assessments','teacher','POST',payload(runtime));assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal((await request(`/assessments/${created.body.id}/publish`,'teacher','POST',{})).status,201);
  const started=await request(`/assessments/${created.body.id}/attempts`,'student','POST',{});assert.equal(started.status,201);
  const copy=await request(`/attempts/${started.body.id}`),question=copy.body.questions[0];
  const source=RUNTIME_CATALOG.find(item=>item.id===runtime)!.starterCode;
  assert.equal((await request(`/attempts/${started.body.id}/answers/${question.id}`,'student','PUT',{answer_text:source,expected_version:0})).status,200);
  return {id:started.body.id as string,question:question.id as string,source};
}
async function completed(runtime:RuntimeId='react'){
  const work=await attempt(runtime);providerId=randomUUID();const response=await request(`/attempts/${work.id}/questions/${work.question}/runs`,'student','POST',{expected_version:1,stdin:''});assert.equal(response.status,201,JSON.stringify(response.body));
  const id=response.body.id as string;await execution.tick();await app.database.privileged(c=>c.query("update private.execution_jobs set next_poll_at=clock_timestamp()-interval '1 second' where id=$1",[id]));await execution.tick();
  return {...work,run:id};
}

test('preview endpoint checks owner before provider access; run JSON never exposes the artifact or private provider fields',async()=>{
  const work=await completed();const endpoint=`/attempts/${work.id}/runs/${work.run}`;
  const result=await request(endpoint);assert.equal(result.status,200);assert.equal(result.body.status,'SUCCEEDED');
  const publicJson=JSON.stringify(result.body);assert.ok(!publicJson.includes(providerId));assert.ok(!publicJson.includes(secret));assert.doesNotMatch(publicJson,/preview_html|provider_token|source_code|<html|TEST-CONTRACT PREVIEW/);
  const calls=providerCalls;
  for(const actor of ['other','teacher'])assert.equal((await request(endpoint+'/preview',actor)).status,404);
  assert.equal((await request(endpoint+'/preview','foreign')).status,403);
  assert.equal((await request(`/attempts/${randomUUID()}/runs/${work.run}/preview`)).status,404);assert.equal(providerCalls,calls);
  const before=previewCalls,preview=await request(endpoint+'/preview');assert.equal(preview.status,200);assert.deepEqual(preview.body,{html});assert.equal(previewCalls,before+1);
  assert.ok(!JSON.stringify(preview.body).includes(providerId));assert.ok(!JSON.stringify(preview.body).includes(secret));
  const columns=await app.database.privileged(c=>c.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='private' and table_name='execution_jobs'"));assert.ok(!columns.rows.some(row=>/html|artifact|bundle/.test(row.column_name)));
});
test('expired or oversized previews become410 while the saved result remains available',async()=>{
  const work=await completed('angular'),endpoint=`/attempts/${work.id}/runs/${work.run}`;
  const original=html;
  try{
    previewStatus=410;assert.equal((await request(endpoint+'/preview')).status,410);
    previewStatus=404;assert.equal((await request(endpoint+'/preview')).status,410);
    previewStatus=200;html='é'.repeat(1024*1024+1);assert.equal((await request(endpoint+'/preview')).status,410);
    assert.equal((await request(endpoint)).body.status,'SUCCEEDED');
  }finally{previewStatus=200;html=original;}
});
test('non-framework or unfinished jobs cannot fetch provider previews',async()=>{
  const work=await completed('php'),endpoint=`/attempts/${work.id}/runs/${work.run}/preview`;let calls=providerCalls;
  assert.equal((await request(endpoint)).status,404);assert.equal(providerCalls,calls);
  const framework=await completed('react');await app.database.privileged(c=>c.query("update private.execution_jobs set status='COMPILE_ERROR' where id=$1",[framework.run]));calls=providerCalls;
  assert.equal((await request(`/attempts/${framework.id}/runs/${framework.run}/preview`)).status,404);assert.equal(providerCalls,calls);
});
test('framework starters and saved answers reject a different runtime, arbitrary paths, packages and missing files atomically',async()=>{
  for(const framework of frameworkIds){
    const project=defaultFrameworkProjects[framework],work=await attempt(framework);
    const different:FrameworkId=framework==='react'?'angular':'react';
    const missing={...project.files} as Record<string,string>;delete missing[Object.keys(missing)[0]];
    const invalid=[defaultFrameworkProjects[different],{...project,files:{...project.files,'../outside.ts':'x'}},{...project,files:{...project.files,'package.json':'{}'}},{...project,files:missing}];
    for(const value of invalid){
      const source=JSON.stringify(value);assert.equal((await request('/assessments','teacher','POST',payload(framework,source))).status,400);
      assert.equal((await request(`/attempts/${work.id}/answers/${work.question}`,'student','PUT',{answer_text:source,expected_version:1})).status,400);
    }
    const current=await request(`/attempts/${work.id}`),saved=current.body.answers.find((answer:{question_id:string})=>answer.question_id===work.question);assert.equal(saved.answer_text,work.source);assert.equal(saved.version,1);
  }
});

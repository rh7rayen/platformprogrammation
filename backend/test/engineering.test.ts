import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app';
import {loadConfig} from '../src/config';
import {demoIds as ids} from '../src/database/seed';
import {engineeringDemo,seedEngineering} from '../src/database/seed-engineering';
import {parseWebProject} from '../../packages/contracts/src/runtimes';
let app:Awaited<ReturnType<typeof createApp>>,base:string;
const tokens:Record<string,string>={};
before(async()=>{
  app=await createApp(loadConfig({APP_MODE:'demo',NODE_ENV:'test',RUNNER_ENABLED:'false',EMAIL_ENABLED:'false',AI_ENABLED:'false',RECORDINGS_ENABLED:'false'}),{memory:true,quiet:true});
  await seedEngineering(app.database);
  await app.app.listen(0,'127.0.0.1');base=`${await app.app.getUrl()}/api/v1`;
  for(const [key,id] of Object.entries({lina:ids.engineeringStudent,sami:ids.engineeringTeacher,nour:ids.student,yassine:ids.teacher})){
    const r=await fetch(`${base}/auth/demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:id})});
    assert.equal(r.status,201);tokens[key]=(await r.json()).access_token;
  }
},{timeout:120000});
after(async()=>{await app?.close();});
async function request(path:string,actor='lina',method='GET',body?:unknown){
  const r=await fetch(`${base}/universities/${ids.university}${path}`,{method,headers:{Authorization:`Bearer ${tokens[actor]}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
}
test('engineering accounts have a dedicated class and three exams without changing historical student/teacher scope',async()=>{
  assert.equal((await request('/academic-structure/subjects','yassine')).body.total,3);
  assert.deepEqual((await request('/academic-structure/classes','nour')).body.data.map((c:{id:string})=>c.id),[ids.class]);
  assert.equal((await request('/academic-structure/subjects','sami')).body.total,3);
  const classes=(await request('/academic-structure/classes')).body.data;assert.equal(classes.length,1);assert.equal(classes[0].code,'ING1-A');
  const assessments=(await request('/assessments')).body.data;
  assert.equal(assessments.length,3);assert.ok(assessments.every((a:{publication_status:string;question_count:number})=>a.publication_status==='PUBLISHED'&&a.question_count===1));
  assert.equal((await request('/assessments','nour')).body.data.length,1);
});
test('Lina opens PHP, Java and Web with personal demo codes; reseeding preserves deadlines and saved work',async()=>{
  for(const runtime of ['php','java','web'] as const){
    const id=engineeringDemo.assessments[runtime],code=engineeringDemo.codes[runtime];
    assert.equal((await request(`/assessments/${id}/attempts`,'lina','POST',{})).status,403);
    assert.equal((await request('/assessment-access/redeem','nour','POST',{code})).status,400);
    assert.equal((await request('/assessment-access/redeem','lina','POST',{code})).status,201);
    const started=await request(`/assessments/${id}/attempts`,'lina','POST',{});assert.equal(started.status,201,JSON.stringify(started.body));
    const attempt=started.body.id,before=(await request(`/attempts/${attempt}`)).body,q=before.questions[0];
    assert.equal(q.runtime,runtime);assert.ok(!('expected_option_id' in q));
    if(runtime==='web')assert.deepEqual(Object.keys(parseWebProject(q.starter_code).files),['index.html','style.css','script.js']);
    const source=runtime==='php'?'<?php echo "Copie Lina";':q.starter_code;
    assert.equal((await request(`/attempts/${attempt}/answers/${q.id}`,'lina','PUT',{answer_text:source,expected_version:0})).status,200);
    await seedEngineering(app.database);
    const after=(await request(`/attempts/${attempt}`)).body;
    assert.equal(after.attempt.started_at,before.attempt.started_at);assert.equal(after.attempt.deadline,before.attempt.deadline);
    assert.equal(after.answers[0].answer_text,source);assert.equal(after.answers[0].version,1);
    assert.equal((await request(`/assessments/${id}/attempts`,'lina','POST',{})).body.id,attempt);
    assert.equal((await request(`/attempts/${attempt}/questions/${q.id}/runs`,'lina','POST',{expected_version:1})).status,503);
    assert.equal((await request(`/attempts/${attempt}`,'nour')).status,404);
  }
});

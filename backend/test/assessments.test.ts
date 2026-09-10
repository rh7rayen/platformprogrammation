import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app';
import {loadConfig} from '../src/config';
import {demoIds as ids} from '../src/database/seed';
import {AssessmentService} from '../src/assessments/assessment.service';
let runtime:Awaited<ReturnType<typeof createApp>>,base:string;
const tokens:Record<string,string>={};
const u=`/universities/${ids.university}`,exam='80000000-0000-4000-8000-000000000001';
let attempt:string,questions:{id:string;type:string}[];
before(async()=>{
  runtime=await createApp(loadConfig({APP_MODE:'demo',NODE_ENV:'test',AI_ENABLED:'false',RUNNER_ENABLED:'false',EMAIL_ENABLED:'false',RECORDINGS_ENABLED:'false'}),{memory:true,quiet:true});
  await runtime.app.listen(0,'127.0.0.1');base=`${await runtime.app.getUrl()}/api/v1`;
  for(const [key,id] of Object.entries({teacher:ids.teacher,student:ids.student,other:ids.otherStudent,admin:ids.admin,foreign:ids.otherAdmin})){
    const r=await fetch(`${base}/auth/demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:id})});tokens[key]=(await r.json()).access_token;
  }
},{timeout:120000});
after(async()=>{await runtime?.close();});
async function request(path:string,actor='student',method='GET',body?:unknown){const r=await fetch(`${base}${u}${path}`,{method,headers:{Authorization:`Bearer ${tokens[actor]}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const payload=()=>({title:'Examen créé par le test',description:'Test de publication',course_offering_id:ids.offering,kind:'EXAM',opens_at:new Date(Date.now()-60000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:10,requires_code:true,allow_paste:false,questions:[{type:'LONG_TEXT',title:'Expliquer une boucle',statement:'Expliquez le principe de la boucle for.',points:10}]});
test('metadata is visible before starting, questions and teacher solutions are private',async()=>{
  const result=await request('/assessments');assert.equal(result.status,200);assert.equal(result.body.data[0].question_count,2);assert.equal(result.body.data[0].total_points,20);
  assert.equal((await request(`/assessments/${exam}`)).status,403);
  assert.deepEqual((await request('/assessments','other')).body.data,[]);
  assert.equal((await request('/assessments','foreign')).status,403);
  await runtime.database.asUser(ids.student,async c=>{
    assert.equal((await c.query('select * from public.assessment_questions')).rows.length,0);
    assert.equal((await c.query('select * from private.assessment_solutions')).rows.length,0);
  });
});
test('personal code is required and cannot be used by a different student',async()=>{
  assert.equal((await request(`/assessments/${exam}/attempts`,'student','POST',{})).status,403);
  assert.equal((await request('/assessment-access/redeem','other','POST',{code:'PYTHON-DEMO'})).status,400);
  assert.equal((await request('/assessment-access/redeem','student','POST',{code:'WRONG-CODE'})).status,400);
  assert.equal((await request('/assessment-access/redeem','student','POST',{code:'python-demo'})).status,201);
});
test('concurrent starts produce one durable attempt with a server deadline',async()=>{
  const [a,b]=await Promise.all([request(`/assessments/${exam}/attempts`,'student','POST',{}),request(`/assessments/${exam}/attempts`,'student','POST',{})]);
  assert.equal(a.status,201,JSON.stringify(a.body));assert.equal(b.status,201,JSON.stringify(b.body));assert.equal(a.body.id,b.body.id);attempt=a.body.id;
  assert.ok(Math.abs(Date.parse(a.body.deadline)-Date.parse(a.body.started_at)-3600000)<100);
  const data=await request(`/attempts/${attempt}`);assert.equal(data.status,200);questions=data.body.questions;assert.equal(questions.length,2);assert.equal(data.body.results,null);assert.ok(!JSON.stringify(data.body).includes('expected_option_id'));
  assert.equal((await request(`/attempts/${attempt}`,'other')).status,404);
});
test('saving uses optimistic versions and rejects unrelated questions and bad choices',async()=>{
  const q=questions.find(q=>q.type==='CODE')!;
  const saved=await request(`/attempts/${attempt}/answers/${q.id}`,'student','PUT',{answer_text:'print(14)',expected_version:0});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.version,1);
  assert.equal((await request(`/attempts/${attempt}/answers/${q.id}`,'student','PUT',{answer_text:'overwrite',expected_version:0})).status,409);
  assert.equal((await request(`/attempts/${attempt}/answers/${ids.subject}`,'student','PUT',{answer_text:'wrong question',expected_version:0})).status,404);
  const choice=questions.find(q=>q.type==='SINGLE_CHOICE')!;
  assert.equal((await request(`/attempts/${attempt}/answers/${choice.id}`,'student','PUT',{answer_text:'invalid',expected_version:0})).status,400);
  assert.equal((await request(`/attempts/${attempt}/answers/${choice.id}`,'student','PUT',{answer_text:'a',expected_version:0})).status,200);
  assert.equal((await request(`/attempts/${attempt}/questions/${q.id}/runs`,'student','POST',{})).status,503);
  const reload=await request(`/attempts/${attempt}`);assert.equal(reload.body.answers.find((a:{question_id:string})=>a.question_id===q.id).answer_text,'print(14)');
});
test('submission is idempotent, locks answers and withholds results',async()=>{
  const a=await request(`/attempts/${attempt}/finalize`,'student','POST',{}),b=await request(`/attempts/${attempt}/finalize`,'student','POST',{});
  assert.equal(a.status,201,JSON.stringify(a.body));assert.equal(a.body.status,'SUBMITTED');assert.equal(a.body.submitted_at,b.body.submitted_at);
  assert.equal((await request(`/attempts/${attempt}/answers/${questions[0].id}`,'student','PUT',{answer_text:'late',expected_version:1})).status,410);
  assert.equal((await request(`/attempts/${attempt}`)).body.results,null);
  const rows=await request(`/assessments/${exam}/submissions`,'teacher');assert.equal(rows.status,200);assert.equal(rows.body.data.length,1);assert.equal(rows.body.data[0].total_score,5);assert.equal(rows.body.data[0].pending_count,1);
  assert.equal((await request(`/assessments/${exam}/submissions`,'admin')).status,403);
  const id=rows.body.data[0].id,q=questions[0].id;
  assert.equal((await request(`/assessments/${exam}/submissions/${id}/grades`,'teacher','POST',{question_id:q,score:16,feedback:'Trop haut',expected_version:0})).status,400);
  assert.equal((await request(`/assessments/${exam}/submissions/${id}/grades`,'teacher','POST',{question_id:q,score:10,feedback:'Bonne démarche',expected_version:0})).status,201);
  assert.equal((await request(`/assessments/${exam}/submissions/${id}/grades`,'teacher','POST',{question_id:q,score:11,feedback:'Conflit',expected_version:0})).status,409);
  assert.equal((await request(`/assessments/${exam}/results/publish`,'teacher','POST',{})).status,409);
});
test('teacher creates, edits and publishes; students cannot author; published content is immutable',async()=>{
  assert.equal((await request('/assessments','student','POST',payload())).status,403);
  const created=await request('/assessments','teacher','POST',payload());assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.id;
  assert.equal((await request(`/assessments/${id}`,'teacher','PUT',{...payload(),title:'Devoir mis à jour'})).status,200);
  const publication=await request(`/assessments/${id}/publish`,'teacher','POST',{});assert.equal(publication.status,201,JSON.stringify(publication.body));assert.equal(publication.body.email_delivery,'NOT_SENT');assert.equal(publication.body.access_codes.length,1);
  assert.equal((await request(`/assessments/${id}`,'teacher','PUT',payload())).status,409);
  assert.deepEqual((await request(`/assessments/${id}/publish`,'teacher','POST',{})).body.access_codes,[]);
  const code=publication.body.access_codes[0].code;
  assert.equal((await request('/assessment-access/redeem','student','POST',{code})).status,201);
  const start=await request(`/assessments/${id}/attempts`,'student','POST',{});assert.equal(start.status,201);
  await runtime.database.privileged(c=>c.query("update public.attempts set deadline=clock_timestamp()-interval '1 second' where id=$1",[start.body.id]));
  await runtime.app.get(AssessmentService).sweepExpired();
  const expired=await request(`/attempts/${start.body.id}`);assert.equal(expired.body.attempt.status,'AUTO_SUBMITTED');
  assert.equal((await request(`/assessments/${id}/submissions`,'teacher')).body.data.length,1);
});
test('results remain hidden until all corrections are complete and the period is closed',async()=>{
  const closes=Date.now()+2000;
  const created=await request('/assessments','teacher','POST',{...payload(),requires_code:false,closes_at:new Date(closes).toISOString()});
  assert.equal(created.status,201);const id=created.body.id;
  assert.equal((await request(`/assessments/${id}/publish`,'teacher','POST',{})).status,201);
  const started=await request(`/assessments/${id}/attempts`,'student','POST',{});assert.equal(started.status,201);const t=started.body.id;
  await assert.rejects(runtime.database.asUser(ids.student,c=>c.query("update public.attempts set deadline=now()+interval '1 day' where id=$1",[t])),/permission denied/);
  assert.equal((await request(`/attempts/${t}/finalize`,'student','POST',{})).status,201);
  const rows=await request(`/assessments/${id}/submissions`,'teacher'),s=rows.body.data[0].id;
  const copy=await request(`/assessments/${id}/submissions/${s}`,'teacher'),q=copy.body.answers[0].question_id;
  assert.equal((await request(`/assessments/${id}/submissions/${s}/grades`,'teacher','POST',{question_id:q,score:7,feedback:'Correction manuelle validée.',expected_version:0})).status,201);
  assert.equal((await request(`/attempts/${t}`)).body.results,null);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,closes-Date.now()+30)));
  const release=await request(`/assessments/${id}/results/publish`,'teacher','POST',{});assert.equal(release.status,201,JSON.stringify(release.body));
  const results=(await request(`/attempts/${t}`)).body.results;assert.equal(results.total_score,7);assert.equal(results.answers[0].feedback,'Correction manuelle validée.');
  assert.equal((await request(`/assessments/${id}/submissions/${s}/grades`,'teacher','POST',{question_id:q,score:8,feedback:'Après publication',expected_version:1})).status,409);
});
test('submitted copies remain reviewable when the student moves to another class',async()=>{
  const before=await request(`/assessments/${exam}/submissions`,'teacher');
  assert.equal(before.body.data.length,1);
  const original=(await runtime.database.privileged(c=>c.query<{id:string;class_id:string;group_id:string|null}>('select id,class_id,group_id from public.enrollments where student_id=$1',[ids.student]))).rows;
  await runtime.database.privileged(c=>c.query('update public.enrollments set class_id=$2,group_id=null where student_id=$1',[ids.student,ids.otherClass]));
  try{
    const visible=await runtime.database.asUser(ids.teacher,c=>c.query('select id from public.profiles where id=$1',[ids.student]));
    assert.equal(visible.rows.length,0);
    const after=await request(`/assessments/${exam}/submissions`,'teacher');
    assert.equal(after.body.data.length,1);
    assert.equal(after.body.data[0].id,before.body.data[0].id);
    assert.equal(after.body.data[0].student_name,'Étudiant (profil non visible)');
  }finally{for(const row of original)await runtime.database.privileged(c=>c.query('update public.enrollments set class_id=$2,group_id=$3 where id=$1',[row.id,row.class_id,row.group_id]));}
});

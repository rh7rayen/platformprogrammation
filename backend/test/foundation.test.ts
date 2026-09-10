import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { demoIds as ids } from '../src/database/seed';
import { parseProviderOutput } from '../src/ai/ai.service';
let runtime:Awaited<ReturnType<typeof createApp>>;
let base:string;
const tokens:Record<string,string>={};
before(async()=>{
  runtime=await createApp(loadConfig({APP_MODE:'demo',NODE_ENV:'test',AI_ENABLED:'false',RUNNER_ENABLED:'false',EMAIL_ENABLED:'false',RECORDINGS_ENABLED:'false',HOST:'127.0.0.1'}),{memory:true,quiet:true});
  await runtime.app.listen(0,'127.0.0.1');
  base=`${await runtime.app.getUrl()}/api/v1`;
  for(const [name,id] of Object.entries({admin:ids.admin,teacher:ids.teacher,student:ids.student,otherStudent:ids.otherStudent,otherAdmin:ids.otherAdmin})) {
    const result=await fetch(`${base}/auth/demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:id})});
    assert.equal(result.status,201);
    tokens[name]=(await result.json()).access_token;
  }
}, {timeout:120000});
after(async()=>{await runtime?.close();});
async function request(path:string,actor='admin',method='GET',body?:unknown) {
  const response=await fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${tokens[actor]}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
const uni=`/universities/${ids.university}`;
test('health and active identity use the real API and database',async()=>{
  assert.equal((await request('/health/ready')).status,200);
  const profile=await request('/auth/me','teacher');
  assert.equal(profile.body.user.id,ids.teacher);
  assert.equal(profile.body.universities.length,1);
});
test('missing or forged authentication is rejected',async()=>{
  assert.equal((await fetch(`${base}${uni}/dashboard`)).status,401);
  assert.equal((await request(`${uni}/dashboard`,'not-a-user')).status,401);
});
test('Supabase authenticated role cannot bypass the API session boundary',async()=>{
  await assert.rejects(runtime.database.privileged(async c=>{
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.student]);
    await c.query('set local role authenticated');
    await c.query('select * from public.subjects');
  }),/permission denied/);
});
test('university isolation is enforced for reads and writes',async()=>{
  assert.equal((await request(`${uni}/dashboard`,'otherAdmin')).status,403);
  assert.equal((await request(`${uni}/academic-structure/departments`,'otherAdmin','POST',{name:'Intrusion',code:'NO'})).status,403);
});
test('student only sees their own class, enrollments and profile',async()=>{
  const classes=await request(`${uni}/academic-structure/classes`,'student');
  assert.deepEqual(classes.body.data.map((r:{id:string})=>r.id),[ids.class]);
  const enrollments=await request(`${uni}/enrollments`,'student');
  assert.deepEqual(enrollments.body.data.map((r:{student_id:string})=>r.student_id),[ids.student]);
  const users=await request(`${uni}/users`,'student');
  assert.deepEqual(users.body.data.map((r:{id:string})=>r.id),[ids.student]);
});
test('teacher and student subject lists follow teaching assignments and enrollments',async()=>{
  const subjects=await request(`${uni}/academic-structure/subjects`,'teacher');
  assert.equal(subjects.body.total,3);
  assert.equal(subjects.body.data.some((s:{id:string})=>s.id===ids.otherSubject),false);
  const literature=await request(`${uni}/academic-structure/subjects`,'otherStudent');
  assert.equal(literature.body.total,1);
  assert.equal(literature.body.data[0].id,ids.otherSubject);
});
test('combining teacher and student roles does not expose classmates in a class not taught',async()=>{
  await request(`${uni}/memberships`,'admin','POST',{user_id:ids.teacher,role:'STUDENT'});
  assert.equal((await request(`${uni}/enrollments`,'admin','POST',{student_id:ids.teacher,class_id:ids.otherClass})).status,201);
  const people=await request(`${uni}/users`,'teacher');
  assert.equal(people.body.data.some((p:{id:string})=>p.id===ids.otherStudent),false);
  const enrollments=await request(`${uni}/enrollments`,'teacher');
  assert.equal(enrollments.body.data.some((e:{student_id:string})=>e.student_id===ids.otherStudent),false);
});
test('admin can persist a department; duplicates and invalid inputs fail',async()=>{
  const result=await request(`${uni}/academic-structure/departments`,'admin','POST',{name:'Sciences physiques',code:'PHYS'});
  assert.equal(result.status,201);
  const rows=await request(`${uni}/academic-structure/departments?search=physiques`);
  assert.equal(rows.body.total,1);
  assert.equal(rows.body.data[0].id,result.body.id);
  assert.equal((await request(`${uni}/academic-structure/departments`,'admin','POST',{name:'Autre',code:'PHYS'})).status,409);
  assert.equal((await request(`${uni}/academic-structure/departments`,'admin','POST',{name:'x',code:'a',university_id:ids.otherUniversity})).status,400);
});
test('student cannot create structure or elevate privileges',async()=>{
  assert.equal((await request(`${uni}/academic-structure/departments`,'student','POST',{name:'Forbidden',code:'FORB'})).status,403);
  assert.equal((await request(`${uni}/memberships`,'student','POST',{user_id:ids.student,role:'UNIVERSITY_ADMIN'})).status,403);
  assert.equal((await request(`${uni}/memberships`,'admin','POST',{user_id:ids.admin,role:'SUPER_ADMIN'})).status,400);
});
test('cross-university foreign keys reject association to another tenant',async()=>{
  const department=await request(`/universities/${ids.otherUniversity}/academic-structure/departments`,'otherAdmin','POST',{name:'Étranger',code:'EXT'});
  assert.equal(department.status,201);
  const result=await request(`${uni}/academic-structure/subjects`,'admin','POST',{name:'Matière étrangère',code:'EXT',department_id:department.body.id,coefficient:2});
  assert.equal(result.status,400);
});
test('calendar and class consistency is validated in SQL',async()=>{
  const result=await request(`${uni}/academic-structure/semesters`,'admin','POST',{name:'Hors année',academic_year_id:'70000000-0000-4000-8000-000000000040',starts_on:'2030-01-01',ends_on:'2030-06-01'});
  assert.equal(result.status,400);
});
test('a scoped manager cannot modify another department or promote users',async()=>{
  const membership=await request(`${uni}/memberships`,'admin','POST',{user_id:ids.otherStudent,role:'ACADEMIC_MANAGER',department_id:ids.letters});
  assert.equal(membership.status,201);
  const denied=await request(`${uni}/academic-structure/subjects`,'otherStudent','POST',{name:'Out of scope',code:'OOS',department_id:ids.department,coefficient:2});
  assert.equal(denied.status,403);
  const allowed=await request(`${uni}/academic-structure/subjects`,'otherStudent','POST',{name:'Poésie',code:'POET',department_id:ids.letters,coefficient:2});
  assert.equal(allowed.status,201);
});
test('suspension immediately removes university access and is audited',async()=>{
  const result=await request(`${uni}/users/${ids.otherStudent}/status`,'admin','PATCH',{status:'SUSPENDED'});
  assert.equal(result.status,200);
  assert.equal((await request(`${uni}/dashboard`,'otherStudent')).status,403);
  const audit=await request(`${uni}/audit`);
  assert.ok(audit.body.data.some((row:{action:string;resource_type:string})=>row.action==='UPDATE'&&row.resource_type==='university_memberships'));
  assert.equal((await request(`${uni}/audit`,'student')).body.data.length,0);
});
test('AI fails closed without provider credentials and never exposes answer drafts to students',async()=>{
  const payload={subject_id:ids.subject,topic:'Les boucles et les listes Python',count:2,difficulty:'beginner'};
  assert.equal((await request(`${uni}/ai/drafts`,'student','POST',payload)).status,403);
  assert.equal((await request(`${uni}/ai/drafts`,'teacher','POST',payload)).status,503);
  assert.deepEqual((await request(`${uni}/ai/drafts`,'student')).body.data,[]);
});
test('provider output validator rejects refusals, partial output and bad answer indexes',()=>{
  assert.throws(()=>parseProviderOutput({status:'incomplete',output:[]}));
  assert.throws(()=>parseProviderOutput({status:'completed',output:[{type:'message',content:[{type:'refusal',text:'No'}]}]}));
  const questions=[{title:'Question',statement:'Quel est le résultat ?',options:['A','B','C','D'],correct_option:4,explanation:'Explication claire.'}];
  const body=()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({questions})}]}]});
  assert.throws(()=>parseProviderOutput(body()));
  questions[0].correct_option=1;
  assert.equal(parseProviderOutput(body()).questions[0].correct_option,1);
});
test('logout durably revokes the application session',async()=>{
  assert.equal((await request('/auth/logout','teacher','POST',{})).status,201);
  assert.equal((await request('/auth/me','teacher')).status,401);
});
test('demo auth refuses production and non-loopback configurations',()=>{
  assert.throws(()=>loadConfig({APP_MODE:'demo',NODE_ENV:'production'}));
  assert.throws(()=>loadConfig({APP_MODE:'demo',HOST:'0.0.0.0'}));
});

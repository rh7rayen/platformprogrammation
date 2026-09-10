import 'reflect-metadata';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {HttpException} from '@nestjs/common';
import {createApp} from '../src/app';
import {loadConfig} from '../src/config';
import {demoIds as ids} from '../src/database/seed';
import {AcademicService} from '../src/academic/academic.service';
import {AssessmentService} from '../src/assessments/assessment.service';
import {IntegrityService} from '../src/integrity/integrity.service';
import {compareCodeSamples,type CodeSample} from '../src/integrity/code-similarity';
import {assessmentSchema} from '../../packages/contracts/src/assessments';
import {defaultWebProject} from '../../packages/contracts/src/runtimes';

const code='def weighted_average(values, weights):\n    weighted_total = sum(value * weight for value, weight in zip(values, weights))\n    weight_sum = sum(weights)\n    if weight_sum == 0:\n        return 0\n    return weighted_total / weight_sum\nprint(weighted_average([10, 20, 30], [2, 3, 4]))';
const base:CodeSample={submission_id:'copy-a',student_id:'student-a',student_name:'Étudiant A',question_id:'question-code',question_title:'Moyenne pondérée',runtime:'python',starter_code:'# Écrivez votre programme\n',answer_text:code};
test('lexical comparison ignores spaces and comments without inventing an AI probability',()=>{
  const report=compareCodeSamples([base,{...base,submission_id:'copy-b',student_id:'student-b',student_name:'Étudiant B',answer_text:code.replaceAll(' = ','=').replaceAll('\n','\n# commentaire\n')}]);
  assert.equal(report.matches.length,1);assert.equal(report.matches[0].jaccard_percent,100);assert.equal(report.matches[0].overlap_percent,100);
  assert.ok(report.matches[0].shared_sequences>=12);assert.ok(report.matches[0].left.excerpt.length<=180);assert.ok(!('ai_probability'in report));
});
test('starter-only, short and different-question answers are excluded',()=>{
  const starter={...base,starter_code:code};
  assert.equal(compareCodeSamples([starter,{...starter,student_id:'student-b'}]).matches.length,0);
  assert.equal(compareCodeSamples([{...base,answer_text:'print(1)'},{...base,student_id:'student-b',answer_text:'print(1)'}]).ignored_answers,2);
  assert.equal(compareCodeSamples([base,{...base,student_id:'student-b',question_id:'another-question'}]).comparisons,0);
});
test('Web projects compare source files and omit the common starter',()=>{
  const project={...defaultWebProject,files:{...defaultWebProject.files,'script.js':'function calculateAverage(numbers) { const total = numbers.reduce((sum, value) => sum + value, 0); const count = numbers.length; if (count === 0) return 0; return total / count; } console.log(calculateAverage([2, 4, 8]));'}};
  const a={...base,runtime:'web',starter_code:JSON.stringify(defaultWebProject),answer_text:JSON.stringify(project)};
  const report=compareCodeSamples([a,{...a,student_id:'student-b',submission_id:'copy-b'}]);assert.equal(report.matches.length,1);assert.equal(report.matches[0].jaccard_percent,100);
});
test('token truncation is reported and result count remains bounded',()=>{
  const long={...base,answer_text:Array.from({length:1500},(_,i)=>`variable${i} = ${i}`).join('\n')};
  const report=compareCodeSamples(Array.from({length:15},(_,i)=>({...long,student_id:`student-${i}`,submission_id:`copy-${i}`})));
  assert.equal(report.truncated_answers,15);assert.equal(report.matches.length,50);assert.equal(report.matching_pairs,105);
});

let runtime:Awaited<ReturnType<typeof createApp>>,service:IntegrityService,assessment:string,question:string;
const fails=(status:number)=>(e:unknown)=>e instanceof HttpException&&e.getStatus()===status;
before(async()=>{
  runtime=await createApp(loadConfig({APP_MODE:'demo',NODE_ENV:'test',AI_ENABLED:'false',RUNNER_ENABLED:'false',EMAIL_ENABLED:'false',RECORDINGS_ENABLED:'false'}),{memory:true,quiet:true});
  service=new IntegrityService(runtime.app.get(AcademicService));
  const exams=runtime.app.get(AssessmentService);
  const input=assessmentSchema.parse({title:'Analyse des copies',description:'Comparer des programmes.',course_offering_id:ids.offering,kind:'PRACTICAL',opens_at:new Date(Date.now()-60000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:10,requires_code:false,questions:[{type:'CODE',title:'Moyenne pondérée',statement:'Écrivez une fonction qui calcule une moyenne pondérée.',runtime:'python',starter_code:base.starter_code,points:20}]});
  assessment=(await exams.create(ids.teacher,ids.university,input)).id;
  await exams.publish(ids.teacher,ids.university,assessment);
  await runtime.database.privileged(c=>c.query('insert into public.assessment_assignments(university_id,assessment_id,student_id) values($1,$2,$3)',[ids.university,assessment,ids.otherStudent]));
  for(const student of [ids.student,ids.otherStudent]){
    const attempt=await exams.start(student,ids.university,assessment);const data=await exams.attempt(student,ids.university,attempt.id);question=data.questions[0].id;
    await exams.save(student,ids.university,attempt.id,question,code,0);await exams.finalize(student,ids.university,attempt.id);
  }
},{timeout:120000});
after(async()=>{await runtime?.close();});
test('only the assigned teacher may analyze, including before results publication',async()=>{
  const report=await service.analyze(ids.teacher,ids.university,assessment);assert.equal(report.copies_analyzed,2);assert.equal(report.matches.length,1);assert.equal(report.matches[0].jaccard_percent,100);assert.ok(report.notice.includes('ne prouvent pas une fraude'));
  await assert.rejects(service.analyze(ids.student,ids.university,assessment),fails(404));
  await assert.rejects(service.analyze(ids.admin,ids.university,assessment),fails(404));
  await assert.rejects(service.analyze(ids.languageTeacher,ids.university,assessment),fails(404));
  await assert.rejects(service.analyze(ids.otherAdmin,ids.university,assessment),fails(403));
  await assert.rejects(service.analyze(ids.teacher,ids.otherUniversity,assessment),fails(403));
  const grades=await runtime.database.privileged(c=>c.query<{score:unknown;grade_version:number}>('select score,grade_version from public.submission_answers where assessment_id=$1',[assessment]));
  assert.ok(grades.rows.every(row=>row.score===null&&row.grade_version===0));
  assert.equal((await runtime.database.asUser(ids.student,c=>c.query('select * from public.submission_answers where assessment_id=$1',[assessment]))).rows.length,0);
});
test('large interactive analysis is rejected before copying answer bodies into application memory',async()=>{
  await runtime.database.privileged(c=>c.query('update public.submission_answers set answer_text=$1 where assessment_id=$2',[code.repeat(4000),assessment]));
  await assert.rejects(service.analyze(ids.teacher,ids.university,assessment),fails(400));
});

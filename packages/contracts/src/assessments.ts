import { z } from 'zod';
import { runtimeSchema,parseWebProject } from './runtimes';
import {isFrameworkRuntime,parseFrameworkProject} from './projects';
const optionSchema = z.object({ id:z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/),text:z.string().trim().min(1).max(1000) }).strict();
export const questionSchema=z.object({
  type:z.enum(['CODE','SINGLE_CHOICE','LONG_TEXT']),title:z.string().trim().min(2).max(150),
  statement:z.string().trim().min(5).max(10000),points:z.number().min(0.25).max(100),
  options:z.array(optionSchema).max(8).default([]),expected_option_id:z.string().nullable().default(null),
  starter_code:z.string().max(20000).default(''),runtime:runtimeSchema.nullable().default(null),
}).strict().superRefine((q,ctx)=>{
  if(q.type==='SINGLE_CHOICE'&&(q.options.length<2||new Set(q.options.map(o=>o.id)).size!==q.options.length||!q.options.some(o=>o.id===q.expected_option_id))) ctx.addIssue({code:'custom',message:'Un QCM nécessite des choix distincts et une bonne réponse valide.'});
  if(q.type!=='SINGLE_CHOICE'&&(q.options.length||q.expected_option_id!==null)) ctx.addIssue({code:'custom',message:'Les réponses attendues sont réservées aux QCM.'});
  if(q.type==='CODE'&&!q.runtime) ctx.addIssue({code:'custom',message:'Choisissez un langage pour une question de code.'});
  if(q.runtime==='web'&&q.starter_code!=='') { try { parseWebProject(q.starter_code); } catch { ctx.addIssue({code:'custom',message:'Le projet Web doit contenir index.html, style.css et script.js.'}); } }
  if(isFrameworkRuntime(q.runtime)&&q.starter_code!=='') { try { parseFrameworkProject(q.starter_code,q.runtime); } catch { ctx.addIssue({code:'custom',message:'Les fichiers du projet doivent correspondre au framework choisi.'}); } }
  if(q.type!=='CODE'&&(q.runtime!==null||q.starter_code!=='')) ctx.addIssue({code:'custom',message:'Un runtime et du code initial nécessitent une question de programmation.'});
});
export const assessmentSchema=z.object({
  title:z.string().trim().min(3).max(150),description:z.string().trim().max(5000).default(''),
  course_offering_id:z.uuid(),kind:z.enum(['QUIZ','HOMEWORK','EXAM','PRACTICAL']).default('EXAM'),
  opens_at:z.iso.datetime({offset:true}),closes_at:z.iso.datetime({offset:true}),
  duration_minutes:z.number().int().min(1).max(240),allow_paste:z.boolean().default(false),requires_code:z.boolean().default(true),
  questions:z.array(questionSchema).min(1).max(30),
}).strict().refine(a=>Date.parse(a.closes_at)>Date.parse(a.opens_at),'La fermeture doit suivre l’ouverture.');
export const answerSchema=z.object({answer_text:z.string().max(30000),expected_version:z.number().int().min(0)}).strict();
export const gradeSchema=z.object({question_id:z.uuid(),score:z.number().min(0).max(100),feedback:z.string().trim().min(2).max(3000),expected_version:z.number().int().min(0)}).strict();
export type AssessmentInput=z.infer<typeof assessmentSchema>;
export type QuestionInput=z.infer<typeof questionSchema>;
export type ExamQuestion=Omit<QuestionInput,'expected_option_id'> & {id:string;position:number};
export type AttemptStatus='IN_PROGRESS'|'SUBMITTED'|'AUTO_SUBMITTED';
export type AssessmentSummary={
  id:string;title:string;description:string;course_offering_id:string;kind:AssessmentInput['kind'];
  publication_status:'DRAFT'|'PUBLISHED';opens_at:string;closes_at:string;duration_minutes:number;
  allow_paste:boolean;requires_code:boolean;created_at:string;subject_name:string;class_name:string;
  can_manage:boolean;question_count:number;total_points:number;attempt_id:string|null;attempt_status:AttemptStatus|null;
  results_published_at:string|null;availability:'UPCOMING'|'OPEN'|'CLOSED';has_access:boolean;demo_code?:string;
};
export type AttemptData={
  attempt:{id:string;assessment_id:string;student_id:string;status:AttemptStatus;started_at:string;deadline:string;submitted_at:string|null};
  assessment:Pick<AssessmentSummary,'id'|'title'|'description'|'allow_paste'|'duration_minutes'|'kind'>;
  questions:ExamQuestion[];answers:{question_id:string;answer_text:string;version:number;saved_at:string}[];
  server_time:string;results:null|{total_score:number;total_points:number;answers:{question_id:string;score:number;feedback:string}[]};
};
export type ExamAccessCode={student_id:string;student_name:string;email:string;code:string};
export type SubmissionDetail={
  id:string;attempt_id:string;student_id:string;student_name:string;submitted_at:string;status:AttemptStatus;
  total_score:number;total_points:number;pending_count:number;
};
export type SubmissionAnswer={question_id:string;answer_text:string;score:number|null;max_points:number;feedback:string;grade_version:number;question:ExamQuestion};

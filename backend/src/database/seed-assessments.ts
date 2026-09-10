import { createHash } from 'node:crypto';
import type { Database } from './database';
import { demoIds as ids } from './seed';

export async function seedDemoAssessments(db:Database) {
  if(db.config.APP_MODE!=='demo') throw new Error('Demo only');
  await db.privileged(async c=>{
    const id='80000000-0000-4000-8000-000000000001';
    if((await c.query('select id from public.assessments where id=$1',[id])).rows.length) return;
    await c.query(`insert into public.assessments(id,university_id,course_offering_id,author_id,title,description,kind,opens_at,closes_at,duration_minutes,question_count,total_points)
      values($1,$2,$3,$4,'Python · Les listes et les fonctions','Un devoir de démonstration pour découvrir votre espace de programmation. Écrivez votre solution, répondez au QCM, puis remettez votre copie.','PRACTICAL',now()-interval '1 day',now()+interval '30 days',60,2,20)`,[id,ids.university,ids.offering,ids.teacher]);
    const questions=[
      {id:'81000000-0000-4000-8000-000000000001',type:'CODE',title:'Calculer la moyenne',statement:'Écrivez une fonction moyenne(notes) qui renvoie la moyenne des nombres de la liste. Si la liste est vide, renvoyez 0.\n\nExemple : moyenne([12, 16, 14]) doit renvoyer 14.\n\nComplétez la fonction dans main.py. Ajoutez ensuite deux exemples de votre choix.',points:15,options:[],starter:'# Devoir Python — listes et fonctions\n\ndef moyenne(notes):\n    # Écrivez votre solution ici\n    pass\n\n\nprint(moyenne([12, 16, 14]))\n',runtime:'python',expected:null},
      {id:'81000000-0000-4000-8000-000000000002',type:'SINGLE_CHOICE',title:'Comprendre len()',statement:'Quelle est la valeur de len([12, 16, 14]) en Python ?',points:5,options:[{id:'a',text:'3'},{id:'b',text:'42'},{id:'c',text:'14'}],starter:'',runtime:null,expected:'a'},
    ];
    for(const [position,q] of questions.entries()) {
      await c.query('insert into public.assessment_questions(id,university_id,assessment_id,position,type,title,statement,points,options,starter_code,runtime) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[q.id,ids.university,id,position,q.type,q.title,q.statement,q.points,JSON.stringify(q.options),q.starter,q.runtime]);
      await c.query('insert into private.assessment_solutions(question_id,university_id,assessment_id,expected_option_id) values($1,$2,$3,$4)',[q.id,ids.university,id,q.expected]);
    }
    await c.query('insert into public.assessment_assignments(university_id,assessment_id,student_id) values($1,$2,$3)',[ids.university,id,ids.student]);
    await c.query('insert into private.assessment_access_codes(university_id,assessment_id,student_id,code_hash) values($1,$2,$3,$4)',[ids.university,id,ids.student,createHash('sha256').update('PYTHONDEMO').digest('hex')]);
    await c.query("update public.assessments set publication_status='PUBLISHED',published_at=now() where id=$1",[id]);
  });
}

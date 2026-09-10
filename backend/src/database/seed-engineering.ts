import {createHash} from 'node:crypto';
import type {Database,SqlClient} from './database';
import {demoIds as ids} from './seed';
import type {RuntimeId,WebProject} from '../../../packages/contracts/src/runtimes';

export const engineeringDemo={
  class:'40000000-0000-4000-8000-000000000003',
  teacher:ids.engineeringTeacher,student:ids.engineeringStudent,
  assessments:{php:'80000000-0000-4000-8000-000000000005',java:'80000000-0000-4000-8000-000000000006',web:'80000000-0000-4000-8000-000000000007'},
  codes:{php:'DEMO-PHP',java:'DEMO-JAVA',web:'DEMO-WEB'},
} as const;
const exampleProject:WebProject={format:'uniexam-web-v1',files:{
  'index.html':'<main>\n  <p class="eyebrow">Ingénieur 1 · Atelier Web</p>\n  <h1>Mes tâches</h1>\n  <p>Construisez votre première application interactive.</p>\n  <form id="task-form">\n    <input id="task-input" placeholder="Une nouvelle tâche" aria-label="Nouvelle tâche" />\n    <button>Ajouter</button>\n  </form>\n  <ul id="tasks"></ul>\n</main>',
  'style.css':'body { font-family: system-ui; background: #eef5f2; color: #203b32; margin: 0; padding: 40px; }\nmain { max-width: 520px; margin: auto; background: white; padding: 32px; border-radius: 18px; }\n.eyebrow { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }\ninput, button { padding: 12px; border-radius: 8px; border: 1px solid #ccdcd5; }\nbutton { background: #236d51; color: white; cursor: pointer; }',
  'script.js':'// Écoutez la soumission du formulaire et ajoutez une tâche à la liste.\n// Empêchez le rechargement de la page et refusez les tâches vides.\n',
}};
type Exercise={runtime:RuntimeId;number:number;title:string;subject:string;code:string;statement:string;starter:string};
const exercises:Exercise[]=[
  {runtime:'php',number:5,title:'PHP · Calculer un panier',subject:'Développement PHP',code:'PHP-I1',statement:'Écrivez une fonction totalPanier(array $prix): float qui renvoie la somme des prix. Un panier vide doit renvoyer 0.\n\nExemples : totalPanier([10, 5.5, 3]) vaut 18.5 et totalPanier([]) vaut 0.\n\nComplétez main.php et ajoutez vos propres cas de test.',starter:'<?php\n// Ingénieur 1 — Calculer le total d’un panier\nfunction totalPanier(array $prix): float {\n    // Complétez cette fonction.\n    return 0;\n}\n\necho totalPanier([10, 5.5, 3]) . "\\n";\n'},
  {runtime:'java',number:6,title:'Java · Gestion des notes',subject:'Programmation Java',code:'JAVA-I1',statement:'Écrivez une méthode static double moyenne(double[] notes) qui calcule la moyenne. Renvoyez 0 si le tableau est vide.\n\nComplétez la classe Main, conservez son nom et testez votre méthode avec plusieurs tableaux.',starter:'public class Main {\n    static double moyenne(double[] notes) {\n        // Complétez votre algorithme.\n        return 0;\n    }\n\n    public static void main(String[] args) {\n        System.out.println(moyenne(new double[] {12, 16, 14}));\n    }\n}\n'},
  {runtime:'web',number:7,title:'Web · Créer une page interactive',subject:'Applications Web',code:'WEB-I1',statement:'Créez une liste de tâches interactive avec les trois fichiers du projet.\n\n1. Ajoutez au clic une tâche saisie par l’utilisateur.\n2. Refusez une saisie vide.\n3. Permettez de marquer une tâche comme terminée.\n4. Améliorez la mise en page en CSS.\n\nUtilisez l’aperçu intégré pour tester vos interactions, puis remettez les trois fichiers.',starter:JSON.stringify(exampleProject)},
];
async function insert(c:SqlClient,table:string,row:Record<string,unknown>){const keys=Object.keys(row);await c.query(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')}) on conflict do nothing`,Object.values(row));}

/** Called after seedDemo. Fixed identities preserve existing edits, deadlines and attempts. */
export async function seedEngineering(db:Database){
  if(db.config.APP_MODE!=='demo')throw new Error('Engineering demo data is forbidden on Supabase.');
  await db.privileged(async c=>{
    const u=ids.university,department=ids.department;
    const make=(table:string,row:Record<string,unknown>)=>insert(c,table,{university_id:u,...row});
    const auxiliary=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const identifier=(prefix:string,n:number)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    await make('programs',{id:auxiliary(13),name:'Cycle ingénieur informatique',code:'ING-INFO',department_id:department});
    await make('specialties',{id:auxiliary(23),name:'Ingénierie des applications',code:'ING-APP',program_id:auxiliary(13),department_id:department});
    await make('academic_levels',{id:auxiliary(31),name:'Ingénieur 1',code:'ING1',position:3});
    await make('classes',{id:engineeringDemo.class,name:'Ingénieur 1 · Développement logiciel',code:'ING1-A',department_id:department,specialty_id:auxiliary(23),academic_level_id:auxiliary(31),academic_year_id:auxiliary(40),capacity:30});
    await make('enrollments',{id:auxiliary(81),student_id:ids.engineeringStudent,class_id:engineeringDemo.class});
    for(const exercise of exercises){
      const n=exercise.number,subject=identifier('5',n),offering=identifier('6',n),assessment=identifier('8',n),question=`81000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
      await make('subjects',{id:subject,name:exercise.subject,code:exercise.code,description:`Atelier ${exercise.subject} du cycle ingénieur.`,department_id:department,coefficient:3,color:exercise.runtime==='php'?'violet':exercise.runtime==='java'?'peach':'mint'});
      await make('course_offerings',{id:offering,name:`${exercise.subject} · Ingénieur 1`,subject_id:subject,class_id:engineeringDemo.class,semester_id:auxiliary(50),department_id:department});
      await make('teaching_assignments',{teacher_id:ids.engineeringTeacher,course_offering_id:offering});
      // Never reopen, overwrite, or regenerate codes for an existing seeded exam.
      if((await c.query('select id from public.assessments where id=$1',[assessment])).rows.length)continue;
      await c.query(`insert into public.assessments(id,university_id,course_offering_id,author_id,title,description,kind,opens_at,closes_at,duration_minutes,question_count,total_points,allow_paste,requires_code)
        values($1,$2,$3,$4,$5,'Atelier du cycle Ingénieur 1 : code, sauvegarde et remise dans la plateforme.','PRACTICAL',clock_timestamp()-interval '1 day',clock_timestamp()+interval '30 days',120,1,20,false,true)`,[assessment,u,offering,ids.engineeringTeacher,exercise.title]);
      await c.query(`insert into public.assessment_questions(id,university_id,assessment_id,position,type,title,statement,points,starter_code,runtime)
        values($1,$2,$3,0,'CODE',$4,$5,20,$6,$7)`,[question,u,assessment,exercise.title,exercise.statement,exercise.starter,exercise.runtime]);
      await c.query('insert into private.assessment_solutions(question_id,university_id,assessment_id,expected_option_id) values($1,$2,$3,null)',[question,u,assessment]);
      await c.query('insert into public.assessment_assignments(university_id,assessment_id,student_id) values($1,$2,$3)',[u,assessment,ids.engineeringStudent]);
      const code=engineeringDemo.codes[exercise.runtime as keyof typeof engineeringDemo.codes];
      await c.query('insert into private.assessment_access_codes(university_id,assessment_id,student_id,code_hash) values($1,$2,$3,$4)',[u,assessment,ids.engineeringStudent,createHash('sha256').update(code.replace(/-/g,'')).digest('hex')]);
      await c.query("update public.assessments set publication_status='PUBLISHED',published_at=clock_timestamp() where id=$1",[assessment]);
    }
  });
}

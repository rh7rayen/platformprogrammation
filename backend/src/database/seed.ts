import type { Database, SqlClient } from './database';

export const demoIds = {
  university: '10000000-0000-4000-8000-000000000001', otherUniversity: '10000000-0000-4000-8000-000000000002',
  admin: '20000000-0000-4000-8000-000000000001', teacher: '20000000-0000-4000-8000-000000000002',
  student: '20000000-0000-4000-8000-000000000003', otherStudent: '20000000-0000-4000-8000-000000000004',
  otherAdmin: '20000000-0000-4000-8000-000000000005', languageTeacher: '20000000-0000-4000-8000-000000000006',
  engineeringTeacher: '20000000-0000-4000-8000-000000000007', engineeringStudent: '20000000-0000-4000-8000-000000000008',
  department: '30000000-0000-4000-8000-000000000001', letters: '30000000-0000-4000-8000-000000000002',
  class: '40000000-0000-4000-8000-000000000001', otherClass: '40000000-0000-4000-8000-000000000002',
  subject: '50000000-0000-4000-8000-000000000001', otherSubject: '50000000-0000-4000-8000-000000000004',
  offering: '60000000-0000-4000-8000-000000000001',
};
export const demoAccounts = [
  { id: demoIds.admin, full_name: 'Amira Ben Ali', email: 'amira@uniexam.example', role: 'UNIVERSITY_ADMIN' },
  { id: demoIds.teacher, full_name: 'Yassine Trabelsi', email: 'yassine@uniexam.example', role: 'TEACHER' },
  { id: demoIds.student, full_name: 'Nour Mansour', email: 'nour@uniexam.example', role: 'STUDENT' },
  { id: demoIds.otherStudent, full_name: 'Adam Saïdi', email: 'adam@uniexam.example', role: 'STUDENT' },
  { id: demoIds.otherAdmin, full_name: 'Admin Université B', email: 'admin@university-b.example', role: 'UNIVERSITY_ADMIN' },
  { id: demoIds.languageTeacher, full_name: 'Inès Khelifi', email: 'ines@uniexam.example', role: 'TEACHER' },
  { id: demoIds.engineeringTeacher, full_name: 'Sami Haddad', email: 'sami@uniexam.example', role: 'TEACHER' },
  { id: demoIds.engineeringStudent, full_name: 'Lina Ben Salem', email: 'lina@uniexam.example', role: 'STUDENT' },
] as const;
async function insert(client: SqlClient, table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  await client.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')}) on conflict do nothing`, Object.values(row));
}
export async function seedDemo(database: Database) {
  if (database.config.APP_MODE !== 'demo') throw new Error('Demo data is forbidden on Supabase.');
  await database.privileged(async client => {
    await insert(client, 'public.universities', { id: demoIds.university, name: 'Université Démo', code: 'UNIDEMO' });
    await insert(client, 'public.universities', { id: demoIds.otherUniversity, name: 'Université B', code: 'UNIB' });
    for (const person of demoAccounts) {
      const u = person.id === demoIds.otherAdmin ? demoIds.otherUniversity : demoIds.university;
      await insert(client, 'auth.users', { id: person.id, email: person.email });
      await insert(client, 'public.profiles', { id: person.id, email: person.email, full_name: person.full_name });
      await insert(client, 'public.university_memberships', { university_id: u, user_id: person.id });
      await insert(client, 'public.role_assignments', { university_id: u, user_id: person.id, role: person.role });
    }
    const u = demoIds.university;
    const id = (prefix: string, index: number) => `${prefix}0000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
    const make = (table: string, row: Record<string,unknown>) => insert(client,`public.${table}`,{ university_id:u,...row });
    await make('institutions', { id:id('7',1),name:'Faculté des sciences et des lettres',code:'FSL' });
    await make('departments', { id:demoIds.department,name:'Informatique',code:'INFO',institution_id:id('7',1) });
    await make('departments', { id:demoIds.letters,name:'Lettres et langues',code:'LETT',institution_id:id('7',1) });
    for (let n=1;n<=2;n++) {
      const d=n===1?demoIds.department:demoIds.letters;
      await make('programs', { id:id('7',10+n),name:n===1?'Licence informatique':'Licence de français',code:n===1?'LIC-INFO':'LIC-FR',department_id:d });
      await make('specialties', { id:id('7',20+n),name:n===1?'Génie logiciel':'Langue et littérature françaises',code:n===1?'GL':'LLF',program_id:id('7',10+n),department_id:d });
    }
    await make('academic_levels',{id:id('7',30),name:'Licence 2',code:'L2',position:2});
    await make('academic_years',{id:id('7',40),name:'2026 – 2027',starts_on:'2026-09-01',ends_on:'2027-07-31'});
    await make('semesters',{id:id('7',50),name:'Semestre 1',academic_year_id:id('7',40),starts_on:'2026-09-01',ends_on:'2027-01-31'});
    for (let n=1;n<=2;n++) {
      const c=n===1?demoIds.class:demoIds.otherClass;
      await make('classes',{id:c,name:n===1?'Génie logiciel · GL2-A':'Français · FR2-A',code:n===1?'GL2-A':'FR2-A',department_id:n===1?demoIds.department:demoIds.letters,specialty_id:id('7',20+n),academic_level_id:id('7',30),academic_year_id:id('7',40),capacity:30});
    }
    for(let n=1;n<=2;n++) await make('groups',{id:id('7',60+n),name:`Travaux pratiques ${n}`,code:`TP${n}`,class_id:demoIds.class,department_id:demoIds.department});
    const subjects = [
      {name:'Programmation Python',code:'PY-201',description:'Algorithmique, structures de données et programmation en Python.',color:'mint'},
      {name:'Bases de données',code:'BD-202',description:'Modèle relationnel, requêtes SQL et conception de bases de données.',color:'blue'},
      {name:'Mathématiques',code:'MAT-203',description:'Algèbre linéaire, analyse et raisonnement mathématique.',color:'peach'},
      {name:'Expression française',code:'FR-201',description:'Argumentation, rédaction et analyse de textes.',color:'violet'},
    ];
    for(const [i,subject] of subjects.entries()) {
      const s=id('5',i+1), o=id('6',i+1), d=i===3?demoIds.letters:demoIds.department, c=i===3?demoIds.otherClass:demoIds.class;
      await make('subjects',{id:s,...subject,department_id:d,coefficient:i===0?3:2});
      await make('course_offerings',{id:o,name:`${subject.name} · S1`,subject_id:s,class_id:c,semester_id:id('7',50),department_id:d});
      await make('teaching_assignments',{teacher_id:i===3?demoIds.languageTeacher:demoIds.teacher,course_offering_id:o});
    }
    await make('enrollments',{student_id:demoIds.student,class_id:demoIds.class,group_id:id('7',61)});
    await make('enrollments',{student_id:demoIds.otherStudent,class_id:demoIds.otherClass});
  });
}

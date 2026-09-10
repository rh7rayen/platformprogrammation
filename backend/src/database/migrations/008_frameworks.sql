-- Extend the catalogue without replacing questions, copies, deadlines or recorded jobs.
alter table public.assessment_questions drop constraint assessment_questions_runtime_check;
alter table public.assessment_questions add constraint assessment_questions_runtime_check check(runtime in (
 'python','php','java','javascript','typescript','c','cpp','csharp','go','rust','ruby','bash','sql','web',
 'react','angular','symfony','laravel','mysql','oracle_plsql'
));

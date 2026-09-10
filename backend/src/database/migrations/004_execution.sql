alter table public.assessment_questions drop constraint assessment_questions_runtime_check;
alter table public.assessment_questions add constraint assessment_questions_runtime_check check(runtime in ('python','php','java','javascript','typescript','c','cpp','csharp','go','rust','ruby','bash','sql','web'));

-- A durable, bounded outbox. Student programs are only forwarded to a separate runner.
create table private.execution_jobs (
  id uuid primary key default gen_random_uuid(),university_id uuid not null,assessment_id uuid not null,
  attempt_id uuid not null,question_id uuid not null,student_id uuid not null,runtime text not null,
  answer_version integer not null check(answer_version>0),source_code text not null check(length(source_code)<=30000),
  stdin text not null default '' check(length(stdin)<=4000),provider_token text,
  status text not null default 'QUEUED' check(status in ('QUEUED','DISPATCHING','PROCESSING','SUCCEEDED','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT','FAILED')),
  stdout text not null default '' check(octet_length(stdout)<=32768),stderr text not null default '' check(octet_length(stderr)<=32768),
  compile_output text not null default '' check(octet_length(compile_output)<=32768),message text not null default '',
  time_seconds numeric,memory_kb integer,created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),next_poll_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
  foreign key(university_id,assessment_id,attempt_id) references public.attempts(university_id,assessment_id,id),
  foreign key(university_id,assessment_id,question_id) references public.assessment_questions(university_id,assessment_id,id),
  foreign key(university_id,student_id) references public.university_memberships(university_id,user_id)
);
create unique index execution_one_active_per_attempt on private.execution_jobs(attempt_id) where status in ('QUEUED','DISPATCHING','PROCESSING');
create index execution_queue on private.execution_jobs(next_poll_at) where status in ('QUEUED','DISPATCHING','PROCESSING');
create index execution_student_quota on private.execution_jobs(university_id,student_id,created_at);
create index execution_retention on private.execution_jobs(finished_at) where finished_at is not null;
alter table private.execution_jobs enable row level security;
create policy execution_read on private.execution_jobs for select using(student_id=auth.uid() and private.is_member(university_id) and private.owns_attempt(university_id,attempt_id));
create policy execution_insert on private.execution_jobs for insert with check(student_id=auth.uid() and private.is_member(university_id) and private.owns_attempt(university_id,attempt_id) and status='QUEUED' and provider_token is null);
revoke all on private.execution_jobs from public,anon,authenticated;
grant select,insert on private.execution_jobs to uniexam_api;

-- Dedicated actor lock, rather than UPDATE permission on academic profiles.
create table private.execution_locks (
  university_id uuid not null,student_id uuid not null,primary key(university_id,student_id),
  foreign key(university_id,student_id) references public.university_memberships(university_id,user_id)
);
alter table private.execution_locks enable row level security;
create policy execution_lock_scope on private.execution_locks for all using(student_id=auth.uid() and private.is_member(university_id)) with check(student_id=auth.uid() and private.is_member(university_id));
revoke all on private.execution_locks from public,anon,authenticated;
grant select,insert,update(student_id) on private.execution_locks to uniexam_api;

create table private.exam_mail_jobs(
  id uuid primary key default gen_random_uuid(),university_id uuid not null,assessment_id uuid not null,student_id uuid not null,requested_by uuid not null,
  status text not null default 'QUEUED' check(status in ('QUEUED','SENDING','SENT','FAILED','EXPIRED')),
  encrypted_payload text,attempt_count integer not null default 0,provider_id text,last_error text,
  created_at timestamptz not null default clock_timestamp(),next_attempt_at timestamptz not null default clock_timestamp(),sent_at timestamptz,
  unique(university_id,assessment_id,student_id),
  foreign key(university_id,assessment_id,student_id) references public.assessment_assignments(university_id,assessment_id,student_id),
  foreign key(university_id,requested_by) references public.university_memberships(university_id,user_id)
);
alter table private.exam_mail_jobs enable row level security;
create policy mail_read on private.exam_mail_jobs for select to uniexam_api using(private.manages_assessment(university_id,assessment_id));
create policy mail_create on private.exam_mail_jobs for insert to uniexam_api with check(requested_by=auth.uid() and private.manages_assessment(university_id,assessment_id));
grant select,insert on private.exam_mail_jobs to uniexam_api;
revoke all on private.exam_mail_jobs from authenticated,anon;
create index on private.exam_mail_jobs(next_attempt_at) where status in ('QUEUED','SENDING');
create index on private.exam_mail_jobs(university_id,assessment_id);

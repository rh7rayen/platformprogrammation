-- Only metadata belongs in PostgreSQL. Video bytes are uploaded to private object storage.
create table public.recording_sessions (
  id uuid primary key default gen_random_uuid(), university_id uuid not null, assessment_id uuid not null,
  attempt_id uuid not null, student_id uuid not null,
  status text not null default 'RECORDING' check(status in ('RECORDING','STOPPED','INTERRUPTED')),
  consent_version text not null check(consent_version='screen-v1'), consented_at timestamptz not null default clock_timestamp(),
  started_at timestamptz not null default clock_timestamp(), stopped_at timestamptz,
  lease_until timestamptz not null default clock_timestamp()+interval '60 seconds',
  expires_at timestamptz not null,
  unique(university_id,attempt_id,id),
  foreign key(university_id,assessment_id,attempt_id) references public.attempts(university_id,assessment_id,id),
  foreign key(university_id,student_id) references public.university_memberships(university_id,user_id)
);
create unique index one_live_recording_per_attempt on public.recording_sessions(attempt_id) where status='RECORDING';
create index recording_session_expiration on public.recording_sessions(expires_at);
create table public.recording_chunks (
  id uuid primary key default gen_random_uuid(), university_id uuid not null, attempt_id uuid not null, session_id uuid not null,
  sequence integer not null check(sequence between 0 and 1999), object_path text not null unique,
  size_bytes integer not null check(size_bytes between 1 and 4194304),
  mime_type text not null check(mime_type in ('video/webm','video/mp4')),
  status text not null default 'PENDING' check(status in ('PENDING','READY','DELETED')),
  created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  unique(session_id,sequence),
  foreign key(university_id,attempt_id,session_id) references public.recording_sessions(university_id,attempt_id,id)
);
create index recording_chunk_attempt on public.recording_chunks(university_id,attempt_id,session_id,sequence);
create function private.may_review_recording(u uuid,t uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.attempts a where a.university_id=u and a.id=t and private.manages_assessment(u,a.assessment_id));
$$;
alter table public.recording_sessions enable row level security;
alter table public.recording_chunks enable row level security;
create policy recording_session_read on public.recording_sessions for select to uniexam_api using(private.owns_attempt(university_id,attempt_id) or private.may_review_recording(university_id,attempt_id));
create policy recording_session_create on public.recording_sessions for insert to uniexam_api with check(student_id=auth.uid() and private.owns_attempt(university_id,attempt_id));
create policy recording_session_update on public.recording_sessions for update to uniexam_api using(student_id=auth.uid() and private.owns_attempt(university_id,attempt_id)) with check(student_id=auth.uid() and private.owns_attempt(university_id,attempt_id));
create policy recording_chunk_read on public.recording_chunks for select to uniexam_api using(private.owns_attempt(university_id,attempt_id) or private.may_review_recording(university_id,attempt_id));
create policy recording_chunk_create on public.recording_chunks for insert to uniexam_api with check(private.owns_attempt(university_id,attempt_id));
create policy recording_chunk_update on public.recording_chunks for update to uniexam_api using(private.owns_attempt(university_id,attempt_id)) with check(private.owns_attempt(university_id,attempt_id));
revoke all on public.recording_sessions,public.recording_chunks from public,anon,authenticated;
grant select,insert on public.recording_sessions,public.recording_chunks to uniexam_api;
grant update(id,status,stopped_at,lease_until) on public.recording_sessions to uniexam_api;
grant update(status,completed_at) on public.recording_chunks to uniexam_api;
revoke all on function private.may_review_recording(uuid,uuid) from public;
grant execute on function private.may_review_recording(uuid,uuid) to uniexam_api;

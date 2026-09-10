create table public.assessments (
  id uuid primary key default gen_random_uuid(),university_id uuid not null,course_offering_id uuid not null,
  author_id uuid not null,title text not null,description text not null default '',kind text not null check(kind in ('QUIZ','HOMEWORK','EXAM','PRACTICAL')),
  publication_status text not null default 'DRAFT' check(publication_status in ('DRAFT','PUBLISHED')),
  opens_at timestamptz not null,closes_at timestamptz not null check(closes_at>opens_at),duration_minutes integer not null check(duration_minutes between 1 and 240),
  allow_paste boolean not null default false,requires_code boolean not null default true,
  question_count integer not null default 0,total_points numeric(8,2) not null default 0,
  created_at timestamptz not null default now(),published_at timestamptz,results_published_at timestamptz,
  unique(university_id,id),foreign key(university_id,course_offering_id) references public.course_offerings(university_id,id),
  foreign key(university_id,author_id) references public.university_memberships(university_id,user_id)
);
create table public.assessment_questions (
  id uuid primary key default gen_random_uuid(),university_id uuid not null,assessment_id uuid not null,
  position integer not null check(position>=0),type text not null check(type in ('CODE','SINGLE_CHOICE','LONG_TEXT')),
  title text not null,statement text not null,points numeric(6,2) not null check(points>0 and points<=100),
  options jsonb not null default '[]' check(jsonb_typeof(options)='array'),starter_code text not null default '',runtime text check(runtime='python'),
  unique(university_id,assessment_id,id),unique(university_id,assessment_id,position),
  foreign key(university_id,assessment_id) references public.assessments(university_id,id)
);
create table private.assessment_solutions (
  question_id uuid primary key,university_id uuid not null,assessment_id uuid not null,expected_option_id text,
  foreign key(university_id,assessment_id,question_id) references public.assessment_questions(university_id,assessment_id,id) on delete cascade
);
create table public.assessment_assignments (
  id uuid primary key default gen_random_uuid(),university_id uuid not null,assessment_id uuid not null,student_id uuid not null,
  created_at timestamptz not null default now(),unique(university_id,assessment_id,student_id),
  foreign key(university_id,assessment_id) references public.assessments(university_id,id),
  foreign key(university_id,student_id) references public.university_memberships(university_id,user_id)
);
create table private.assessment_access_codes (
  university_id uuid not null,assessment_id uuid not null,student_id uuid not null,code_hash text not null unique,
  redeemed_at timestamptz,created_at timestamptz not null default now(),primary key(university_id,assessment_id,student_id),
  foreign key(university_id,assessment_id,student_id) references public.assessment_assignments(university_id,assessment_id,student_id)
);
create table public.attempts (
  id uuid primary key default gen_random_uuid(),university_id uuid not null,assessment_id uuid not null,student_id uuid not null,
  status text not null default 'IN_PROGRESS' check(status in ('IN_PROGRESS','SUBMITTED','AUTO_SUBMITTED')),
  started_at timestamptz not null,deadline timestamptz not null,submitted_at timestamptz,
  unique(university_id,id),unique(university_id,assessment_id,id),unique(university_id,assessment_id,student_id),
  foreign key(university_id,assessment_id,student_id) references public.assessment_assignments(university_id,assessment_id,student_id)
);
create index attempts_expiration on public.attempts(deadline) where status='IN_PROGRESS';
create table public.answer_drafts (
  university_id uuid not null,assessment_id uuid not null,attempt_id uuid not null,question_id uuid not null,
  answer_text text not null check(length(answer_text)<=30000),version integer not null default 1 check(version>=1),saved_at timestamptz not null default clock_timestamp(),
  primary key(attempt_id,question_id),
  foreign key(university_id,assessment_id,attempt_id) references public.attempts(university_id,assessment_id,id),
  foreign key(university_id,assessment_id,question_id) references public.assessment_questions(university_id,assessment_id,id)
);
create table public.submissions (
  id uuid primary key default gen_random_uuid(),university_id uuid not null,assessment_id uuid not null,attempt_id uuid not null,student_id uuid not null,
  submitted_at timestamptz not null default clock_timestamp(),unique(attempt_id),unique(university_id,id),unique(university_id,assessment_id,id),
  foreign key(university_id,assessment_id,attempt_id) references public.attempts(university_id,assessment_id,id),
  foreign key(university_id,student_id) references public.university_memberships(university_id,user_id)
);
create table public.submission_answers (
  university_id uuid not null,assessment_id uuid not null,submission_id uuid not null,question_id uuid not null,
  answer_text text not null,question jsonb not null,max_points numeric(6,2) not null,
  score numeric(6,2) check(score>=0 and score<=max_points),feedback text not null default '',grade_version integer not null default 0,
  primary key(submission_id,question_id),
  foreign key(university_id,assessment_id,submission_id) references public.submissions(university_id,assessment_id,id),
  foreign key(university_id,assessment_id,question_id) references public.assessment_questions(university_id,assessment_id,id)
);
create table public.grade_adjustments (
  id uuid primary key default gen_random_uuid(),university_id uuid not null,assessment_id uuid not null,submission_id uuid not null,
  question_id uuid not null,actor_id uuid not null,old_score numeric(6,2),new_score numeric(6,2) not null,reason text not null,created_at timestamptz not null default now(),
  foreign key(submission_id,question_id) references public.submission_answers(submission_id,question_id),
  foreign key(university_id,assessment_id,submission_id) references public.submissions(university_id,assessment_id,id),
  foreign key(university_id,actor_id) references public.university_memberships(university_id,user_id)
);
create function private.can_teach_offering(u uuid,o uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member(u) and exists(select 1 from public.course_offerings c join public.teaching_assignments t on t.university_id=c.university_id and t.course_offering_id=c.id
    where c.university_id=u and c.id=o and t.teacher_id=auth.uid()
    and private.has_role(u,array['TEACHER']::public.app_role[],c.department_id,c.class_id,c.id));
$$;
create function private.manages_assessment(u uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.assessments e where e.university_id=u and e.id=a and private.can_teach_offering(u,e.course_offering_id));
$$;
create function private.assigned_assessment(u uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member(u) and exists(select 1 from public.assessment_assignments s join public.assessments e on e.university_id=s.university_id and e.id=s.assessment_id
    where s.university_id=u and s.assessment_id=a and s.student_id=auth.uid() and e.publication_status='PUBLISHED');
$$;
create function private.owns_attempt(u uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member(u) and exists(select 1 from public.attempts t where t.university_id=u and t.id=a and t.student_id=auth.uid());
$$;
create function private.may_read_questions(u uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.manages_assessment(u,a) or (private.is_member(u) and exists(select 1 from public.attempts t where t.university_id=u and t.assessment_id=a and t.student_id=auth.uid()));
$$;
create function private.may_read_submission(u uuid,s uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.submissions r join public.assessments a on a.university_id=r.university_id and a.id=r.assessment_id
    where r.university_id=u and r.id=s and (private.manages_assessment(u,a.id) or (private.is_member(u) and r.student_id=auth.uid() and a.results_published_at is not null)));
$$;

-- Published content and copied student answers cannot be rewritten.
create function private.freeze_assessment() returns trigger language plpgsql set search_path='' as $$
begin
  if old.publication_status='PUBLISHED' and (to_jsonb(new)-'results_published_at')<>(to_jsonb(old)-'results_published_at') then
    raise exception 'Published assessment is immutable' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger freeze_published before update on public.assessments for each row execute function private.freeze_assessment();
create function private.guard_question_write() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid; a uuid; state text;
begin
  if TG_OP='DELETE' then u:=old.university_id;a:=old.assessment_id; else u:=new.university_id;a:=new.assessment_id; end if;
  select publication_status into state from public.assessments where university_id=u and id=a for update;
  if state<>'DRAFT' then raise exception 'Published question is immutable' using errcode='23514'; end if;
  if TG_OP='DELETE' then return old; end if; return new;
end; $$;
create trigger guard_question before insert or update or delete on public.assessment_questions for each row execute function private.guard_question_write();
create trigger guard_solution before insert or update or delete on private.assessment_solutions for each row execute function private.guard_question_write();
create function private.guard_answer_write() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.attempts;
begin
  select * into t from public.attempts where id=new.attempt_id for update;
  if t.status<>'IN_PROGRESS' or clock_timestamp()>=t.deadline then raise exception 'Attempt is closed' using errcode='23514'; end if;
  return new;
end; $$;
create trigger guard_draft before insert or update on public.answer_drafts for each row execute function private.guard_answer_write();

-- A single locked transaction snapshots answers and calculates hidden QCM scores.
-- No score or answer key is returned by this function.
create function private.finalize_attempt(attempt_uuid uuid,only_if_expired boolean default false) returns public.attempts
language plpgsql security definer set search_path='' as $$
declare t public.attempts; s uuid; final_time timestamptz;
begin
  select * into t from public.attempts where id=attempt_uuid for update;
  if not found then raise exception 'Attempt not found' using errcode='42501'; end if;
  if auth.uid() is not null and not private.owns_attempt(t.university_id,t.id) then raise exception 'Not allowed' using errcode='42501'; end if;
  final_time:=clock_timestamp();
  if t.status<>'IN_PROGRESS' or (only_if_expired and final_time<t.deadline) then return t; end if;
  update public.attempts set status=case when final_time>=deadline then 'AUTO_SUBMITTED' else 'SUBMITTED' end,submitted_at=final_time where id=t.id returning * into t;
  insert into public.submissions(university_id,assessment_id,attempt_id,student_id,submitted_at)
    values(t.university_id,t.assessment_id,t.id,t.student_id,final_time) returning id into s;
  insert into public.submission_answers(university_id,assessment_id,submission_id,question_id,answer_text,question,max_points,score)
    select t.university_id,t.assessment_id,s,q.id,coalesce(d.answer_text,''),to_jsonb(q)-'university_id'-'assessment_id',q.points,
      case when q.type='SINGLE_CHOICE' then case when d.answer_text=k.expected_option_id then q.points else 0 end else null end
    from public.assessment_questions q left join public.answer_drafts d on d.question_id=q.id and d.attempt_id=t.id
    left join private.assessment_solutions k on k.question_id=q.id
    where q.university_id=t.university_id and q.assessment_id=t.assessment_id;
  return t;
end; $$;

alter table public.assessments enable row level security;
create policy assessment_read on public.assessments for select to uniexam_api using(private.is_admin(university_id) or private.can_teach_offering(university_id,course_offering_id) or private.assigned_assessment(university_id,id));
create policy assessment_create on public.assessments for insert to uniexam_api with check(author_id=auth.uid() and private.can_teach_offering(university_id,course_offering_id) and publication_status='DRAFT');
create policy assessment_update on public.assessments for update to uniexam_api using(private.can_teach_offering(university_id,course_offering_id)) with check(private.can_teach_offering(university_id,course_offering_id));
alter table public.assessment_questions enable row level security;
create policy question_read on public.assessment_questions for select to uniexam_api using(private.may_read_questions(university_id,assessment_id));
create policy question_create on public.assessment_questions for insert to uniexam_api with check(private.manages_assessment(university_id,assessment_id));
create policy question_delete on public.assessment_questions for delete to uniexam_api using(private.manages_assessment(university_id,assessment_id));
alter table private.assessment_solutions enable row level security;
create policy solution_read on private.assessment_solutions for select to uniexam_api using(private.manages_assessment(university_id,assessment_id));
create policy solution_write on private.assessment_solutions for insert to uniexam_api with check(private.manages_assessment(university_id,assessment_id));
create policy solution_delete on private.assessment_solutions for delete to uniexam_api using(private.manages_assessment(university_id,assessment_id));
alter table public.assessment_assignments enable row level security;
create policy assignment_read on public.assessment_assignments for select to uniexam_api using(private.manages_assessment(university_id,assessment_id) or (student_id=auth.uid() and private.is_member(university_id)));
create policy assignment_create on public.assessment_assignments for insert to uniexam_api with check(private.manages_assessment(university_id,assessment_id));
create policy assignment_lock on public.assessment_assignments for update to uniexam_api using(student_id=auth.uid() and private.is_member(university_id)) with check(student_id=auth.uid() and private.is_member(university_id));
alter table private.assessment_access_codes enable row level security;
create policy code_read on private.assessment_access_codes for select to uniexam_api using(private.manages_assessment(university_id,assessment_id) or (student_id=auth.uid() and private.is_member(university_id)));
create policy code_create on private.assessment_access_codes for insert to uniexam_api with check(private.manages_assessment(university_id,assessment_id));
create policy code_update on private.assessment_access_codes for update to uniexam_api using(private.manages_assessment(university_id,assessment_id) or (student_id=auth.uid() and private.is_member(university_id))) with check(private.manages_assessment(university_id,assessment_id) or (student_id=auth.uid() and private.is_member(university_id)));
alter table public.attempts enable row level security;
create policy attempt_read on public.attempts for select to uniexam_api using(private.manages_assessment(university_id,assessment_id) or (student_id=auth.uid() and private.is_member(university_id)));
create policy attempt_create on public.attempts for insert to uniexam_api with check(student_id=auth.uid() and private.assigned_assessment(university_id,assessment_id));
create policy attempt_lock on public.attempts for update to uniexam_api using(student_id=auth.uid() and private.is_member(university_id)) with check(student_id=auth.uid() and private.is_member(university_id));
alter table public.answer_drafts enable row level security;
create policy draft_read on public.answer_drafts for select to uniexam_api using(private.owns_attempt(university_id,attempt_id));
create policy draft_create on public.answer_drafts for insert to uniexam_api with check(private.owns_attempt(university_id,attempt_id));
create policy draft_update on public.answer_drafts for update to uniexam_api using(private.owns_attempt(university_id,attempt_id)) with check(private.owns_attempt(university_id,attempt_id));
alter table public.submissions enable row level security;
create policy submission_read on public.submissions for select to uniexam_api using(private.manages_assessment(university_id,assessment_id) or (student_id=auth.uid() and private.is_member(university_id) and exists(select 1 from public.assessments a where a.id=assessment_id and a.results_published_at is not null)));
alter table public.submission_answers enable row level security;
create policy submitted_answer_read on public.submission_answers for select to uniexam_api using(private.may_read_submission(university_id,submission_id));
create policy grade_update on public.submission_answers for update to uniexam_api using(private.manages_assessment(university_id,assessment_id)) with check(private.manages_assessment(university_id,assessment_id));
alter table public.grade_adjustments enable row level security;
create policy grade_history_read on public.grade_adjustments for select to uniexam_api using(private.manages_assessment(university_id,assessment_id));
create policy grade_history_create on public.grade_adjustments for insert to uniexam_api with check(actor_id=auth.uid() and private.manages_assessment(university_id,assessment_id));

revoke all on public.assessments,public.assessment_questions,public.assessment_assignments,public.attempts,public.answer_drafts,public.submissions,public.submission_answers,public.grade_adjustments,private.assessment_solutions,private.assessment_access_codes from anon,authenticated;
grant select,insert,update on public.assessments to uniexam_api;
grant select,insert,delete on public.assessment_questions,private.assessment_solutions to uniexam_api;
grant select,insert on public.assessment_assignments,public.attempts,public.grade_adjustments to uniexam_api;
-- Column-only grant permits row locks without granting deadline/status changes.
grant update(id) on public.assessment_assignments,public.attempts to uniexam_api;
grant select,insert,update on public.answer_drafts,private.assessment_access_codes to uniexam_api;
grant select on public.submissions,public.submission_answers to uniexam_api;
grant update(score,feedback,grade_version) on public.submission_answers to uniexam_api;
revoke all on function private.can_teach_offering(uuid,uuid),private.manages_assessment(uuid,uuid),private.assigned_assessment(uuid,uuid),private.owns_attempt(uuid,uuid),private.may_read_questions(uuid,uuid),private.may_read_submission(uuid,uuid),private.finalize_attempt(uuid,boolean),private.freeze_assessment(),private.guard_question_write(),private.guard_answer_write() from public;
grant execute on function private.can_teach_offering(uuid,uuid),private.manages_assessment(uuid,uuid),private.assigned_assessment(uuid,uuid),private.owns_attempt(uuid,uuid),private.may_read_questions(uuid,uuid),private.may_read_submission(uuid,uuid),private.finalize_attempt(uuid,boolean) to uniexam_api;
do $$ declare t text; begin
  foreach t in array array['assessments','assessment_questions','assessment_assignments','attempts','submissions','submission_answers','grade_adjustments'] loop
    if t<>'assessments' then execute format('create index on public.%I(university_id,assessment_id)',t); end if;
  end loop;
end $$;
create index on public.assessments(university_id,course_offering_id,created_at desc);
create index on public.assessment_assignments(student_id,university_id);
create trigger assessment_audit after insert or update on public.assessments for each row execute function private.audit_change();
create trigger assignment_audit after insert on public.assessment_assignments for each row execute function private.audit_change();
create trigger attempt_audit after insert or update on public.attempts for each row execute function private.audit_change();

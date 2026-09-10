-- Supabase supplies auth.users, auth.uid() and the authenticated/anon roles.
-- The local PostgreSQL test engine creates this auth boundary separately.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='uniexam_api') then create role uniexam_api nologin; end if;
end $$;
grant usage on schema public,auth to uniexam_api;
grant execute on function auth.uid() to uniexam_api;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to uniexam_api;

create type public.app_role as enum ('UNIVERSITY_ADMIN','ACADEMIC_MANAGER','SCHOOL_OFFICE','TEACHER','PROCTOR','STUDENT');

create table public.universities (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 120),
  code text not null unique, timezone text not null default 'Africa/Tunis',
  active boolean not null default true, created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check(length(full_name) between 2 and 120), email text not null,
  created_at timestamptz not null default now()
);
create table public.university_memberships (
  university_id uuid not null references public.universities(id), user_id uuid not null references public.profiles(id),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','SUSPENDED')),
  created_at timestamptz not null default now(), primary key(university_id,user_id)
);
create table private.auth_sessions (
  token_hash text primary key, user_id uuid not null references public.profiles(id),
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create index on private.auth_sessions(user_id, expires_at);

create table public.institutions (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  name text not null, code text not null, created_at timestamptz not null default now(), unique(university_id,id), unique(university_id,code)
);
create table public.departments (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  name text not null, code text not null, institution_id uuid,
  created_at timestamptz not null default now(), unique(university_id,id), unique(university_id,code),
  foreign key(university_id,institution_id) references public.institutions(university_id,id)
);
create table public.programs (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  department_id uuid not null, name text not null, code text not null, created_at timestamptz not null default now(),
  unique(university_id,id), unique(university_id,department_id,id), unique(university_id,code),
  foreign key(university_id,department_id) references public.departments(university_id,id)
);
create table public.specialties (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  department_id uuid not null, program_id uuid not null, name text not null, code text not null, created_at timestamptz not null default now(),
  unique(university_id,id), unique(university_id,department_id,id), unique(university_id,code),
  foreign key(university_id,department_id,program_id) references public.programs(university_id,department_id,id)
);
create table public.academic_levels (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  name text not null, code text not null, position integer not null check(position between 1 and 12),
  created_at timestamptz not null default now(), unique(university_id,id), unique(university_id,code)
);
create table public.academic_years (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  name text not null, starts_on date not null, ends_on date not null check(ends_on > starts_on),
  created_at timestamptz not null default now(), unique(university_id,id), unique(university_id,name)
);
create table public.semesters (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  academic_year_id uuid not null, name text not null, starts_on date not null, ends_on date not null check(ends_on > starts_on),
  created_at timestamptz not null default now(), unique(university_id,id), unique(university_id,academic_year_id,id), unique(university_id,academic_year_id,name),
  foreign key(university_id,academic_year_id) references public.academic_years(university_id,id)
);
create table public.classes (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  department_id uuid not null, specialty_id uuid not null, academic_level_id uuid not null, academic_year_id uuid not null,
  name text not null, code text not null, capacity integer not null check(capacity between 1 and 1000), created_at timestamptz not null default now(),
  unique(university_id,id), unique(university_id,department_id,id), unique(university_id,academic_year_id,code),
  foreign key(university_id,department_id,specialty_id) references public.specialties(university_id,department_id,id),
  foreign key(university_id,academic_level_id) references public.academic_levels(university_id,id),
  foreign key(university_id,academic_year_id) references public.academic_years(university_id,id)
);
create table public.groups (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  department_id uuid not null, class_id uuid not null, name text not null, code text not null, created_at timestamptz not null default now(),
  unique(university_id,id), unique(university_id,class_id,id), unique(university_id,class_id,code),
  foreign key(university_id,department_id,class_id) references public.classes(university_id,department_id,id)
);
create table public.subjects (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id), department_id uuid not null,
  name text not null, code text not null, description text not null default '', coefficient numeric(5,2) not null check(coefficient between 0.1 and 30),
  color text not null default 'mint' check(color in ('mint','blue','peach','violet')), created_at timestamptz not null default now(),
  unique(university_id,id), unique(university_id,department_id,id), unique(university_id,code),
  foreign key(university_id,department_id) references public.departments(university_id,id)
);
create table public.course_offerings (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  department_id uuid not null, subject_id uuid not null, class_id uuid not null, semester_id uuid not null,
  name text not null, created_at timestamptz not null default now(), unique(university_id,id), unique(university_id,subject_id,class_id,semester_id),
  foreign key(university_id,department_id,subject_id) references public.subjects(university_id,department_id,id),
  foreign key(university_id,department_id,class_id) references public.classes(university_id,department_id,id),
  foreign key(university_id,semester_id) references public.semesters(university_id,id)
);
create table public.role_assignments (
  id uuid primary key default gen_random_uuid(), university_id uuid not null, user_id uuid not null, role public.app_role not null,
  department_id uuid, class_id uuid, course_offering_id uuid, created_at timestamptz not null default now(),
  check(num_nonnulls(department_id,class_id,course_offering_id) <= 1),
  check(role <> 'UNIVERSITY_ADMIN' or num_nonnulls(department_id,class_id,course_offering_id)=0),
  unique nulls not distinct(university_id,user_id,role,department_id,class_id,course_offering_id),
  foreign key(university_id,user_id) references public.university_memberships(university_id,user_id),
  foreign key(university_id,department_id) references public.departments(university_id,id),
  foreign key(university_id,class_id) references public.classes(university_id,id),
  foreign key(university_id,course_offering_id) references public.course_offerings(university_id,id)
);
create index on public.role_assignments(user_id,university_id);
create table public.teaching_assignments (
  id uuid primary key default gen_random_uuid(), university_id uuid not null, teacher_id uuid not null, course_offering_id uuid not null,
  created_at timestamptz not null default now(), unique(university_id,teacher_id,course_offering_id),
  foreign key(university_id,teacher_id) references public.university_memberships(university_id,user_id),
  foreign key(university_id,course_offering_id) references public.course_offerings(university_id,id)
);
create table public.enrollments (
  id uuid primary key default gen_random_uuid(), university_id uuid not null, student_id uuid not null, class_id uuid not null, group_id uuid,
  enrolled_at timestamptz not null default now(), ended_at timestamptz, created_at timestamptz not null default now(),
  check(ended_at is null or ended_at >= enrolled_at),
  foreign key(university_id,student_id) references public.university_memberships(university_id,user_id),
  foreign key(university_id,class_id) references public.classes(university_id,id),
  foreign key(university_id,class_id,group_id) references public.groups(university_id,class_id,id)
);
create unique index on public.enrollments(university_id,student_id,class_id) where ended_at is null;
create index on public.enrollments(university_id,class_id,student_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id), actor_id uuid,
  action text not null, resource_type text not null, resource_id text not null, created_at timestamptz not null default now()
);
create index on public.audit_logs(university_id,created_at desc);
create table public.ai_drafts (
  id uuid primary key default gen_random_uuid(), university_id uuid not null, subject_id uuid not null, author_id uuid not null,
  model text not null, questions jsonb not null check(jsonb_typeof(questions)='array'),
  review_status text not null default 'PENDING_REVIEW' check(review_status='PENDING_REVIEW'), created_at timestamptz not null default now(),
  foreign key(university_id,subject_id) references public.subjects(university_id,id),
  foreign key(university_id,author_id) references public.university_memberships(university_id,user_id)
);
create table private.ai_usage (
  university_id uuid not null, user_id uuid not null, usage_date date not null default (now() at time zone 'UTC')::date,
  request_count integer not null default 0, primary key(university_id,user_id,usage_date)
);

-- SECURITY DEFINER helpers read policy tables without RLS recursion. All names
-- are qualified and the search_path is empty; none accepts a caller user ID.
create function private.is_member(u uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.university_memberships m join public.universities v on v.id=m.university_id
    where m.university_id=u and m.user_id=auth.uid() and m.status='ACTIVE' and v.active);
$$;
create function private.has_role(u uuid, allowed public.app_role[], d uuid default null, c uuid default null, o uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member(u) and exists(select 1 from public.role_assignments r
    where r.university_id=u and r.user_id=auth.uid() and r.role=any(allowed)
    and (num_nonnulls(r.department_id,r.class_id,r.course_offering_id)=0
      or r.department_id=d or r.class_id=c or r.course_offering_id=o));
$$;
create function private.is_admin(u uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.has_role(u,array['UNIVERSITY_ADMIN']::public.app_role[]);
$$;
create function private.manages_structure(u uuid,d uuid default null) returns boolean language sql stable security definer set search_path='' as $$
  select private.has_role(u,array['UNIVERSITY_ADMIN','ACADEMIC_MANAGER']::public.app_role[],d);
$$;
create function private.can_class(u uuid,c uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member(u) and exists(select 1 from public.classes cl where cl.university_id=u and cl.id=c and (
    private.has_role(u,array['UNIVERSITY_ADMIN','ACADEMIC_MANAGER','SCHOOL_OFFICE']::public.app_role[],cl.department_id,c)
    or exists(select 1 from public.enrollments e where e.university_id=u and e.class_id=c and e.student_id=auth.uid() and e.ended_at is null)
    or exists(select 1 from public.course_offerings o join public.teaching_assignments t on t.university_id=o.university_id and t.course_offering_id=o.id
      where o.university_id=u and o.class_id=c and t.teacher_id=auth.uid())
  ));
$$;
create function private.can_subject(u uuid,s uuid, write_content boolean default false) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member(u) and exists(select 1 from public.subjects s1 where s1.university_id=u and s1.id=s and (
    private.manages_structure(u,s1.department_id)
    or exists(select 1 from public.course_offerings o join public.teaching_assignments t on t.university_id=o.university_id and t.course_offering_id=o.id
      where o.university_id=u and o.subject_id=s and t.teacher_id=auth.uid())
    or (not write_content and exists(select 1 from public.course_offerings o where o.university_id=u and o.subject_id=s and private.can_class(u,o.class_id)))
  ));
$$;
create function private.can_person(u uuid,p uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member(u) and (p=auth.uid() or private.is_admin(u)
    or exists(select 1 from public.enrollments e join public.classes c on c.university_id=e.university_id and c.id=e.class_id
      where e.university_id=u and e.student_id=p and private.can_class(u,e.class_id)
      and private.has_role(u,array['UNIVERSITY_ADMIN','ACADEMIC_MANAGER','SCHOOL_OFFICE','TEACHER']::public.app_role[],c.department_id,c.id)));
$$;
create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_logs(university_id,actor_id,action,resource_type,resource_id)
  values(new.university_id,auth.uid(),TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'user_id'));
  return new;
end; $$;

create function private.validate_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare target_user uuid; target_role public.app_role;
begin
  if TG_TABLE_NAME='teaching_assignments' then target_user:=new.teacher_id; target_role:='TEACHER';
  else target_user:=new.student_id; target_role:='STUDENT'; end if;
  if not exists(select 1 from public.university_memberships m join public.role_assignments r using(university_id,user_id)
    where m.university_id=new.university_id and m.user_id=target_user and m.status='ACTIVE' and r.role=target_role)
  then raise exception 'Target must have an active % membership',target_role using errcode='23514'; end if;
  return new;
end; $$;
create trigger validate_teacher before insert or update on public.teaching_assignments for each row execute function private.validate_assignment();
create trigger validate_student before insert or update on public.enrollments for each row execute function private.validate_assignment();

create function private.validate_calendar() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_TABLE_NAME='semesters' then
    if not exists(select 1 from public.academic_years y where y.id=new.academic_year_id and y.university_id=new.university_id and new.starts_on>=y.starts_on and new.ends_on<=y.ends_on)
    then raise exception 'Semester outside academic year' using errcode='23514'; end if;
  else
    if not exists(select 1 from public.classes c join public.semesters s on s.university_id=c.university_id and s.academic_year_id=c.academic_year_id
      where c.university_id=new.university_id and c.id=new.class_id and s.id=new.semester_id)
    then raise exception 'Class and semester must share the academic year' using errcode='23514'; end if;
  end if;
  return new;
end; $$;
create trigger validate_semester before insert or update on public.semesters for each row execute function private.validate_calendar();
create trigger validate_offering before insert or update on public.course_offerings for each row execute function private.validate_calendar();

alter table public.universities enable row level security;
create policy university_read on public.universities for select to uniexam_api using(private.is_member(id));
alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to uniexam_api using(id=auth.uid() or exists(select 1 from public.university_memberships m where m.user_id=profiles.id and private.can_person(m.university_id,profiles.id)));
alter table public.university_memberships enable row level security;
create policy membership_read on public.university_memberships for select to uniexam_api using(private.can_person(university_id,user_id));
create policy membership_create on public.university_memberships for insert to uniexam_api with check(private.is_admin(university_id));
create policy membership_update on public.university_memberships for update to uniexam_api using(private.is_admin(university_id) and user_id<>auth.uid()) with check(private.is_admin(university_id) and user_id<>auth.uid());
alter table public.role_assignments enable row level security;
create policy role_read on public.role_assignments for select to uniexam_api using(private.is_member(university_id) and (user_id=auth.uid() or private.is_admin(university_id)));
create policy role_create on public.role_assignments for insert to uniexam_api with check(private.is_admin(university_id));
alter table public.classes enable row level security;
create policy class_read on public.classes for select to uniexam_api using(private.manages_structure(university_id,department_id) or private.can_class(university_id,id));
create policy class_create on public.classes for insert to uniexam_api with check(private.manages_structure(university_id,department_id));
alter table public.groups enable row level security;
create policy group_read on public.groups for select to uniexam_api using(private.can_class(university_id,class_id));
create policy group_create on public.groups for insert to uniexam_api with check(private.manages_structure(university_id,department_id));
alter table public.subjects enable row level security;
create policy subject_read on public.subjects for select to uniexam_api using(private.manages_structure(university_id,department_id) or private.can_subject(university_id,id));
create policy subject_create on public.subjects for insert to uniexam_api with check(private.manages_structure(university_id,department_id));
alter table public.course_offerings enable row level security;
create policy offering_read on public.course_offerings for select to uniexam_api using(private.can_class(university_id,class_id));
create policy offering_create on public.course_offerings for insert to uniexam_api with check(private.manages_structure(university_id,department_id));
alter table public.teaching_assignments enable row level security;
create policy teaching_read on public.teaching_assignments for select to uniexam_api using(private.is_member(university_id) and (teacher_id=auth.uid() or private.is_admin(university_id) or exists(select 1 from public.course_offerings o where o.id=course_offering_id and o.university_id=teaching_assignments.university_id)));
create policy teaching_create on public.teaching_assignments for insert to uniexam_api with check(exists(select 1 from public.course_offerings o where o.id=course_offering_id and o.university_id=teaching_assignments.university_id and private.manages_structure(o.university_id,o.department_id)));
alter table public.enrollments enable row level security;
create policy enrollment_read on public.enrollments for select to uniexam_api using(private.is_member(university_id) and (student_id=auth.uid() or (private.can_class(university_id,class_id) and private.has_role(university_id,array['UNIVERSITY_ADMIN','ACADEMIC_MANAGER','SCHOOL_OFFICE','TEACHER']::public.app_role[],(select department_id from public.classes where id=class_id),class_id))));
create policy enrollment_create on public.enrollments for insert to uniexam_api with check(exists(select 1 from public.classes c where c.id=class_id and c.university_id=enrollments.university_id and private.has_role(c.university_id,array['UNIVERSITY_ADMIN','ACADEMIC_MANAGER','SCHOOL_OFFICE']::public.app_role[],c.department_id,c.id)));
alter table public.audit_logs enable row level security;
create policy audit_read on public.audit_logs for select to uniexam_api using(private.is_admin(university_id));
alter table public.ai_drafts enable row level security;
create policy ai_read on public.ai_drafts for select to uniexam_api using(author_id=auth.uid() and private.can_subject(university_id,subject_id,true));
create policy ai_create on public.ai_drafts for insert to uniexam_api with check(author_id=auth.uid() and private.can_subject(university_id,subject_id,true));

do $$ declare t text; scope_column text; begin
  foreach t in array array['institutions','departments','programs','specialties','academic_levels','academic_years','semesters'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy catalog_read on public.%I for select to uniexam_api using(private.is_member(university_id))',t);
    scope_column:=case when t in ('programs','specialties') then 'department_id' when t='departments' then 'id' else 'null' end;
    execute format('create policy catalog_create on public.%I for insert to uniexam_api with check(private.manages_structure(university_id,%s))',t,scope_column);
  end loop;
  foreach t in array array['institutions','departments','programs','specialties','academic_levels','academic_years','semesters','classes','groups','subjects','course_offerings','university_memberships','role_assignments','teaching_assignments','enrollments','ai_drafts'] loop
    execute format('create trigger audit_write after insert or update on public.%I for each row execute function private.audit_change()',t);
    execute format('create index on public.%I(university_id)',t);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated, uniexam_api;
grant select on public.universities,public.profiles,public.audit_logs to uniexam_api;
grant select,insert on public.institutions,public.departments,public.programs,public.specialties,public.academic_levels,public.academic_years,public.semesters,public.classes,public.groups,public.subjects,public.course_offerings,public.role_assignments,public.teaching_assignments,public.enrollments,public.ai_drafts to uniexam_api;
grant select,insert on public.university_memberships to uniexam_api;
grant update(status) on public.university_memberships to uniexam_api;
revoke all on all functions in schema private from public;
grant execute on function private.is_member(uuid),private.has_role(uuid,public.app_role[],uuid,uuid,uuid),private.is_admin(uuid),private.manages_structure(uuid,uuid),private.can_class(uuid,uuid),private.can_subject(uuid,uuid,boolean),private.can_person(uuid,uuid) to uniexam_api;

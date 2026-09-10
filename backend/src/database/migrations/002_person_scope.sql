-- A user may teach one class and study in another. Enrollment in the latter
-- must not grant teacher visibility into classmates' personal information.
create or replace function private.can_person(u uuid,p uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member(u) and (p=auth.uid() or private.is_admin(u)
    or exists(select 1 from public.enrollments e join public.classes c on c.university_id=e.university_id and c.id=e.class_id
      where e.university_id=u and e.student_id=p and (
        private.has_role(u,array['UNIVERSITY_ADMIN','ACADEMIC_MANAGER','SCHOOL_OFFICE']::public.app_role[],c.department_id,c.id)
        or exists(select 1 from public.teaching_assignments t join public.course_offerings o on o.university_id=t.university_id and o.id=t.course_offering_id
          where t.university_id=u and t.teacher_id=auth.uid() and o.class_id=e.class_id
            and private.has_role(u,array['TEACHER']::public.app_role[],o.department_id,o.class_id,o.id))
      )));
$$;
drop policy enrollment_read on public.enrollments;
create policy enrollment_read on public.enrollments for select to uniexam_api using(
  private.is_member(university_id) and (student_id=auth.uid() or (private.can_class(university_id,class_id) and private.can_person(university_id,student_id)))
);

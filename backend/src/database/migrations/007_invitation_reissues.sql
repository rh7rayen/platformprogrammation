-- Preserve terminal invitation history. Each explicit reissue gets a new job
-- identity so its provider idempotency key is distinct from the failed request.
alter table private.exam_mail_jobs drop constraint exam_mail_jobs_university_id_assessment_id_student_id_key;
alter table private.exam_mail_jobs add column is_reissue boolean not null default false;
create unique index exam_mail_single_live_invitation on private.exam_mail_jobs(university_id,assessment_id,student_id)
  where status in ('QUEUED','SENDING','SENT');
create index exam_mail_latest_invitation on private.exam_mail_jobs(university_id,assessment_id,student_id,created_at desc,id desc);
create index exam_mail_reissue_quota on private.exam_mail_jobs(university_id,assessment_id,student_id,created_at) where is_reissue;

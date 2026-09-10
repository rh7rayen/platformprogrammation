import { z } from 'zod';
export * from './runtimes';
export * from './projects';
export * from './assessments';

export const roles = ['SUPER_ADMIN', 'UNIVERSITY_ADMIN', 'ACADEMIC_MANAGER', 'SCHOOL_OFFICE', 'TEACHER', 'PROCTOR', 'STUDENT'] as const;
export type Role = typeof roles[number];
export const roleLabels: Record<Role, string> = {
  SUPER_ADMIN: 'Super administrateur', UNIVERSITY_ADMIN: 'Administration',
  ACADEMIC_MANAGER: 'Responsable pédagogique', SCHOOL_OFFICE: 'Scolarité',
  TEACHER: 'Enseignant', PROCTOR: 'Surveillant', STUDENT: 'Étudiant',
};
export const uuid = z.uuid();
const name = z.string().trim().min(2).max(120);
const code = z.string().trim().min(2).max(30).regex(/^[\p{L}\p{N}_. -]+$/u);
const date = z.iso.date();
const optionalId = uuid.nullable().optional();

// Les clés de ce registre sont la seule liste de tables acceptée par l'API.
export const catalog = {
  institutions: { label: 'Établissements', singular: 'un établissement', schema: z.object({ name, code }).strict() },
  departments: { label: 'Départements', singular: 'un département', schema: z.object({ name, code, institution_id: optionalId }).strict() },
  programs: { label: 'Formations', singular: 'une formation', schema: z.object({ name, code, department_id: uuid }).strict() },
  specialties: { label: 'Spécialités', singular: 'une spécialité', schema: z.object({ name, code, program_id: uuid, department_id: uuid }).strict() },
  academic_levels: { label: 'Niveaux', singular: 'un niveau', schema: z.object({ name, code, position: z.number().int().min(1).max(12) }).strict() },
  academic_years: { label: 'Années universitaires', singular: 'une année', schema: z.object({ name, starts_on: date, ends_on: date }).strict().refine(v => v.ends_on > v.starts_on, 'La fin doit suivre le début.') },
  semesters: { label: 'Semestres', singular: 'un semestre', schema: z.object({ name, academic_year_id: uuid, starts_on: date, ends_on: date }).strict().refine(v => v.ends_on > v.starts_on, 'La fin doit suivre le début.') },
  classes: { label: 'Classes', singular: 'une classe', schema: z.object({ name, code, department_id: uuid, specialty_id: uuid, academic_level_id: uuid, academic_year_id: uuid, capacity: z.number().int().min(1).max(1000) }).strict() },
  groups: { label: 'Groupes', singular: 'un groupe', schema: z.object({ name, code, class_id: uuid, department_id: uuid }).strict() },
  subjects: { label: 'Matières', singular: 'une matière', schema: z.object({ name, code, department_id: uuid, description: z.string().trim().max(2000).default(''), coefficient: z.number().min(0.1).max(30), color: z.enum(['mint', 'blue', 'peach', 'violet']).default('mint') }).strict() },
  course_offerings: { label: 'Enseignements', singular: 'un enseignement', schema: z.object({ name, subject_id: uuid, class_id: uuid, semester_id: uuid, department_id: uuid }).strict() },
} as const;
export type CatalogKey = keyof typeof catalog;
export type AcademicRecord = { id: string; university_id: string; name: string; created_at: string; [key: string]: unknown };
export const membershipSchema = z.object({ user_id: uuid, role: z.enum(roles).exclude(['SUPER_ADMIN']), department_id: optionalId, class_id: optionalId, course_offering_id: optionalId }).strict()
  .refine(v => [v.department_id, v.class_id, v.course_offering_id].filter(Boolean).length <= 1, 'Un seul périmètre par affectation.')
  .refine(v => v.role !== 'UNIVERSITY_ADMIN' || ![v.department_id, v.class_id, v.course_offering_id].some(Boolean), 'Un administrateur est affecté à une université.');
export const enrollmentSchema = z.object({ student_id: uuid, class_id: uuid, group_id: optionalId }).strict();
export const assignmentSchema = z.object({ teacher_id: uuid, course_offering_id: uuid }).strict();
export const aiInputSchema = z.object({ subject_id: uuid, topic: z.string().trim().min(10).max(1500), count: z.number().int().min(1).max(5), difficulty: z.enum(['beginner', 'intermediate', 'advanced']) }).strict();
export const aiOutputSchema = z.object({ questions: z.array(z.object({ title: name, statement: z.string().min(10).max(3000), options: z.array(z.string().min(1).max(500)).length(4), correct_option: z.number().int().min(0).max(3), explanation: z.string().min(5).max(2000) }).strict()).min(1).max(5) }).strict();
export type AiDraft = z.infer<typeof aiOutputSchema> & { id: string; review_status: 'PENDING_REVIEW' };
export type SessionProfile = {
  mode: 'demo' | 'supabase';
  user: { id: string; full_name: string; email: string };
  universities: { id: string; name: string; code: string; timezone: string }[];
  assignments: { university_id: string; role: Role; department_id: string | null; class_id: string | null; course_offering_id: string | null }[];
};

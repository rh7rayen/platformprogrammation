import { Body, Controller, ForbiddenException, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AcademicService } from '../academic/academic.service';
import { Actor, AuthGuard, type ActorContext } from '../auth/auth.guard';
import { assignmentSchema, enrollmentSchema, membershipSchema, uuid } from '../../../packages/contracts/src';

@Controller('universities/:universityId') @UseGuards(AuthGuard)
export class UsersController {
  constructor(@Inject(AcademicService) private readonly academic:AcademicService) {}
  @Get('users') users(@Actor() a:ActorContext,@Param('universityId') u:string) {
    return this.academic.scope(a.id,u,async c=>({data:(await c.query(`select p.id,p.full_name,p.email,m.status,coalesce(array_agg(distinct r.role) filter(where r.role is not null),'{}') roles
      from public.profiles p join public.university_memberships m on m.user_id=p.id
      left join public.role_assignments r on r.user_id=p.id and r.university_id=m.university_id
      where m.university_id=$1 group by p.id,m.status order by p.full_name limit 100`,[u])).rows}));
  }
  @Post('memberships') membership(@Actor() a:ActorContext,@Param('universityId') u:string,@Body() body:unknown) {
    const input=membershipSchema.parse(body);
    return this.academic.scope(a.id,u,async c=>{
      const allowed=await c.query<{allowed:boolean}>('select private.is_admin($1) allowed',[u]);
      if(!allowed.rows[0].allowed) throw new ForbiddenException();
      await c.query('insert into public.university_memberships(university_id,user_id) values($1,$2) on conflict do nothing',[u,input.user_id]);
      const result=await c.query('insert into public.role_assignments(university_id,user_id,role,department_id,class_id,course_offering_id) values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id',[u,input.user_id,input.role,input.department_id??null,input.class_id??null,input.course_offering_id??null]);
      return {assigned:true,created:result.rows.length>0};
    });
  }
  @Patch('users/:userId/status') status(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('userId') userId:string,@Body() body:unknown) {
    uuid.parse(userId);
    const input=z.object({status:z.enum(['ACTIVE','SUSPENDED'])}).strict().parse(body);
    return this.academic.scope(a.id,u,async c=>{
      const result=await c.query('update public.university_memberships set status=$1 where university_id=$2 and user_id=$3 returning user_id,status',[input.status,u,userId]);
      if(!result.rows.length) throw new ForbiddenException('Modification non autorisée.');
      return result.rows[0];
    });
  }
  @Get('teaching-assignments') assignments(@Actor() a:ActorContext,@Param('universityId') u:string) {
    return this.academic.scope(a.id,u,async c=>({data:(await c.query('select * from public.teaching_assignments where university_id=$1 order by created_at desc limit 100',[u])).rows}));
  }
  @Post('teaching-assignments') assign(@Actor() a:ActorContext,@Param('universityId') u:string,@Body() body:unknown) {
    const input=assignmentSchema.parse(body);
    return this.academic.scope(a.id,u,async c=>(await c.query('insert into public.teaching_assignments(university_id,teacher_id,course_offering_id) values($1,$2,$3) returning *',[u,input.teacher_id,input.course_offering_id])).rows[0]);
  }
  @Get('enrollments') enrollments(@Actor() a:ActorContext,@Param('universityId') u:string) {
    return this.academic.scope(a.id,u,async c=>({data:(await c.query('select * from public.enrollments where university_id=$1 order by enrolled_at desc limit 100',[u])).rows}));
  }
  @Post('enrollments') enroll(@Actor() a:ActorContext,@Param('universityId') u:string,@Body() body:unknown) {
    const input=enrollmentSchema.parse(body);
    return this.academic.scope(a.id,u,async c=>(await c.query('insert into public.enrollments(university_id,student_id,class_id,group_id) values($1,$2,$3,$4) returning *',[u,input.student_id,input.class_id,input.group_id??null])).rows[0]);
  }
  @Get('audit') audit(@Actor() a:ActorContext,@Param('universityId') u:string) {
    return this.academic.scope(a.id,u,async c=>({data:(await c.query('select * from public.audit_logs where university_id=$1 order by created_at desc limit 100',[u])).rows}));
  }
}

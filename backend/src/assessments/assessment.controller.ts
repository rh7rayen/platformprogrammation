import { Body,Controller,Get,Inject,Param,ParseUUIDPipe,Post,Put,UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Actor,AuthGuard,type ActorContext } from '../auth/auth.guard';
import { assessmentSchema,answerSchema,gradeSchema } from '../../../packages/contracts/src';
import { AssessmentService } from './assessment.service';
@Controller('universities/:universityId') @UseGuards(AuthGuard)
export class AssessmentController {
  constructor(@Inject(AssessmentService) private readonly exams:AssessmentService){}
  @Get('assessments') list(@Actor() a:ActorContext,@Param('universityId') u:string){return this.exams.list(a.id,u);}
  @Post('assessments') create(@Actor() a:ActorContext,@Param('universityId') u:string,@Body() body:unknown){return this.exams.create(a.id,u,assessmentSchema.parse(body));}
  @Get('assessments/:id') details(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string){return this.exams.details(a.id,u,id);}
  @Put('assessments/:id') update(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){return this.exams.update(a.id,u,id,assessmentSchema.parse(body));}
  @Post('assessments/:id/publish') publish(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string){return this.exams.publish(a.id,u,id);}
  @Post('assessment-access/redeem') redeem(@Actor() a:ActorContext,@Param('universityId') u:string,@Body() body:unknown){return this.exams.redeem(a.id,u,z.object({code:z.string().min(4).max(80)}).strict().parse(body).code);}
  @Post('assessments/:id/attempts') start(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string){return this.exams.start(a.id,u,id);}
  @Get('attempts/:id') attempt(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string){return this.exams.attempt(a.id,u,id);}
  @Put('attempts/:id/answers/:questionId') save(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string,@Param('questionId',ParseUUIDPipe) q:string,@Body() body:unknown){const input=answerSchema.parse(body);return this.exams.save(a.id,u,id,q,input.answer_text,input.expected_version);}
  @Post('attempts/:id/finalize') finalize(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string){return this.exams.finalize(a.id,u,id);}
  @Get('assessments/:id/submissions') submissions(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string){return this.exams.submissions(a.id,u,id);}
  @Get('assessments/:id/submissions/:submissionId') submission(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string,@Param('submissionId',ParseUUIDPipe) s:string){return this.exams.submission(a.id,u,id,s);}
  @Post('assessments/:id/submissions/:submissionId/grades') grade(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string,@Param('submissionId',ParseUUIDPipe) s:string,@Body() body:unknown){return this.exams.grade(a.id,u,id,s,gradeSchema.parse(body));}
  @Post('assessments/:id/results/publish') results(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string){return this.exams.publishResults(a.id,u,id);}
}

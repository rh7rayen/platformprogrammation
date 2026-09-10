import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { AcademicService } from '../academic/academic.service';
import { Actor, AuthGuard, type ActorContext } from '../auth/auth.guard';
import { aiInputSchema } from '../../../packages/contracts/src';
@Controller('universities/:universityId/ai') @UseGuards(AuthGuard)
export class AiController {
  constructor(@Inject(AiService) private readonly ai:AiService,@Inject(AcademicService) private readonly academic:AcademicService) {}
  @Get('status') status(@Actor() a:ActorContext,@Param('universityId') u:string) { return this.academic.scope(a.id,u,async()=>({available:this.ai.available(),daily_limit:this.ai.config.AI_DAILY_LIMIT,human_review_required:true})); }
  @Get('drafts') list(@Actor() a:ActorContext,@Param('universityId') u:string) { return this.academic.scope(a.id,u,async c=>({data:(await c.query('select id,subject_id,questions,review_status,created_at from public.ai_drafts where university_id=$1 order by created_at desc limit 50',[u])).rows})); }
  @Post('drafts') generate(@Actor() a:ActorContext,@Param('universityId') u:string,@Body() body:unknown) { return this.ai.generate(a.id,u,aiInputSchema.parse(body)); }
}

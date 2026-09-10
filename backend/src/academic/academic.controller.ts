import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AcademicService } from './academic.service';
import { Actor, AuthGuard, type ActorContext } from '../auth/auth.guard';
@Controller('universities/:universityId') @UseGuards(AuthGuard)
export class AcademicController {
  constructor(@Inject(AcademicService) private readonly academic:AcademicService) {}
  @Get('dashboard') dashboard(@Actor() a:ActorContext,@Param('universityId') u:string) { return this.academic.dashboard(a.id,u); }
  @Get('academic-structure/:resource') list(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('resource') resource:string,@Query() query:unknown) {
    const q=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),search:z.string().max(120).default('')}).strict().parse(query);
    return this.academic.list(a.id,u,resource,q.page,q.search);
  }
  @Post('academic-structure/:resource') create(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('resource') resource:string,@Body() body:unknown) { return this.academic.create(a.id,u,resource,body); }
}

import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { Actor, AuthGuard, type ActorContext } from './auth.guard';
import { demoAccounts } from '../database/seed';
import {createHash} from 'node:crypto';
import {RequestLimit} from './request-limit';
@Controller('auth')
export class AuthController {
  private readonly attempts=new RequestLimit(30,10000);
  constructor(@Inject(AuthService) private readonly auth:AuthService) {}
  @Get('config') config() {
    return {mode:this.auth.config.APP_MODE,accounts:this.auth.config.APP_MODE==='demo'?demoAccounts.filter(a=>a.role!=='UNIVERSITY_ADMIN'||a.id===demoAccounts[0].id):[],self_registration:false};
  }
  @Post('login') login(@Body() body:unknown) { const input=z.object({email:z.email().max(254),password:z.string().min(1).max(256)}).strict().parse(body); this.attempts.consume(createHash('sha256').update(input.email.trim().toLowerCase()).digest('hex'));return this.auth.login(input.email,input.password); }
  @Post('demo') demo(@Body() body:unknown) { const {user_id}=z.object({user_id:z.uuid()}).strict().parse(body);this.attempts.consume(user_id);return this.auth.demoLogin(user_id); }
  @Get('me') @UseGuards(AuthGuard) profile(@Actor() actor:ActorContext) { return this.auth.profile(actor.id); }
  @Post('logout') @UseGuards(AuthGuard) logout(@Actor() actor:ActorContext) { return this.auth.logout(actor.token); }
}

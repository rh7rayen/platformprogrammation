import 'reflect-metadata';
import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, HttpException, Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { Database } from './database/database';
import { seedDemo } from './database/seed';
import { seedDemoAssessments } from './database/seed-assessments';
import { seedEngineering } from './database/seed-engineering';
import type { AppConfig } from './config';
import { AuthService, CONFIG } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AcademicService } from './academic/academic.service';
import { AcademicController } from './academic/academic.controller';
import { UsersController } from './users/users.controller';
import { AiService } from './ai/ai.service';
import { AiController } from './ai/ai.controller';
import { AssessmentService } from './assessments/assessment.service';
import { AssessmentController } from './assessments/assessment.controller';
import { ExecutionService } from './execution/execution.service';
import { ExecutionController } from './execution/execution.controller';
import { MonitoringService } from './monitoring/monitoring.service';
import { MonitoringController } from './monitoring/monitoring.controller';
import { RecordingStorage } from './monitoring/recording-storage';
import { InvitationService } from './invitations/invitation.service';
import { InvitationController } from './invitations/invitation.controller';
import { IntegrityController } from './integrity/integrity.controller';
import { IntegrityService } from './integrity/integrity.service';

@Catch()
class ApiErrorFilter implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost) {
    const response=host.switchToHttp().getResponse<Response>();
    let status=500,message='Une erreur interne est survenue.';
    if(error instanceof HttpException) { status=error.getStatus(); message=error.message; }
    else if(error instanceof ZodError) {status=400;message=error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join(' · ');}
    else if(error && typeof error==='object' && 'code' in error) {
      const code=String(error.code);
      if(code==='42501') {status=403;message='Action interdite dans ce périmètre.';}
      if(code==='23505') {status=409;message='Cet enregistrement existe déjà.';}
      if(['23503','23514','23502','22P02'].includes(code)) {status=400;message='Données incohérentes : vérifiez les relations, les dates et le périmètre.';}
      if(code==='57014') {status=503;message='Requête trop longue. Réessayez.';}
    }
    if(status===500) console.error(JSON.stringify({level:'error',event:'request_failed',request_id:response.getHeader('x-request-id'),error_type:error instanceof Error?error.name:'Unknown'}));
    response.status(status).json({statusCode:status,message,requestId:response.getHeader('x-request-id')});
  }
}
@Controller('health')
class HealthController {
  constructor(@Inject(Database) private readonly db:Database) {}
  @Get('live') live() { return {status:'ok',version:'0.1.0'}; }
  @Get('ready') async ready() { await this.db.privileged(c=>c.query('select name from private.schema_migrations limit 1')); return {status:'ready'}; }
}
export async function createApp(config:AppConfig,options:{memory?:boolean;quiet?:boolean}={}) {
  const database=new Database(config);
  try { await database.connect(options.memory); if(config.APP_MODE==='demo') {await seedDemo(database);await seedDemoAssessments(database);await seedEngineering(database);} }
  catch(error) {await database.close();throw error;}
  @Module({
    controllers:[HealthController,AuthController,AcademicController,UsersController,AiController,AssessmentController,ExecutionController,MonitoringController,InvitationController,IntegrityController],
    providers:[{provide:CONFIG,useValue:config},{provide:Database,useValue:database},AuthService,AuthGuard,AcademicService,AiService,AssessmentService,ExecutionService,MonitoringService,RecordingStorage,InvitationService,IntegrityService],
  }) class ApplicationModule {}
  const app=await NestFactory.create(ApplicationModule,{logger:options.quiet?false:['error','warn','log']});
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use((req:Request,res:Response,next:NextFunction)=>{res.setHeader('x-request-id',randomUUID());res.setHeader('Cache-Control','no-store');next();});
  app.useGlobalFilters(new ApiErrorFilter());
  await app.init();
  return {app,database,close:async()=>{await app.close();await database.close();}};
}

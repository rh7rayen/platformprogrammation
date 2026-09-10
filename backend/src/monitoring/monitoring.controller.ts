import {Body,Controller,Get,Inject,Param,ParseUUIDPipe,Post,UseGuards} from '@nestjs/common';
import {z} from 'zod';
import {Actor,AuthGuard,type ActorContext} from '../auth/auth.guard';
import {MonitoringService} from './monitoring.service';
import {MAX_RECORDING_CHUNK_BYTES} from './recording-storage';
const chunkSchema=z.object({sequence:z.number().int().min(0).max(1999),size_bytes:z.number().int().min(1).max(MAX_RECORDING_CHUNK_BYTES),mime_type:z.enum(['video/webm','video/mp4'])}).strict();
@Controller('universities/:universityId/attempts/:attemptId') @UseGuards(AuthGuard)
export class MonitoringController {
  constructor(@Inject(MonitoringService) private readonly monitoring:MonitoringService){}
  @Get('recording') status(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('attemptId',ParseUUIDPipe) t:string){return this.monitoring.status(a.id,u,t);}
  @Post('recording/sessions') start(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('attemptId',ParseUUIDPipe) t:string,@Body() body:unknown){z.object({consented:z.literal(true),consent_version:z.literal('screen-v1')}).strict().parse(body);return this.monitoring.start(a.id,u,t);}
  @Post('recording/sessions/:sessionId/chunks') reserve(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('attemptId',ParseUUIDPipe) t:string,@Param('sessionId',ParseUUIDPipe) s:string,@Body() body:unknown){return this.monitoring.reserve(a.id,u,t,s,chunkSchema.parse(body));}
  @Post('recording/sessions/:sessionId/chunks/:chunkId/complete') complete(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('attemptId',ParseUUIDPipe) t:string,@Param('sessionId',ParseUUIDPipe) s:string,@Param('chunkId',ParseUUIDPipe) id:string){return this.monitoring.complete(a.id,u,t,s,id);}
  @Post('recording/sessions/:sessionId/stop') stop(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('attemptId',ParseUUIDPipe) t:string,@Param('sessionId',ParseUUIDPipe) s:string){return this.monitoring.stop(a.id,u,t,s);}
  @Get('recordings') list(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('attemptId',ParseUUIDPipe) t:string){return this.monitoring.list(a.id,u,t);}
  @Get('recordings/:chunkId/play') play(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('attemptId',ParseUUIDPipe) t:string,@Param('chunkId',ParseUUIDPipe) id:string){return this.monitoring.play(a.id,u,t,id);}
}

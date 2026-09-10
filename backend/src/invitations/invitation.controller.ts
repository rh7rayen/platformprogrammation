import {Body,Controller,Get,Inject,Param,ParseUUIDPipe,Post,UseGuards} from '@nestjs/common';
import {z} from 'zod';
import {Actor,AuthGuard,type ActorContext} from '../auth/auth.guard';
import {InvitationService} from './invitation.service';
@Controller('universities/:universityId/assessments/:assessmentId') @UseGuards(AuthGuard)
export class InvitationController {
  constructor(@Inject(InvitationService) readonly service:InvitationService){}
  @Get('recipients') recipients(@Actor() actor:ActorContext,@Param('universityId',ParseUUIDPipe) u:string,@Param('assessmentId',ParseUUIDPipe) a:string){return this.service.recipients(actor.id,u,a);}
  @Post('invitations') invite(@Actor() actor:ActorContext,@Param('universityId',ParseUUIDPipe) u:string,@Param('assessmentId',ParseUUIDPipe) a:string,@Body() input:unknown){const body=z.object({emails:z.array(z.email().max(254)).min(1).max(100),retry_failed:z.boolean().default(false)}).strict().parse(input);return this.service.queue(actor.id,u,a,body.emails,body.retry_failed);}
}

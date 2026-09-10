import {Body,Controller,Get,Inject,Param,ParseUUIDPipe,Post,UseGuards} from '@nestjs/common';
import {Actor,AuthGuard,type ActorContext} from '../auth/auth.guard';
import {executionRequestSchema} from '../../../packages/contracts/src/runtimes';
import {ExecutionService} from './execution.service';
@Controller('universities/:universityId') @UseGuards(AuthGuard)
export class ExecutionController {
  constructor(@Inject(ExecutionService) private readonly execution:ExecutionService){}
  @Get('execution/runtimes') runtimes(@Actor() a:ActorContext,@Param('universityId') u:string){return this.execution.runtimes(a.id,u);}
  @Post('attempts/:id/questions/:questionId/runs') run(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string,@Param('questionId',ParseUUIDPipe) q:string,@Body() body:unknown){return this.execution.enqueue(a.id,u,id,q,executionRequestSchema.parse(body??{}));}
  @Get('attempts/:id/runs/:runId') get(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string,@Param('runId',ParseUUIDPipe) run:string){return this.execution.get(a.id,u,id,run);}
  @Get('attempts/:id/runs/:runId/preview') preview(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('id',ParseUUIDPipe) id:string,@Param('runId',ParseUUIDPipe) run:string){return this.execution.preview(a.id,u,id,run);}
}

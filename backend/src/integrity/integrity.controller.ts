import {Controller,Inject,Param,ParseUUIDPipe,Post,UseGuards} from '@nestjs/common';
import {Actor,AuthGuard,type ActorContext} from '../auth/auth.guard';
import {IntegrityService} from './integrity.service';
@Controller('universities/:universityId/assessments/:assessmentId') @UseGuards(AuthGuard)
export class IntegrityController {
  constructor(@Inject(IntegrityService) private readonly integrity:IntegrityService){}
  @Post('integrity') analyze(@Actor() a:ActorContext,@Param('universityId') u:string,@Param('assessmentId',ParseUUIDPipe) id:string){return this.integrity.analyze(a.id,u,id);}
}

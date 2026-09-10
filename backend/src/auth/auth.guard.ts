import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RequestLimit } from './request-limit';
export type AuthRequest = Request & { actor:{id:string;token:string} };
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly writes=new RequestLimit(120);
  constructor(@Inject(AuthService) private readonly auth:AuthService) {}
  async canActivate(context:ExecutionContext) {
    const req=context.switchToHttp().getRequest<AuthRequest>();
    const header=req.headers.authorization;
    if(!header || !header.startsWith('Bearer ')) throw new UnauthorizedException('Connexion requise.');
    const token=header.slice(7);
    req.actor={id:await this.auth.authenticate(token),token};
    if(req.method!=='GET')this.writes.consume(req.actor.id);
    return true;
  }
}
export const Actor=createParamDecorator((_:unknown,ctx:ExecutionContext)=>ctx.switchToHttp().getRequest<AuthRequest>().actor);
export type ActorContext={id:string;token:string};

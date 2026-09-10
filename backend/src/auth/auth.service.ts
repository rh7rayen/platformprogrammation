import { Inject, Injectable, UnauthorizedException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { Database } from '../database/database';
import { demoAccounts } from '../database/seed';
import type { AppConfig } from '../config';
import type { SessionProfile } from '../../../packages/contracts/src';

export const CONFIG = 'APP_CONFIG';
export const tokenHash = (token:string) => createHash('sha256').update(token).digest('hex');
@Injectable()
export class AuthService {
  constructor(@Inject(Database) private readonly db:Database, @Inject(CONFIG) readonly config:AppConfig) {}
  private supabase() {
    // Each call keeps an isolated auth client; a cached mutable sign-in client
    // could retain another user's session. Bound every identity-provider call.
    return createClient(this.config.SUPABASE_URL,this.config.SUPABASE_PUBLISHABLE_KEY,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{fetch:(url,init)=>fetch(url,{...init,redirect:'error',signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)})},
    });
  }
  async login(email:string,password:string) {
    if(this.config.APP_MODE!=='supabase') throw new NotFoundException('Utilisez un compte de démonstration.');
    const {data,error}=await this.supabase().auth.signInWithPassword({email,password});
    if(error || !data.session) throw new UnauthorizedException('Identifiants invalides ou compte indisponible.');
    await this.register(data.user.id,data.session.access_token,data.session.expires_in);
    return {access_token:data.session.access_token,expires_in:data.session.expires_in};
  }
  async demoLogin(userId:string) {
    if(this.config.APP_MODE!=='demo') throw new NotFoundException();
    if(!demoAccounts.some(a=>a.id===userId)) throw new UnauthorizedException();
    const token=randomBytes(48).toString('base64url');
    await this.register(userId,token,3600);
    return {access_token:token,expires_in:3600};
  }
  private async register(userId:string,token:string,seconds:number) {
    const expires=new Date(Date.now()+Math.min(seconds,3600)*1000).toISOString();
    await this.db.privileged(async c=>{
      const exists=await c.query('select id from public.profiles where id=$1',[userId]);
      if(!exists.rows.length) throw new UnauthorizedException('Ce compte doit être activé par votre établissement.');
      await c.query('delete from private.auth_sessions where expires_at < now()');
      await c.query('insert into private.auth_sessions(token_hash,user_id,expires_at) values($1,$2,$3) on conflict(token_hash) do update set expires_at=excluded.expires_at,revoked_at=null',[tokenHash(token),userId,expires]);
    });
  }
  async authenticate(token:string) {
    if(token.length<20 || token.length>8192) throw new UnauthorizedException('Session invalide.');
    const result=await this.db.privileged(c=>c.query<{user_id:string}>('select user_id from private.auth_sessions where token_hash=$1 and revoked_at is null and expires_at>now()',[tokenHash(token)]));
    if(!result.rows.length) throw new UnauthorizedException('Session expirée. Reconnectez-vous.');
    if(this.config.APP_MODE==='supabase') {
      let response;
      try { response=await this.supabase().auth.getUser(token); } catch { throw new ServiceUnavailableException('Authentification temporairement indisponible.'); }
      if(response.error || !response.data.user || response.data.user.id!==result.rows[0].user_id) throw new UnauthorizedException('Session révoquée.');
    }
    return result.rows[0].user_id;
  }
  async logout(token:string) {
    await this.db.privileged(c=>c.query('update private.auth_sessions set revoked_at=now() where token_hash=$1',[tokenHash(token)]));
    if(this.config.APP_MODE==='supabase') {
      // Local revocation is already durable even if the identity provider is unavailable.
      try { await fetch(`${this.config.SUPABASE_URL}/auth/v1/logout?scope=local`,{method:'POST',headers:{apikey:this.config.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)}); } catch { /* App session remains revoked. */ }
    }
    return {revoked:true};
  }
  async profile(userId:string):Promise<SessionProfile> {
    return this.db.asUser(userId,async c=>{
      const user=await c.query<SessionProfile['user']>('select id,full_name,email from public.profiles where id=$1',[userId]);
      if(!user.rows[0]) throw new UnauthorizedException();
      const universities=await c.query<SessionProfile['universities'][number]>('select id,name,code,timezone from public.universities order by name');
      const assignments=await c.query<SessionProfile['assignments'][number]>('select university_id,role,department_id,class_id,course_offering_id from public.role_assignments where user_id=$1',[userId]);
      return {mode:this.config.APP_MODE,user:user.rows[0],universities:universities.rows,assignments:assignments.rows};
    });
  }
}

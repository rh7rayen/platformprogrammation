import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Database, type SqlClient } from '../database/database';
import { catalog, uuid, type CatalogKey } from '../../../packages/contracts/src';
@Injectable()
export class AcademicService {
  constructor(@Inject(Database) readonly db:Database) {}
  async scope<T>(userId:string,universityId:string,work:(client:SqlClient)=>Promise<T>) {
    uuid.parse(universityId);
    return this.db.asUser(userId,async c=>{
      const allowed=await c.query('select id from public.universities where id=$1',[universityId]);
      if(!allowed.rows.length) throw new ForbiddenException('Établissement non autorisé.');
      return work(c);
    });
  }
  key(value:string):CatalogKey { if(!Object.hasOwn(catalog,value)) throw new BadRequestException('Ressource inconnue.'); return value as CatalogKey; }
  list(userId:string,u:string,resource:string,page:number,search:string) {
    const key=this.key(resource);
    return this.scope(userId,u,async c=>{
      const query=`from public.${key} where university_id=$1 and name ilike $2`;
      const params=[u,`%${search.replace(/[\\%_]/g,'\\$&')}%`];
      const count=await c.query<{count:string}>(`select count(*) ${query}`,params);
      const data=await c.query(`select * ${query} order by created_at desc,id limit 50 offset $3`,[...params,(page-1)*50]);
      return {data:data.rows,page,page_size:50,total:Number(count.rows[0].count)};
    });
  }
  create(userId:string,u:string,resource:string,body:unknown) {
    const key=this.key(resource), input=catalog[key].schema.parse(body) as Record<string,unknown>;
    return this.scope(userId,u,async c=>{
      const entries=Object.entries(input).filter(([,v])=>v!==undefined);
      const keys=entries.map(([k])=>k), values=entries.map(([,v])=>v);
      const data=await c.query(`insert into public.${key}(university_id,${keys.join(',')}) values($1,${keys.map((_,i)=>`$${i+2}`).join(',')}) returning *`,[u,...values]);
      return data.rows[0];
    });
  }
  dashboard(userId:string,u:string) {
    return this.scope(userId,u,async c=>{
      const stats:Record<string,number>={};
      for(const key of ['classes','subjects','departments','course_offerings','enrollments','teaching_assignments']) {
        const count=await c.query<{count:string}>(`select count(*) from public.${key} where university_id=$1`,[u]);
        stats[key]=Number(count.rows[0].count);
      }
      const subjects=await c.query('select * from public.subjects where university_id=$1 order by created_at,id limit 4',[u]);
      const classes=await c.query('select id,name,code,capacity from public.classes where university_id=$1 order by code limit 6',[u]);
      return {stats,subjects:subjects.rows,classes:classes.rows};
    });
  }
}

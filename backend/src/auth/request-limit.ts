import {HttpException} from '@nestjs/common';
/** Per-instance defence. Production replicas must also use a shared gateway limiter. */
export class RequestLimit{
 private readonly entries=new Map<string,{count:number;expires:number}>();private lastSweep=0;
 constructor(private readonly maximum:number,private readonly capacity=100000){}
 consume(key:string){const now=Date.now();if(now-this.lastSweep>=60000){for(const [id,row] of this.entries)if(row.expires<=now)this.entries.delete(id);this.lastSweep=now;}
  let entry=this.entries.get(key);if(!entry||entry.expires<=now){if(!entry&&this.entries.size>=this.capacity)throw new HttpException('Service occupé. Réessayez dans une minute.',429);entry={count:0,expires:now+60000};this.entries.set(key,entry);}
  if(++entry.count>this.maximum)throw new HttpException('Trop de demandes pour ce compte. Réessayez dans une minute.',429);
 }
}

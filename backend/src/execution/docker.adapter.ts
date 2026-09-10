import {ServiceUnavailableException} from '@nestjs/common';
import {z} from 'zod';
import {RUNTIME_CATALOG,runtimeSchema,type RuntimeId} from '../../../packages/contracts/src/runtimes';
import type {RunnerConfig,RunnerDiscovery,RunnerResult} from './judge0.adapter';

const healthSchema=z.object({engine:z.literal('uniexam-docker'),protocol:z.literal(1),network_disabled:z.literal(true),privileged:z.literal(false)});
const catalogSchema=z.object({runtimes:z.array(z.object({id:runtimeSchema,version:z.string().trim().min(1).max(120),image:z.string().trim().min(1).max(256),available:z.boolean()})).max(32)});
const resultSchema=z.object({
  status:z.enum(['QUEUED','PROCESSING','SUCCEEDED','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT','FAILED']),
  stdout:z.string().max(32768),stderr:z.string().max(32768),compile_output:z.string().max(32768),message:z.string().max(2000),
  time_seconds:z.number().finite().min(0).max(3600).nullable(),memory_kb:z.number().int().min(0).max(16777216).nullable(),
});
const unavailable=()=>new ServiceUnavailableException('Le runner Docker isolé est indisponible ou son protocole de sécurité n’est pas validé. Le code enregistré reste conservé.');
function output(value:string){if(Buffer.byteLength(value)>32768)throw unavailable();return value.replace(/\u0000/g,'');}

/** HTTP client only. The Nest process never imports Docker or starts a subprocess. */
export class DockerAdapter {
  private cache?:{expires:number;value:RunnerDiscovery};private discovery?:Promise<RunnerDiscovery>;
  constructor(private readonly config:RunnerConfig){}
  private settings(){
    if(this.config.RUNNER_ENABLED!=='true')throw unavailable();
    let url:URL;try{url=new URL(this.config.RUNNER_BASE_URL);}catch{throw unavailable();}
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)
      ||(url.protocol==='http:'&&(!local||this.config.NODE_ENV==='production'))||this.config.RUNNER_AUTH_TOKEN.length<16)throw unavailable();
    return {url:url.toString().replace(/\/$/,''),token:this.config.RUNNER_AUTH_TOKEN};
  }
  private async json(endpoint:string,init:RequestInit={},maximum=180000,timeoutMs=5000):Promise<unknown>{
    const {url,token}=this.settings();let response:Response;
    try{response=await fetch(`${url}${endpoint}`,{...init,headers:{'Content-Type':'application/json','X-Auth-Token':token},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{throw unavailable();}
    if(!response.ok||!response.body)throw unavailable();
    if(Number(response.headers.get('content-length')??0)>maximum){await response.body.cancel();throw unavailable();}
    const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
    try{
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maximum){await reader.cancel();throw unavailable();}chunks.push(part.value);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    }catch{throw unavailable();}finally{reader.releaseLock();}
  }
  async discover():Promise<RunnerDiscovery>{
    if(this.cache&&this.cache.expires>Date.now())return this.cache.value;if(this.discovery)return this.discovery;
    this.discovery=this.inspect().catch(()=>({languages:{},reason:this.config.RUNNER_ENABLED==='true'?'Docker indisponible, images non validées ou protocole de sécurité refusé.':'Aucun runner Docker isolé connecté.'})).then(value=>{this.cache={expires:Date.now()+15000,value};return value;}).finally(()=>{this.discovery=undefined;});
    return this.discovery;
  }
  private async inspect():Promise<RunnerDiscovery>{
    const [health,rawCatalog]=await Promise.all([this.json('/health',{},4000,12000),this.json('/runtimes',{},16000,12000)]);
    healthSchema.parse(health);const catalog=catalogSchema.parse(rawCatalog);
    if(new Set(catalog.runtimes.map(runtime=>runtime.id)).size!==catalog.runtimes.length)throw unavailable();
    const languages:RunnerDiscovery['languages']={};
    for(const entry of catalog.runtimes){
      const definition=RUNTIME_CATALOG.find(runtime=>runtime.id===entry.id);
      if(entry.available&&definition?.kind==='REMOTE')languages[entry.id]={name:`${definition.label} ${entry.version} · Docker`};
    }
    return {languages,reason:Object.keys(languages).length?'Runner Docker isolé connecté ; runtimes validés.':'Le runner Docker répond ; aucune image de langage validée n’est encore disponible.'};
  }
  async submit(runtime:RuntimeId,source:string,stdin:string):Promise<string>{
    if(!(await this.discover()).languages[runtime])throw unavailable();
    if(!source.trim()||Buffer.byteLength(source)>30000||Buffer.byteLength(stdin)>4000)throw unavailable();
    // Runtime comes from the saved exam question. No image, command, URL, path,
    // resource override or Docker option can be supplied by an exam candidate.
    const response=await this.json('/runs',{method:'POST',body:JSON.stringify({runtime,source,stdin})},2000);
    return z.object({id:z.uuid()}).parse(response).id;
  }
  async result(id:string):Promise<RunnerResult>{
    if(!z.uuid().safeParse(id).success)throw unavailable();
    const result=resultSchema.parse(await this.json(`/runs/${encodeURIComponent(id)}`));
    return {...result,status:result.status==='QUEUED'?'PROCESSING':result.status,stdout:output(result.stdout),stderr:output(result.stderr),compile_output:output(result.compile_output),message:result.message.replace(/\u0000/g,'')};
  }
  async preview(id:string):Promise<{html:string}>{
    if(!z.uuid().safeParse(id).success)throw unavailable();
    const result=z.object({html:z.string().min(1).max(2*1024*1024)}).strict().parse(await this.json(`/runs/${encodeURIComponent(id)}/preview`,{},3*1024*1024));
    if(Buffer.byteLength(result.html)>2*1024*1024)throw unavailable();
    return result;
  }
}

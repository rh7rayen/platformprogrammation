import { ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { RUNTIME_CATALOG,type RuntimeId,type ExecutionStatus } from '../../../packages/contracts/src/runtimes';
import type { AppConfig } from '../config';

export type RunnerConfig=AppConfig & {RUNNER_ENABLED?:string;RUNNER_BASE_URL?:string;RUNNER_AUTH_TOKEN?:string;RUNNER_LANGUAGE_IDS?:string};
const languageNames:Partial<Record<RuntimeId,RegExp>>={python:/^Python\b/i,php:/^PHP\b/i,java:/^Java\b/i,javascript:/^JavaScript\b/i,typescript:/^TypeScript\b/i,c:/^C\s*\(/,cpp:/^C\+\+\b|^C\+\+\s/i,csharp:/^C#\b|^C#\s/i,go:/^Go\b/i,rust:/^Rust\b/i,ruby:/^Ruby\b/i,bash:/^Bash\b/i,sql:/^SQL\s*\(SQLite\b|^SQLite\b/i};
const languageMapSchema=z.partialRecord(z.enum(RUNTIME_CATALOG.filter(r=>r.kind==='REMOTE').map(r=>r.id)),z.number().int().min(1).max(10000));
const languagesSchema=z.array(z.object({id:z.number().int(),name:z.string().max(200)})).max(500);
const resultSchema=z.object({status:z.object({id:z.number().int().min(1).max(14)}),stdout:z.string().nullable().optional(),stderr:z.string().nullable().optional(),compile_output:z.string().nullable().optional(),time:z.union([z.string().max(20),z.number()]).nullable().optional(),memory:z.number().int().nonnegative().max(10000000).nullable().optional()});
export type RunnerDiscovery={languages:Partial<Record<RuntimeId,{id?:number;name:string}>>;reason:string};
export type RunnerResult={status:ExecutionStatus;stdout:string;stderr:string;compile_output:string;time_seconds:number|null;memory_kb:number|null;message:string};
const unavailable=()=>new ServiceUnavailableException('Le serveur d’exécution isolé est indisponible ou sa configuration n’est pas validée. Votre copie reste enregistrée.');
function decode(value:string|null|undefined):string {
  if(!value)return '';
  // Output is treated as untrusted text, never HTML, commands or file paths.
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>32768)throw unavailable();
  return bytes.toString('utf8').replace(/\u0000/g,'');
}

export class Judge0Adapter {
  private cache?:{expires:number;value:RunnerDiscovery};
  private discovery?:Promise<RunnerDiscovery>;
  constructor(private readonly config:RunnerConfig){}
  private settings(){
    if(this.config.RUNNER_ENABLED!=='true')throw unavailable();
    let url:URL,map:Partial<Record<RuntimeId,number>>;
    try {url=new URL(this.config.RUNNER_BASE_URL??'');map=languageMapSchema.parse(JSON.parse(this.config.RUNNER_LANGUAGE_IDS??'{}'));}catch{throw unavailable();}
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)
      ||(url.protocol!=='https:'&&(!local||this.config.NODE_ENV==='production'))
      ||(this.config.RUNNER_AUTH_TOKEN??'').length<16)throw unavailable();
    // Never fall back to a public sample service with private student source code.
    if(['ce.judge0.com','api.judge0.com','judge0-ce.p.rapidapi.com'].includes(url.hostname))throw unavailable();
    return {url:url.toString().replace(/\/$/,''),token:this.config.RUNNER_AUTH_TOKEN!,map};
  }
  private async json(endpoint:string,init:RequestInit={},maxBytes=180000):Promise<unknown>{
    const {url,token}=this.settings();
    let response:Response;
    try {response=await fetch(`${url}${endpoint}`,{...init,headers:{'Content-Type':'application/json','X-Auth-Token':token},redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw unavailable();}
    if(!response.ok||!response.body)throw unavailable();
    if(Number(response.headers.get('content-length')??0)>maxBytes){await response.body.cancel();throw unavailable();}
    const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw unavailable();}chunks.push(value);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    }catch{throw unavailable();}finally{reader.releaseLock();}
  }
  async discover():Promise<RunnerDiscovery>{
    if(this.cache&&Date.now()<this.cache.expires)return this.cache.value;
    if(this.discovery)return this.discovery;
    this.discovery=this.inspect().catch(()=>({languages:{},reason:this.config.RUNNER_ENABLED==='true'?'Runner indisponible ou configuration de sécurité non validée.':'Aucun runner isolé connecté.'})).then(value=>{this.cache={expires:Date.now()+15000,value};return value;}).finally(()=>{this.discovery=undefined;});
    return this.discovery;
  }
  private async inspect():Promise<RunnerDiscovery>{
    const {map}=this.settings();
    const [rawLanguages,rawSettings,rawAbout]=await Promise.all([this.json('/languages'),this.json('/config_info'),this.json('/about')]);
    const policy=z.object({enable_network:z.literal(false),allow_enable_network:z.literal(false)}).parse(rawSettings);
    const about=z.object({version:z.string()}).parse(rawAbout),version=about.version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if(!version||Number(version[1])<1||(Number(version[1])===1&&(Number(version[2])<13||(Number(version[2])===13&&Number(version[3])<1)))||policy.enable_network)throw unavailable();
    const languages:RunnerDiscovery['languages']={};
    for(const language of languagesSchema.parse(rawLanguages)){
      for(const runtime of RUNTIME_CATALOG.filter(r=>r.kind==='REMOTE')){
        if(map[runtime.id]===language.id&&languageNames[runtime.id]?.test(language.name))languages[runtime.id]={id:language.id,name:language.name};
      }
    }
    return {languages,reason:'Runner isolé connecté ; versions vérifiées dans son catalogue.'};
  }
  async submit(runtime:RuntimeId,source:string,stdin:string):Promise<string>{
    const language=(await this.discover()).languages[runtime];if(!language||typeof language.id!=='number')throw unavailable();
    if(Buffer.byteLength(source)>30000||Buffer.byteLength(stdin)>4000)throw unavailable();
    const response=await this.json('/submissions?base64_encoded=true&wait=false',{method:'POST',body:JSON.stringify({
      language_id:language.id,source_code:Buffer.from(source).toString('base64'),stdin:Buffer.from(stdin).toString('base64'),
      cpu_time_limit:3,cpu_extra_time:0.5,wall_time_limit:10,memory_limit:['java','csharp'].includes(runtime)?524288:131072,
      stack_limit:32768,max_processes_and_or_threads:32,max_file_size:16384,number_of_runs:1,
      enable_network:false,enable_per_process_and_thread_time_limit:false,enable_per_process_and_thread_memory_limit:false,
    })},2000);
    return z.object({token:z.string().regex(/^[a-zA-Z0-9_-]{10,100}$/)}).parse(response).token;
  }
  async result(token:string):Promise<RunnerResult>{
    if(!/^[a-zA-Z0-9_-]{10,100}$/.test(token))throw unavailable();
    const raw=await this.json(`/submissions/${encodeURIComponent(token)}?base64_encoded=true&fields=stdout,stderr,compile_output,status,time,memory`);
    const result=resultSchema.parse(raw),id=result.status.id;
    const status:ExecutionStatus=id<=2?'PROCESSING':id===3?'SUCCEEDED':id===5?'TIME_LIMIT':id===6?'COMPILE_ERROR':id===13?'FAILED':'RUNTIME_ERROR';
    const time=result.time==null?null:Number(result.time);
    return {status,stdout:decode(result.stdout),stderr:decode(result.stderr),compile_output:decode(result.compile_output),
      time_seconds:time!==null&&Number.isFinite(time)&&time>=0&&time<=1000?time:null,memory_kb:result.memory??null,
      message:status==='FAILED'?'Le runner n’a pas terminé correctement.':status==='TIME_LIMIT'?'Limite de temps dépassée.':''};
  }
}

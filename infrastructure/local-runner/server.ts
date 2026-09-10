import http,{type IncomingMessage,type ServerResponse} from 'node:http';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DockerEngine,UUID,emptyResult,type RunnerResult,type VerifiedImage} from './engine.js';
import {runtime,type Runtime} from './catalog.js';

type Job={id:string;result:RunnerResult;createdAt:number;finishedAt:number|null;preview?:string};
type Submission={runtime:Runtime;source:string;stdin:string;image:VerifiedImage;job:Job};
type EnginePort=Pick<DockerEngine,'policyHealth'|'availability'|'verified'|'execute'|'stop'>;
export class HttpError extends Error{constructor(readonly status:number,message:string){super(message);}}
const sha=(text:string)=>createHash('sha256').update(text).digest();
function reply(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; frame-ancestors 'none'"});res.end(JSON.stringify(value));}
export async function readBody(req:IncomingMessage):Promise<unknown>{
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))throw new HttpError(415,'Corps JSON requis.');
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw new HttpError(415,'Compression non acceptée.');
  const declared=Number(req.headers['content-length']??0);if(!Number.isFinite(declared)||declared>65536)throw new HttpError(413,'Corps limité à 64 Kio.');
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>65536)throw new HttpError(413,'Corps limité à 64 Kio.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON invalide.');}
}
export function validateSubmission(body:unknown):{runtime:Runtime;source:string;stdin:string}{
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Requête invalide.');
  const value=body as Record<string,unknown>;
  if(Object.keys(value).some(key=>!['runtime','source','stdin'].includes(key))||typeof value.runtime!=='string'||typeof value.source!=='string'||typeof value.stdin!=='string')throw new HttpError(400,'Requête invalide.');
  const definition=runtime(value.runtime);if(!definition)throw new HttpError(400,'Langage inconnu.');
  if(Buffer.byteLength(value.source)>30000||Buffer.byteLength(value.stdin)>4000||value.source.includes('\0'))throw new HttpError(413,'Code limité à 30 000 octets et entrée à 4 000 octets.');
  return {runtime:definition,source:value.source,stdin:value.stdin};
}
export function wireShutdown(close:()=>Promise<void>,events:{on:(event:string,listener:(...args:any[])=>void)=>unknown}=process,exit:()=>void=()=>process.exit(0)){
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;void close().finally(exit);};
  events.on('SIGINT',stop);events.on('SIGTERM',stop);
  events.on('message',message=>{if(message==='shutdown'||message?.type==='shutdown')stop();});
  events.on('disconnect',stop);
}
export function createRunnerServer(engine:EnginePort,token:string,isReady=()=>true){
  if(Buffer.byteLength(token)<16||Buffer.byteLength(token)>256||/[\r\n]/.test(token))throw new Error('RUNNER_AUTH_TOKEN doit contenir entre 16 et 256 octets.');
  const expected=sha(token),jobs=new Map<string,Job>(),queue:Submission[]=[];let running=0,closing=false,artifactBytes=0;
  const discard=(job:Job)=>{if(job.preview!==undefined){artifactBytes-=Buffer.byteLength(job.preview);delete job.preview;}};
  const prune=()=>{const now=Date.now();for(const [id,job] of jobs)if(job.finishedAt!==null&&now-job.finishedAt>600000){discard(job);jobs.delete(id);}};
  const retainResult=(job:Job,result:RunnerResult)=>{
    const {preview_html:html,...publicResult}=result;job.result=publicResult;
    if(!html||result.status!=='SUCCEEDED')return;
    const size=Buffer.byteLength(html);if(size>2*1024*1024||Buffer.byteLength(JSON.stringify({html}))>3*1024*1024){job.result.message='Aperçu trop volumineux.';return;}
    for(const other of jobs.values()){if(artifactBytes+size<=8*1024*1024)break;if(other!==job)discard(other);}
    job.preview=html;artifactBytes+=size;
  };
  const drain=()=>{
    while(!closing&&running<2&&queue.length){const entry=queue.shift()!;
      if(Date.now()-entry.job.createdAt>30000){entry.job.result={...emptyResult('FAILED'),message:'Attente maximale dépassée. Relancez l’exécution.'};entry.source='';entry.stdin='';entry.job.finishedAt=Date.now();continue;}
      running++;entry.job.result.status='PROCESSING';
      void engine.execute(entry.runtime,entry.source,entry.stdin,entry.image.imageId,entry.job.id,entry.job.createdAt+30000).then(result=>retainResult(entry.job,result)).catch(()=>{entry.job.result={...emptyResult('FAILED'),message:'Exécution interrompue.'};}).finally(()=>{entry.source='';entry.stdin='';entry.job.finishedAt=Date.now();running--;drain();});
    }
  };
  const server=http.createServer({maxHeaderSize:8192},(req,res)=>{
    void(async()=>{
      const supplied=req.headers['x-auth-token'];
      if(typeof supplied!=='string'||!timingSafeEqual(expected,sha(supplied)))throw new HttpError(401,'Authentification requise.');
      if(closing)throw new HttpError(503,'Runner en cours d’arrêt.');
      if(!isReady())throw new HttpError(503,'Runner en cours de préparation.');
      // A browser page has no reason to talk directly to this privileged local daemon.
      if(req.headers.origin)throw new HttpError(403,'Accès direct du navigateur interdit.');
      prune();const route=req.url??'';
      if(req.method==='GET'&&route==='/health'){
        if(!await engine.policyHealth())throw new HttpError(503,'Moteur Docker Linux ou politique d’isolation non vérifié.');
        return reply(res,200,{engine:'uniexam-docker',protocol:1,network_disabled:true,privileged:false});
      }
      if(req.method==='GET'&&route==='/runtimes')return reply(res,200,{runtimes:await engine.availability()});
      if(req.method==='POST'&&route==='/runs'){
        const input=validateSubmission(await readBody(req));
        if(queue.length>=20)throw new HttpError(429,'File locale pleine. Réessayez plus tard.');
        const image=(await engine.verified()).get(input.runtime.id);if(!image)throw new HttpError(503,'Image de ce langage non préparée ou non vérifiée.');
        // Bound both queued work and retained results under rapid completed requests.
        while(jobs.size>=200){const oldest=[...jobs].find(([,job])=>job.finishedAt!==null);if(!oldest)throw new HttpError(429,'Capacité locale atteinte.');discard(oldest[1]);jobs.delete(oldest[0]);}
        // Discovery awaits above can interleave with another submission.
        if(queue.length>=20)throw new HttpError(429,'File locale pleine. Réessayez plus tard.');
        const job:Job={id:randomUUID(),createdAt:Date.now(),finishedAt:null,result:emptyResult()};jobs.set(job.id,job);
        queue.push({...input,image,job});reply(res,202,{id:job.id});drain();return;
      }
      if(req.method==='GET'&&route.startsWith('/runs/')){
        const [id,suffix,...extra]=route.slice('/runs/'.length).split('/');if(!UUID.test(id)||extra.length||(suffix!==undefined&&suffix!=='preview'))throw new HttpError(400,'Identifiant invalide.');
        const job=jobs.get(id);if(!job)throw new HttpError(404,'Exécution absente ou résultat expiré.');
        if(suffix==='preview'){if(!job.preview)throw new HttpError(410,'Aperçu absent ou expiré. Exécutez à nouveau le projet.');return reply(res,200,{html:job.preview});}
        return reply(res,200,job.result);
      }
      throw new HttpError(404,'Route inconnue.');
    })().catch(error=>{if(!res.headersSent&&!res.destroyed)reply(res,error instanceof HttpError?error.status:500,{message:error instanceof HttpError?error.message:'Le service local n’a pas terminé cette requête.'});});
  });
  server.requestTimeout=10000;server.headersTimeout=5000;server.keepAliveTimeout=1000;server.maxConnections=64;
  const expire=setInterval(prune,30000);expire.unref();server.on('close',()=>clearInterval(expire));
  async function close(){closing=true;for(const entry of queue.splice(0)){entry.job.result={...emptyResult('FAILED'),message:'Runner arrêté avant exécution.'};entry.job.finishedAt=Date.now();entry.source='';entry.stdin='';}await engine.stop();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  return {server,close};
}
async function main(){
  const engine=new DockerEngine();await engine.init();
  let ready=false;const {server,close}=createRunnerServer(engine,process.env.RUNNER_AUTH_TOKEN??'',()=>ready);
  server.listen(4200,'127.0.0.1',()=>{void engine.recover().then(()=>{ready=true;console.log('UniExam Docker runner écoute sur http://127.0.0.1:4200. Les images doivent être validées par bootstrap.');}).catch(error=>{console.error(error.message);void close().then(()=>{process.exitCode=1;});});});
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  wireShutdown(close);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(error=>{console.error(error.message);process.exitCode=1;});

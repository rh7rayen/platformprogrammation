import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,realpath,lstat,rm,chmod,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimes,runtime,type Runtime} from './catalog.js';
import {boundedText,dockerCommand,type DockerCommand,type CommandResult} from './docker-cli.js';
export const ROOT=fileURLToPath(new URL('.',import.meta.url));
export const DATA=path.join(ROOT,'.data');
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type Status='QUEUED'|'PROCESSING'|'SUCCEEDED'|'COMPILE_ERROR'|'RUNTIME_ERROR'|'TIME_LIMIT'|'FAILED';
export type RunnerResult={status:Status;stdout:string;stderr:string;compile_output:string;message:string;time_seconds:number|null;memory_kb:number|null;preview_html?:string};
export type VerifiedImage={id:string;version:string;sourceImage:string;imageId:string;repoDigests:string[];testedAt:string;policyVerified:true};
export type Manifest={protocol:1;runtimes:VerifiedImage[]};
export function emptyResult(status:Status='QUEUED'):RunnerResult{return {status,stdout:'',stderr:'',compile_output:'',message:'',time_seconds:null,memory_kb:null};}
export function containerName(id:string){if(!UUID.test(id))throw new Error('Identifiant de tâche invalide.');return `uniexam-job-${id}`;}
export function executionPolicy(definition:Pick<Runtime,'profile'>){return definition.profile==='mysql'
  ?{memory:1073741824,tmpfs:536870912,exclusive:true,initializationMs:90000}
  :{memory:805306368,tmpfs:134217728,exclusive:false,initializationMs:15000};}
export function containerArgs(name:string,folder:string,imageId:string,definition:Runtime):string[]{
  if(!/^uniexam-job-[0-9a-f-]{36}$/.test(name)||!/^sha256:[0-9a-f]{64}$/.test(imageId)||folder.includes(','))throw new Error('Paramètres internes invalides.');
  const policy=executionPolicy(definition);
  return ['run','--detach','--rm','--pull','never','--name',name,'--label','uniexam.runner=local-v1','--label',`uniexam.runner.pid=${process.pid}`,'--log-driver','none',
    '--network','none','--read-only','--user','65534:65534','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '--pids-limit','128','--cpus','1','--memory',String(policy.memory),'--memory-swap',String(policy.memory),'--shm-size','16m','--ulimit','nofile=256:256',
    '--tmpfs',`/tmp:rw,exec,nosuid,nodev,size=${policy.tmpfs},mode=1777`,
    '--mount',`type=bind,src=${folder},dst=/work,readonly`,'--workdir','/tmp','--env','HOME=/tmp','--env','TMPDIR=/tmp',
    ...(definition.env??[]).flatMap(value=>['--env',value]),'--entrypoint','sleep',imageId,'120'];
}
export class DockerEngine {
  readonly jobsRoot:string;readonly manifestPath:string;fatalCleanup=false;
  private active=new Set<string>();private availableCache:{expires:number;items:Map<string,VerifiedImage>}|undefined;
  private policyCheckedUntil=0;
  private policyPending:Promise<boolean>|undefined;
  private discoveryPending:Promise<Map<string,VerifiedImage>>|undefined;
  private occupied=0;private exclusiveActive=false;private waiting:{exclusive:boolean;deadline:number;timer:NodeJS.Timeout;resolve:(admitted:boolean)=>void}[]=[];
  private stopping=false;private inFlight=new Set<Promise<RunnerResult>>();
  private pump(){
    while(this.waiting.length){
      const next=this.waiting[0];
      if(this.stopping||next.deadline<=Date.now()){this.waiting.shift();clearTimeout(next.timer);next.resolve(false);continue;}
      if(this.exclusiveActive||this.occupied>=2||(next.exclusive&&this.occupied>0))return;
      this.waiting.shift();clearTimeout(next.timer);this.occupied++;this.exclusiveActive=next.exclusive;next.resolve(true);
    }
  }
  private reserve(exclusive:boolean,deadline:number):Promise<boolean>{
    if(this.stopping||!Number.isFinite(deadline)||deadline<=Date.now())return Promise.resolve(false);
    return new Promise(resolve=>{
      const entry={exclusive,deadline,resolve,timer:setTimeout(()=>{
        const index=this.waiting.indexOf(entry);if(index===-1)return;
        this.waiting.splice(index,1);resolve(false);this.pump();
      },deadline-Date.now())};
      this.waiting.push(entry);this.pump();
    });
  }
  private release(){this.occupied--;this.exclusiveActive=false;this.pump();}
  constructor(readonly command:DockerCommand=dockerCommand(),readonly dataRoot=DATA){this.jobsRoot=path.join(dataRoot,'jobs');this.manifestPath=path.join(dataRoot,'verified-images.json');}
  async init(){
    await mkdir(this.dataRoot,{recursive:true,mode:0o700});
    await mkdir(this.jobsRoot,{recursive:true,mode:0o700});await chmod(this.jobsRoot,0o700);
    await mkdir(path.join(this.dataRoot,'owners'),{recursive:true,mode:0o700});
    // Reject redirected/reparse workspace roots before any future recursive cleanup.
    if(path.relative(path.resolve(this.jobsRoot),await realpath(this.jobsRoot))!=='')throw new Error('Le dossier des tâches ne doit pas être un lien.');
  }
  async inspect(image:string):Promise<{imageId:string;repoDigests:string[]}|null>{
    const result=await this.command(['image','inspect','--format','{{json .Id}}|{{json .RepoDigests}}',image]);
    if(result.code||result.timedOut||result.overflow)return null;
    try{const [id,digests]=result.stdout.trim().split('|');const imageId=JSON.parse(id);const repoDigests=JSON.parse(digests);return /^sha256:[0-9a-f]{64}$/.test(imageId)&&Array.isArray(repoDigests)?{imageId,repoDigests}:null;}catch{return null;}
  }
  async health():Promise<boolean>{if(this.fatalCleanup)return false;const result=await this.command(['info','--format','{{.OSType}}'],{timeoutMs:5000});return result.code===0&&result.stdout.trim()==='linux';}
  policyHealth():Promise<boolean>{
    if(this.policyPending)return this.policyPending;
    this.policyPending=this.checkPolicyHealth().catch(()=>false).finally(()=>{this.policyPending=undefined;});return this.policyPending;
  }
  private async checkPolicyHealth():Promise<boolean>{
    if(!await this.health())return false;
    if(this.policyCheckedUntil>Date.now())return true;
    if(this.occupied>=2||this.exclusiveActive||this.waiting.length>0)return this.active.size>0&&this.policyCheckedUntil>0;
    const verified=await this.verified();const first=verified.values().next().value as VerifiedImage|undefined;
    if(!first)return false;
    const definition=runtime(first.id)!;
    // This harmless command validates the actual host's container policy after a
    // daemon restart. A JSON constant or an old manifest alone is insufficient.
    const result=await this.execute({...definition,filename:'health.txt',compile:undefined,initialize:undefined,previewFile:undefined,files:undefined,run:['id','-u']},'','',first.imageId);
    if(result.status!=='SUCCEEDED'||result.stdout.trim()!=='65534')return false;
    this.policyCheckedUntil=Date.now()+30000;return true;
  }
  verified():Promise<Map<string,VerifiedImage>>{
    if(this.discoveryPending)return this.discoveryPending;
    this.discoveryPending=this.discover().finally(()=>{this.discoveryPending=undefined;});return this.discoveryPending;
  }
  private async discover():Promise<Map<string,VerifiedImage>>{
    if(this.fatalCleanup)return new Map();
    if(this.availableCache&&this.availableCache.expires>Date.now())return this.availableCache.items;
    const items=new Map<string,VerifiedImage>();
    try{
      const text=await readFile(this.manifestPath,'utf8');if(Buffer.byteLength(text)>32768)throw new Error('Manifest trop grand.');
      const manifest=JSON.parse(text) as Manifest;if(manifest.protocol!==1||!Array.isArray(manifest.runtimes)||manifest.runtimes.length>runtimes.length)throw new Error('Manifest invalide.');
      const inspections=new Map<string,Promise<Awaited<ReturnType<DockerEngine['inspect']>>>>();
      for(let offset=0;offset<manifest.runtimes.length;offset+=4)await Promise.all(manifest.runtimes.slice(offset,offset+4).map(async verified=>{
        const definition=runtime(verified.id);
        if(!definition||verified.policyVerified!==true||verified.sourceImage!==definition.image||!/^sha256:[0-9a-f]{64}$/.test(verified.imageId)||!Number.isFinite(Date.parse(verified.testedAt)))return;
        if(!inspections.has(verified.imageId))inspections.set(verified.imageId,this.inspect(verified.imageId));
        const inspected=await inspections.get(verified.imageId);
        if(inspected?.imageId===verified.imageId)items.set(definition.id,verified);
      }));
    }catch{/* Missing or invalid manifests never enable an untested runtime. */}
    this.availableCache={expires:Date.now()+15000,items};return items;
  }
  async availability(){const verified=await this.verified();return runtimes.map(item=>({id:item.id,version:item.version,image:verified.get(item.id)?.imageId??item.image,available:verified.has(item.id)}));}
  async removeContainer(name:string){
    if(!/^uniexam-job-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(name))throw new Error('Nom de conteneur invalide.');
    const result=await this.command(['rm','--force',name],{timeoutMs:10000});
    if(result.code!==0&&!/No such container/i.test(result.stderr))this.fatalCleanup=true;
    return result.code===0||/No such container/i.test(result.stderr);
  }
  async removeFolder(id:string){
    if(!UUID.test(id))throw new Error('Identifiant de nettoyage invalide.');
    const target=path.resolve(this.jobsRoot,id);
    if(path.relative(this.jobsRoot,target)!==id)throw new Error('Chemin de nettoyage invalide.');
    const info=await lstat(target).catch(()=>null);if(!info)return;
    if(info.isSymbolicLink()||path.relative(this.jobsRoot,await realpath(target))!==id)throw new Error('Lien interdit dans les tâches.');
    await rm(target,{recursive:true,force:true});
    await unlink(path.join(this.dataRoot,'owners',`${id}.json`)).catch(()=>{});
  }
  async stop(){this.stopping=true;this.pump();await Promise.all([...this.active].map(name=>this.removeContainer(name)));await Promise.allSettled([...this.inFlight]);}
  async recover(){
    // Called only after the fixed HTTP port has been acquired. Live bootstrap or
    // daemon processes keep their jobs; only dead owners' UUID directories qualify.
    if(!await this.health())throw new Error('Docker doit être disponible pour nettoyer les tâches abandonnées.');
    const entries=await readdir(this.jobsRoot,{withFileTypes:true});
    if(entries.length>500)throw new Error('Trop de tâches abandonnées : nettoyage manuel ciblé requis.');
    for(const entry of entries){
      if(!UUID.test(entry.name)||!entry.isDirectory()||entry.isSymbolicLink())continue;
      const ownerFile=path.join(this.dataRoot,'owners',`${entry.name}.json`);
      let owner:{pid:number};try{owner=JSON.parse(await readFile(ownerFile,'utf8'));}catch{continue;}
      if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)continue;
      try{process.kill(owner.pid,0);continue;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')continue;}
      const name=containerName(entry.name);
      const check=await this.command(['inspect','--format','{{index .Config.Labels "uniexam.runner.pid"}}',name]);
      if(check.code===0&&check.stdout.trim()!==String(owner.pid))continue;
      if(check.code!==0&&!/No such (?:object|container)/i.test(check.stderr))throw new Error('Propriété du conteneur non confirmée.');
      if(check.code===0&&!await this.removeContainer(name))throw new Error('Nettoyage du conteneur abandonné impossible.');
      await this.removeFolder(entry.name);
    }
  }
  async verifyPolicy(name:string,folder:string,definition:Pick<Runtime,'profile'>={}):Promise<boolean>{
    const policy=executionPolicy(definition);
    const inspected=await this.command(['inspect','--format','{{json .HostConfig}}|{{json .Config.User}}|{{json .Mounts}}',name]);
    if(inspected.code||inspected.overflow||inspected.timedOut)return false;
    try{
      const [hostText,userText,mountText]=inspected.stdout.trim().split('|');
      const host=JSON.parse(hostText),user=JSON.parse(userText),mounts=JSON.parse(mountText);
      // Docker Desktop exposes a Windows source as either its host path or /run/desktop/mnt/host/<drive>/...
      const normalized=folder.replaceAll('\\','/');
      const desktopSource=normalized.replace(/^([A-Za-z]):/,(part,drive:string)=>`/run/desktop/mnt/host/${drive.toLowerCase()}`);
      const binds=mounts.filter((mount:{Type:string})=>mount.Type==='bind');
      const allowedMounts=mounts.every((mount:{Type:string;Destination:string})=>mount.Type==='bind'||(mount.Type==='tmpfs'&&mount.Destination==='/tmp'));
      const tmpfs=host.Tmpfs?.['/tmp'];
      return host.Privileged===false&&host.ReadonlyRootfs===true&&host.NetworkMode==='none'&&user==='65534:65534'&&host.LogConfig?.Type==='none'
        &&host.PidsLimit===128&&host.NanoCpus===1000000000&&host.Memory===policy.memory&&host.MemorySwap===policy.memory
        &&host.ShmSize===16777216&&Array.isArray(host.Ulimits)&&host.Ulimits.some((limit:{Name:string;Soft:number;Hard:number})=>limit.Name==='nofile'&&limit.Soft===256&&limit.Hard===256)
        &&Array.isArray(host.CapDrop)&&host.CapDrop.some((cap:string)=>cap.toUpperCase()==='ALL')
        &&Array.isArray(host.SecurityOpt)&&host.SecurityOpt.some((option:string)=>/^no-new-privileges(?::true)?$/.test(option))
        &&typeof tmpfs==='string'&&['rw','exec','nosuid','nodev',`size=${policy.tmpfs}`].every(value=>tmpfs.split(',').includes(value))
        &&allowedMounts&&binds.length===1&&binds[0].Destination==='/work'&&binds[0].RW===false
        &&[normalized.toLowerCase(),desktopSource.toLowerCase()].includes(String(binds[0].Source).replaceAll('\\','/').toLowerCase());
    }catch{return false;}
  }
  execute(definition:Runtime,source:string,stdin:string,imageId:string,id:string=randomUUID(),admissionDeadlineMs=Date.now()+30000):Promise<RunnerResult>{
    const admissionFailure=()=>({...emptyResult('FAILED'),message:this.stopping?'Runner arrêté.':'Attente maximale dépassée. Relancez l’exécution.'});
    const task=(async()=>{
      if(!await this.reserve(executionPolicy(definition).exclusive,admissionDeadlineMs))return admissionFailure();
      try{if(this.stopping||Date.now()>=admissionDeadlineMs)return admissionFailure();return await this.executeReserved(definition,source,stdin,imageId,id);}finally{this.release();}
    })();
    this.inFlight.add(task);void task.then(()=>this.inFlight.delete(task),()=>this.inFlight.delete(task));return task;
  }
  private async executeReserved(definition:Runtime,source:string,stdin:string,imageId:string,id:string):Promise<RunnerResult>{
    if(this.fatalCleanup)throw new Error('Nettoyage Docker non confirmé.');
    const name=containerName(id),folder=path.join(this.jobsRoot,id);let created=false;let started=false;
    const result=emptyResult('PROCESSING');const wallStart=performance.now();
    const kill=()=>this.removeContainer(name).then(()=>{});
    const exec=(argv:string[],timeoutMs:number,input='')=>this.command(['exec','--interactive','--user','65534:65534','--workdir','/tmp',name,...argv],{timeoutMs,input,onAbort:kill});
    const fail=(step:CommandResult,compiling:boolean)=>{
      result.status=step.timedOut?'TIME_LIMIT':step.overflow?'FAILED':compiling?'COMPILE_ERROR':'RUNTIME_ERROR';
      result.message=step.timedOut?'Durée maximale dépassée. Le conteneur a été arrêté.':step.overflow?'Sortie maximale de 32 Kio dépassée. Le conteneur a été arrêté.':'';
    };
    try{
      await mkdir(folder,{recursive:false,mode:0o755});created=true;this.active.add(name);
      await writeFile(path.join(this.dataRoot,'owners',`${id}.json`),JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
      await writeFile(path.join(folder,definition.filename),source,{flag:'wx',mode:0o644});
      for(const [filename,content] of Object.entries(definition.files??{}))await writeFile(path.join(folder,filename),content,{flag:'wx',mode:0o644});
      const start=await this.command(containerArgs(name,folder,imageId,definition),{timeoutMs:15000,onAbort:kill});
      if(start.code!==0||start.timedOut||start.overflow){result.status='FAILED';result.message='Impossible de créer le conteneur isolé.';return result;}started=true;
      if(!await this.verifyPolicy(name,folder,definition)){result.status='FAILED';result.message='La politique d’isolation Docker n’a pas été confirmée.';return result;}
      this.policyCheckedUntil=Date.now()+30000;
      if(definition.initialize){const step=await exec(definition.initialize,executionPolicy(definition).initializationMs);if(step.code!==0||step.timedOut||step.overflow){result.status='FAILED';result.message='La base pédagogique isolée n’a pas pu démarrer.';return result;}}
      const compileDeadline=performance.now()+45000;
      for(const argv of definition.compile??[]){
        const remaining=Math.floor(compileDeadline-performance.now());if(remaining<=0){await kill();result.status='TIME_LIMIT';result.message='Durée maximale de compilation dépassée.';return result;}
        const step=await exec(argv,remaining);
        const combined=Buffer.from(result.compile_output+step.stdout+step.stderr);result.compile_output=boundedText(combined);
        if(step.code!==0||step.timedOut||step.overflow||combined.length>32768){if(combined.length>32768){step.overflow=true;await kill();}fail(step,true);return result;}
      }
      const runStart=performance.now();const step=await exec(definition.run,5000,stdin);
      result.time_seconds=Math.round((performance.now()-runStart)/10)/100;
      result.stdout=step.stdout;result.stderr=step.stderr;
      if(step.code!==0||step.timedOut||step.overflow)fail(step,false);else result.status='SUCCEEDED';
      if(result.status==='SUCCEEDED'&&definition.previewFile){
        const artifact=await this.command(['exec','--user','65534:65534',name,'cat',definition.previewFile],{timeoutMs:5000,outputLimit:2*1024*1024,onAbort:kill});
        if(artifact.code!==0||artifact.timedOut||artifact.overflow||!artifact.stdout.trim()){result.status='FAILED';result.message='Aperçu absent, trop volumineux ou interrompu.';}else result.preview_html=artifact.stdout;
      }
      return result;
    }catch{result.status='FAILED';result.message='Le moteur local n’a pas terminé cette exécution.';return result;}
    finally{
      // Removing the whole container also kills descendants, unlike killing docker exec.
      const removed=await this.removeContainer(name).catch(()=>{this.fatalCleanup=true;return false;});
      if(removed&&created)await this.removeFolder(id).catch(()=>{this.fatalCleanup=true;});
      this.active.delete(name);
      if(this.fatalCleanup){result.status='FAILED';result.message='Nettoyage incomplet : le runner est arrêté par précaution.';}
      if(!started)result.time_seconds=null;
      // This is elapsed execution time, not a claimed cgroup CPU/memory measurement.
      if(performance.now()-wallStart>120000)this.fatalCleanup=true;
    }
  }
}

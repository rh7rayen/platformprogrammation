import {spawn} from 'node:child_process';
export const OUTPUT_LIMIT=32*1024;
export type CommandResult={code:number;stdout:string;stderr:string;timedOut:boolean;overflow:boolean};
export type CommandOptions={timeoutMs?:number;input?:string;onAbort?:()=>Promise<void>;outputLimit?:number};
export type DockerCommand=(args:string[],options?:CommandOptions)=>Promise<CommandResult>;
export function boundedText(data:Buffer,max=OUTPUT_LIMIT):string{
  // A trailing incomplete UTF-8 sequence must not increase the byte limit.
  let text=data.subarray(0,max).toString('utf8');
  while(Buffer.byteLength(text)>max)text=text.slice(0,-1);
  return text;
}
export function dockerCommand(binary=process.env.LOCAL_RUNNER_DOCKER_PATH||(process.platform==='win32'?'docker.exe':'docker')):DockerCommand{
  return (args,options={})=>new Promise(resolve=>{
    const proc=spawn(binary,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const max=options.outputLimit??OUTPUT_LIMIT;let out=Buffer.alloc(0),err=Buffer.alloc(0),timedOut=false,overflow=false,aborting=false,done=false;
    let abortTask:Promise<void>=Promise.resolve();let force:NodeJS.Timeout|undefined;
    const finish=(code:number)=>{if(done)return;done=true;clearTimeout(timer);if(force)clearTimeout(force);void abortTask.finally(()=>resolve({code,stdout:boundedText(out,max),stderr:boundedText(err,max),timedOut,overflow}));};
    const abort=()=>{if(aborting)return;aborting=true;abortTask=options.onAbort?.().catch(()=>{})??Promise.resolve();proc.kill();force=setTimeout(()=>finish(-1),1500);};
    const collect=(chunk:Buffer,which:'out'|'err')=>{if(aborting)return;const previous=which==='out'?out:err;const remaining=Math.max(0,max-previous.length);const next=Buffer.concat([previous,chunk.subarray(0,remaining)]);if(which==='out')out=next;else err=next;if(chunk.length>remaining){overflow=true;abort();}};
    proc.stdout.on('data',(chunk:Buffer)=>collect(chunk,'out'));proc.stderr.on('data',(chunk:Buffer)=>collect(chunk,'err'));
    proc.stdin.on('error',()=>{});proc.stdin.end(options.input??'');
    const timer=setTimeout(()=>{timedOut=true;abort();},options.timeoutMs??15000);
    proc.on('error',()=>{err=Buffer.from('Moteur Docker inaccessible.');finish(-1);});proc.on('close',code=>finish(code??-1));
  });
}

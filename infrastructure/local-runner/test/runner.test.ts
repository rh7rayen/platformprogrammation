import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as tick} from 'node:timers/promises';
import {EventEmitter} from 'node:events';
import {DockerEngine,emptyResult,type VerifiedImage} from '../engine.js';
import {runtime} from '../catalog.js';
import {createRunnerServer,validateSubmission,wireShutdown} from '../server.js';
import {dockerCommand,type DockerCommand,type CommandResult} from '../docker-cli.js';

// Contract simulations below deliberately do not claim to compile student code.
// Real container evidence is produced separately by bootstrap and the HTTP matrix.
const imageId=`sha256:${'a'.repeat(64)}`,token='local-runner-contract-test-token';
const verified:VerifiedImage={id:'php',version:'8.4',sourceImage:'php:8.4-cli-alpine3.22',imageId,repoDigests:[],testedAt:new Date().toISOString(),policyVerified:true};
const ok=(stdout=''):CommandResult=>({code:0,stdout,stderr:'',timedOut:false,overflow:false});
async function temporary(){const folder=await mkdtemp(path.join(tmpdir(),'uniexam-runner-contract-'));return {folder,remove:async()=>{assert.equal(path.dirname(folder),tmpdir());assert.ok(path.basename(folder).startsWith('uniexam-runner-contract-'));await rm(folder,{recursive:true,force:true});}};}
async function listen(engine:Parameters<typeof createRunnerServer>[0]){const app=createRunnerServer(engine,token);await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address=app.server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;return {...app,call:(url:string,init:RequestInit={})=>fetch(base+url,{...init,headers:{'x-auth-token':token,...init.headers}})};}
function fakePort(){return {policyHealth:async()=>true,availability:async()=>[{id:'php' as const,image:imageId,version:'8.4',available:true}],verified:async()=>new Map([['php',verified]]),execute:async()=>({...emptyResult('SUCCEEDED'),stdout:'contract'}),stop:async()=>{}};}

test('HTTP authentication, origin boundary, exact schema and byte limits',async()=>{
  assert.throws(()=>createRunnerServer(fakePort(),'short'));
  const app=await listen(fakePort());try{
    assert.equal((await app.call('/health',{headers:{'x-auth-token':'wrong'}})).status,401);
    assert.equal((await app.call('/health',{headers:{origin:'http://localhost:3000'}})).status,403);
    assert.deepEqual(await(await app.call('/health')).json(),{engine:'uniexam-docker',protocol:1,network_disabled:true,privileged:false});
    assert.equal((await app.call('/runs/not-a-uuid')).status,400);
    const submit=(data:unknown)=>app.call('/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await submit({runtime:'php',source:'<?php echo 1;',stdin:'',image:'unsafe'})).status,400);
    assert.equal((await submit({runtime:'php',source:'é'.repeat(15001),stdin:''})).status,413);
    assert.equal((await submit({runtime:'php',source:'a',stdin:'x'.repeat(4001)})).status,413);
    assert.equal((await submit({runtime:'php',source:'x'.repeat(70000),stdin:''})).status,413);
    assert.equal((await submit({runtime:'java',source:'class Main{}',stdin:''})).status,503);
    const response=await submit({runtime:'php',source:'<?php echo 1;',stdin:''});assert.equal(response.status,202);const {id}=await response.json();assert.match(id,/^[0-9a-f-]{36}$/);await tick();
    assert.equal((await(await app.call(`/runs/${id}`)).json()).status,'SUCCEEDED');
  }finally{await app.close();}
});
test('only two executions start and only twenty additional jobs are admitted',async()=>{
  const releases:(()=>void)[]=[];let started=0;
  const app=await listen({...fakePort(),execute:async()=>{started++;await new Promise<void>(resolve=>releases.push(resolve));return emptyResult('SUCCEEDED');}});
  try{
    const submit=()=>app.call('/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runtime:'php',source:'<?php',stdin:''})});
    for(let n=0;n<22;n++)assert.equal((await submit()).status,202);
    assert.equal(started,2);assert.equal((await submit()).status,429);
    for(let n=0;n<22;n++){releases.shift()!();await tick();}
    assert.equal(started,22);
  }finally{for(const release of releases)release();await app.close();}
});

test('HTTP queue time is deducted from the engine admission deadline',async context=>{
  let now=Date.now();const acceptedAt=now;context.mock.method(Date,'now',()=>now);
  const deadlines:(number|undefined)[]=[],releases:(()=>void)[]=[];
  const app=await listen({...fakePort(),execute:async(_runtime,_source,_stdin,_image,_id,deadline)=>{
    deadlines.push(deadline);await new Promise<void>(resolve=>releases.push(resolve));return emptyResult('SUCCEEDED');
  }});
  try{
    for(let n=0;n<3;n++)assert.equal((await app.call('/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runtime:'php',source:'<?php',stdin:''})})).status,202);
    assert.deepEqual(deadlines,[acceptedAt+30000,acceptedAt+30000]);
    now+=29000;releases.shift()!();await tick();
    assert.deepEqual(deadlines,[acceptedAt+30000,acceptedAt+30000,acceptedAt+30000]);
    assert.equal(deadlines[2]!-now,1000,'the engine must receive only the remaining admission time');
  }finally{for(const release of releases)release();await tick();await app.close();}
});

function fakeDocker(options:{policyBad?:boolean;timeout?:boolean}={}){
  const calls:string[][]=[];let folder='';let captured='';const folders=new Map<string,string>();
  const command:DockerCommand=async(args,commandOptions)=>{
    calls.push(args);
    if(args[0]==='info')return ok('linux\n');
    if(args[0]==='image')return ok(`${JSON.stringify(imageId)}|[]`);
    if(args[0]==='run'){const mount=args[args.indexOf('--mount')+1];folder=mount.slice('type=bind,src='.length,mount.indexOf(',dst='));folders.set(args[args.indexOf('--name')+1],folder);captured=await readFile(path.join(folder,'main.php'),'utf8');return ok('container-id');}
    if(args[0]==='inspect')folder=folders.get(args.at(-1)!)??folder;
    if(args[0]==='inspect')return ok(`${JSON.stringify({Privileged:options.policyBad??false,ReadonlyRootfs:true,NetworkMode:'none',PidsLimit:128,NanoCpus:1000000000,Memory:805306368,MemorySwap:805306368,ShmSize:16777216,Ulimits:[{Name:'nofile',Soft:256,Hard:256}],LogConfig:{Type:'none'},CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],Tmpfs:{'/tmp':'rw,exec,nosuid,nodev,size=134217728,mode=1777'}})}|"65534:65534"|${JSON.stringify([{Type:'bind',Source:folder,Destination:'/work',RW:false}])}`);
    if(args[0]==='exec'){if(options.timeout){await commandOptions?.onAbort?.();return {...ok(),code:-1,timedOut:true};}return ok('Bonjour!\n');}
    return ok();
  };
  return {command,calls,captured:()=>captured};
}
test('Docker argv is fixed, source is only a readonly mounted file, cleanup removes the job',async()=>{
  const temporaryFolder=await temporary(),docker=fakeDocker(),engine=new DockerEngine(docker.command,temporaryFolder.folder);await engine.init();
  try{
    const source='<?php echo "$(host command)"; // literal test payload';
    const result=await engine.execute(runtime('php')!,source,'input',imageId);assert.equal(result.status,'SUCCEEDED');assert.equal(docker.captured(),source);
    const run=docker.calls.find(call=>call[0]==='run')!;assert.ok(run.includes('--pull')&&run.includes('never'));assert.ok(run.includes('none'));assert.ok(run.includes('--read-only'));assert.ok(run.includes('65534:65534'));assert.ok(run.includes('--cap-drop'));assert.ok(!run.includes('--privileged'));assert.ok(!run.some(arg=>arg.includes(source)));
    assert.deepEqual(await readdir(engine.jobsRoot),[]);assert.ok(docker.calls.some(call=>call[0]==='rm'&&call[1]==='--force'));
    await assert.rejects(()=>engine.removeFolder('../outside'));
  }finally{await temporaryFolder.remove();}
});
test('failed actual container policy blocks execution and timeout kills the entire named container',async()=>{
  for(const options of [{policyBad:true},{timeout:true}]){
    const temporaryFolder=await temporary(),docker=fakeDocker(options),engine=new DockerEngine(docker.command,temporaryFolder.folder);await engine.init();
    try{const result=await engine.execute(runtime('php')!,'<?php','',imageId);assert.equal(result.status,options.policyBad?'FAILED':'TIME_LIMIT');if(options.policyBad)assert.ok(!docker.calls.some(call=>call[0]==='exec'));else assert.ok(docker.calls.filter(call=>call[0]==='rm').length>=2);assert.deepEqual(await readdir(engine.jobsRoot),[]);}finally{await temporaryFolder.remove();}
  }
});
test('CLI output is bounded in UTF-8 and abort callback is awaited',async()=>{
  let stopped=false;
  // Fixed trusted Node fixtures exercise the process wrapper; this is not a host
  // fallback for student source, and does not invoke a shell.
  const command=dockerCommand(process.execPath);
  const result=await command(['-e','process.stdout.write("é".repeat(50000));setInterval(()=>{},1000)'],{onAbort:async()=>{await tick();stopped=true;},timeoutMs:5000});
  assert.equal(result.overflow,true);assert.equal(stopped,true);assert.ok(Buffer.byteLength(result.stdout)<=32768);
  let timedOut=false;const timeout=await command(['-e','setInterval(()=>{},1000)'],{timeoutMs:30,onAbort:async()=>{timedOut=true;}});assert.equal(timeout.timedOut,true);assert.equal(timedOut,true);
});
test('validation rejects unknown runtimes and host-controlled fields',()=>{
  for(const value of [{runtime:'sh -c',source:'echo x',stdin:''},{runtime:'php',source:3,stdin:''},{runtime:'php',source:'x\0',stdin:''},{runtime:'php',source:'a',stdin:'',filename:'../../.env'}])assert.throws(()=>validateSubmission(value));
});
test('Windows IPC shutdown and disconnect wait for cleanup exactly once before exit',async()=>{
  const events=new EventEmitter();let resolveCleanup!:()=>void,closed=0,exited=0;
  wireShutdown(async()=>{closed++;await new Promise<void>(resolve=>{resolveCleanup=resolve;});},events,()=>{exited++;});
  events.emit('message','shutdown');events.emit('disconnect');events.emit('SIGINT');
  assert.equal(closed,1);assert.equal(exited,0);resolveCleanup();await tick();assert.equal(exited,1);
});
test('engine stop waits for source cleanup and prevents a waiting execution from starting',async()=>{
  const temporaryFolder=await temporary(),docker=fakeDocker();let ready!:()=>void;
  const running=new Promise<void>(resolve=>{ready=resolve;});const waiting=new Map<string,(result:CommandResult)=>void>();
  const command:DockerCommand=async(args,options)=>{
    if(args[0]==='exec')return new Promise<CommandResult>(resolve=>{waiting.set(args[args.indexOf('--workdir')+2],resolve);if(waiting.size===2)ready();});
    if(args[0]==='rm'){const resolve=waiting.get(args[2]);resolve?.({...ok(),code:137});}
    return docker.command(args,options);
  };
  const engine=new DockerEngine(command,temporaryFolder.folder);await engine.init();
  try{
    const executions=[0,1,2].map(()=>engine.execute(runtime('php')!,'<?php','',imageId));
    await running;await engine.stop();const results=await Promise.all(executions);
    assert.equal(docker.calls.filter(args=>args[0]==='run').length,2);assert.equal(results[2].status,'FAILED');
    assert.deepEqual(await readdir(engine.jobsRoot),[]);
  }finally{await temporaryFolder.remove();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DockerEngine,containerName} from '../engine.js';
import {runtime} from '../catalog.js';
import type {DockerCommand,CommandResult} from '../docker-cli.js';

// Simulated Docker protocol: these tests exercise admission, folder creation and
// shutdown ordering, and do not claim to execute PHP or MySQL in a container.
const imageId=`sha256:${'a'.repeat(64)}`;
const ok=(stdout=''):CommandResult=>({code:0,stdout,stderr:'',timedOut:false,overflow:false});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function fixture(blockRemoval=false){
  const folder=await mkdtemp(path.join(tmpdir(),'uniexam-admission-contract-'));
  const calls:string[][]=[],containers=new Map<string,string[]>();
  const started=deferred<void>(),activeResult=deferred<CommandResult>(),removeReady=deferred<void>();let activeName='';
  const command:DockerCommand=async args=>{
    calls.push(args);
    if(args[0]==='run'){containers.set(args[args.indexOf('--name')+1],args);return ok('simulated-container');}
    if(args[0]==='inspect'){
      const run=containers.get(args.at(-1)!)!;
      const mount=run[run.indexOf('--mount')+1],source=mount.slice('type=bind,src='.length,mount.indexOf(',dst='));
      const memory=Number(run[run.indexOf('--memory')+1]);
      const host={Privileged:false,ReadonlyRootfs:true,NetworkMode:'none',PidsLimit:128,NanoCpus:1000000000,Memory:memory,MemorySwap:memory,ShmSize:16777216,Ulimits:[{Name:'nofile',Soft:256,Hard:256}],LogConfig:{Type:'none'},CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],Tmpfs:{'/tmp':run[run.indexOf('--tmpfs')+1].slice('/tmp:'.length)}};
      return ok(`${JSON.stringify(host)}|"65534:65534"|${JSON.stringify([{Type:'bind',Source:source,Destination:'/work',RW:false}])}`);
    }
    if(args[0]==='exec'&&!activeName){activeName=args[args.indexOf('--workdir')+2];started.resolve();return activeResult.promise;}
    if(args[0]==='rm'&&args[2]===activeName){if(blockRemoval)await removeReady.promise;activeResult.resolve({...ok(),code:137});}
    return ok('simulated-output');
  };
  const engine=new DockerEngine(command,folder);await engine.init();
  async function cleanup(){
    removeReady.resolve();activeResult.resolve(ok());await engine.stop();
    assert.equal(path.dirname(folder),tmpdir());assert.ok(path.basename(folder).startsWith('uniexam-admission-contract-'));
    await rm(folder,{recursive:true,force:true});
  }
  return {engine,calls,started,activeResult,removeReady,cleanup};
}

test('a job waiting behind the exclusive MySQL profile expires in 100 ms before any source folder or container is created',{timeout:5000},async()=>{
  const app=await fixture(),firstId=randomUUID(),expiredId=randomUUID();
  // PHP fixture filename with the actual MySQL scheduling/resource profile.
  const exclusive={...runtime('php')!,profile:'mysql' as const};
  try{
    const active=app.engine.execute(exclusive,'<?php','',imageId,firstId);await app.started.promise;
    const expired=await app.engine.execute(runtime('php')!,'<?php','',imageId,expiredId,Date.now()+100);
    assert.equal(expired.status,'FAILED');assert.match(expired.message,/Attente maximale dépassée/);
    assert.equal(expired.time_seconds,null);
    assert.ok(!app.calls.some(args=>args.includes(containerName(expiredId))));
    assert.deepEqual(await readdir(app.engine.jobsRoot),[firstId]);
    assert.deepEqual(await readdir(path.join(app.engine.dataRoot,'owners')),[`${firstId}.json`]);
    app.activeResult.resolve(ok());assert.equal((await active).status,'SUCCEEDED');
    assert.equal((await app.engine.execute(runtime('php')!,'<?php','',imageId)).status,'SUCCEEDED');
    assert.equal(app.calls.filter(args=>args[0]==='run').length,2);
    assert.deepEqual(await readdir(app.engine.jobsRoot),[]);
  }finally{await app.cleanup();}
});

test('stop cancels waiting jobs immediately while active container cleanup is still pending',{timeout:5000},async()=>{
  const app=await fixture(true),firstId=randomUUID(),waitingIds=[randomUUID(),randomUUID()];
  try{
    const active=app.engine.execute({...runtime('php')!,profile:'mysql'},'<?php','',imageId,firstId);await app.started.promise;
    const waiting=waitingIds.map(id=>app.engine.execute(runtime('php')!,'<?php','',imageId,id));
    let stopped=false;const stopping=app.engine.stop().then(()=>{stopped=true;});
    const results=await Promise.all(waiting);
    for(const result of results){assert.equal(result.status,'FAILED');assert.match(result.message,/Runner arrêté/);}
    assert.equal(stopped,false,'stop must still await the active container cleanup');
    assert.equal(app.calls.filter(args=>args[0]==='run').length,1);
    assert.deepEqual(await readdir(app.engine.jobsRoot),[firstId]);
    assert.equal((await app.engine.execute(runtime('php')!,'<?php','',imageId)).status,'FAILED');
    app.removeReady.resolve();await stopping;await active;
    assert.deepEqual(await readdir(app.engine.jobsRoot),[]);
    assert.deepEqual(await readdir(path.join(app.engine.dataRoot,'owners')),[]);
  }finally{await app.cleanup();}
});

test('an already expired admission never reserves a slot or creates a folder',{timeout:5000},async()=>{
  const app=await fixture();try{
    const result=await app.engine.execute(runtime('php')!,'<?php','',imageId,randomUUID(),Date.now()-1);
    assert.equal(result.status,'FAILED');assert.match(result.message,/Attente maximale dépassée/);
    assert.deepEqual(app.calls,[]);assert.deepEqual(await readdir(app.engine.jobsRoot),[]);
  }finally{await app.cleanup();}
});

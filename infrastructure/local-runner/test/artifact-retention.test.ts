import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {createRunnerServer} from '../server.js';
import {emptyResult,type RunnerResult,type VerifiedImage} from '../engine.js';
import {runtime} from '../catalog.js';

// Simulated engine results, not real framework execution. Tests memory and HTTP boundaries.
const token='synthetic-artifact-contract-token',imageId=`sha256:${'a'.repeat(64)}`,limit=2*1024*1024;
const definition=runtime('react')!;
const verified:VerifiedImage={id:'react',version:'test-contract',sourceImage:definition.image,imageId,repoDigests:[],testedAt:new Date().toISOString(),policyVerified:true};
async function fixture(){
  let next:RunnerResult={...emptyResult('SUCCEEDED'),preview_html:'<h1>TEST-CONTRACT</h1>'};
  const app=createRunnerServer({policyHealth:async()=>true,availability:async()=>[],verified:async()=>new Map([['react',verified]]),execute:async()=>next,stop:async()=>{}},token);
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address=app.server.address();assert.ok(address&&typeof address!=='string');
  const call=(path:string,init:RequestInit={})=>fetch(`http://127.0.0.1:${address.port}${path}`,{...init,headers:{'x-auth-token':token,...init.headers}});
  const submit=async(html:string,status:RunnerResult['status']='SUCCEEDED')=>{
    next={...emptyResult(status),preview_html:html};const response=await call('/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runtime:'react',source:definition.sample,stdin:''})});assert.equal(response.status,202);const {id}=await response.json();await tick();return id as string;
  };
  return {...app,call,submit};
}
test('artifact endpoint requires server authentication; ordinary job JSON strips the HTML and failed jobs retain no preview',async()=>{
  const app=await fixture();try{
    const id=await app.submit('<h1>PRIVATE TEST-CONTRACT HTML</h1>');
    const result=await(await app.call(`/runs/${id}`)).json();assert.equal(result.status,'SUCCEEDED');assert.doesNotMatch(JSON.stringify(result),/preview_html|PRIVATE TEST-CONTRACT HTML/);
    assert.equal((await app.call(`/runs/${id}/preview`,{headers:{'x-auth-token':'wrong'}})).status,401);
    assert.equal((await app.call(`/runs/${id}/preview`,{headers:{origin:'http://localhost:3100'}})).status,403);
    assert.deepEqual(await(await app.call(`/runs/${id}/preview`)).json(),{html:'<h1>PRIVATE TEST-CONTRACT HTML</h1>'});
    assert.equal((await app.call(`/runs/${id}/preview/extra`)).status,400);
    const failed=await app.submit('<h1>MUST NOT RETAIN</h1>','COMPILE_ERROR');assert.equal((await app.call(`/runs/${failed}/preview`)).status,410);
  }finally{await app.close();}
});
test('artifact retention enforces both two-MiB UTF8 and three-MiB JSON caps without retaining oversized data',async()=>{
  const app=await fixture();try{
    const exact=await app.submit('a'.repeat(limit));assert.equal(Buffer.byteLength((await(await app.call(`/runs/${exact}/preview`)).json()).html),limit);
    for(const html of ['é'.repeat(limit/2+1),'"'.repeat(limit)]){
      const id=await app.submit(html);assert.equal((await app.call(`/runs/${id}/preview`)).status,410);const result=await(await app.call(`/runs/${id}`)).json();assert.match(result.message,/volumineux/);assert.ok(!('preview_html' in result));
    }
  }finally{await app.close();}
});
test('global eight-MiB artifact budget evicts the oldest preview while keeping its small job result',async()=>{
  const app=await fixture();try{
    const ids:string[]=[];for(let n=0;n<5;n++)ids.push(await app.submit(String(n).repeat(limit)));
    assert.equal((await app.call(`/runs/${ids[0]}/preview`)).status,410);assert.equal((await app.call(`/runs/${ids[0]}`)).status,200);
    let retained=0;for(const id of ids.slice(1)){const response=await app.call(`/runs/${id}/preview`);assert.equal(response.status,200);retained+=Buffer.byteLength((await response.json()).html);}
    assert.equal(retained,8*1024*1024);
  }finally{await app.close();}
});
test('ten-minute TTL removes both result and artifact and frees the entire retention budget',async context=>{
  let now=Date.now();context.mock.method(Date,'now',()=>now);
  const app=await fixture();try{
    const id=await app.submit('a'.repeat(limit));now+=600001;
    assert.equal((await app.call(`/runs/${id}/preview`)).status,404);assert.equal((await app.call(`/runs/${id}`)).status,404);
    const current:string[]=[];for(let n=0;n<4;n++)current.push(await app.submit('b'.repeat(limit)));
    for(const id of current){const response=await app.call(`/runs/${id}/preview`);assert.equal(response.status,200);assert.equal(Buffer.byteLength((await response.json()).html),limit);}
  }finally{await app.close();}
});

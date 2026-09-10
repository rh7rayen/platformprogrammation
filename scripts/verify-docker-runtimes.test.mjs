// Protocol-fixture tests for the verifier itself. These do not validate any compiler.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeMatrix,verifyRunner} from './verify-docker-runtimes.mjs';

const token='synthetic-unit-test-authentication-value';
const health={engine:'uniexam-docker',protocol:1,network_disabled:true,privileged:false};
const available={id:'python',available:true,image:'sha256:'+'a'.repeat(64),version:'protocol-fixture'};
const job='10000000-0000-4000-8000-000000000001';
const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const result=(status,stdout='')=>({status,stdout,stderr:'',compile_output:'',message:'',time_seconds:0.1,memory_kb:100});
const single=[{id:'python',stdin_applicable:false,cases:[runtimeMatrix[0].cases[0]]}];

test('verifier never sends authentication or code to a non-loopback URL',async()=>{
  let calls=0;
  await assert.rejects(verifyRunner({baseURL:'https://example.invalid',token,fetchImpl:async()=>{calls++;return json({});}}),/loopback/);
  assert.equal(calls,0);
});

test('missing authentication produces failed environment and skipped executions, without a request',async()=>{
  let calls=0;
  const report=await verifyRunner({fetchImpl:async()=>{calls++;return json({});}});
  assert.equal(calls,0);
  assert.equal(report.status,'FAILED');
  assert.equal(report.summary.passed,0);
  assert.equal(report.runtimes.length,13);
  assert.ok(report.runtimes.every(item=>item.status==='SKIPPED'));
});

test('unavailable images are incomplete, never successful language tests',async()=>{
  const endpoints=[];
  const report=await verifyRunner({token,fetchImpl:async(url,options)=>{
    assert.equal(options.headers['X-Auth-Token'],token);
    assert.equal(options.redirect,'error');
    const endpoint=new URL(url).pathname;endpoints.push(endpoint);
    return json(endpoint==='/health'?health:{runtimes:runtimeMatrix.map(item=>({id:item.id,available:false}))});
  }});
  assert.deepEqual(endpoints,['/health','/runtimes']);
  assert.equal(report.status,'PARTIAL');
  assert.deepEqual(report.summary,{passed:0,failed:0,skipped:53});
  assert.equal(report.runtimes.find(item=>item.id==='sql').stdin_applicable,false);
  assert.equal(report.runtimes.find(item=>item.id==='sql').cases.some(item=>item.case_id==='standard_input'),false);
});

test('unsafe health declaration blocks every code submission',async()=>{
  const endpoints=[];
  const report=await verifyRunner({token,fetchImpl:async url=>{endpoints.push(new URL(url).pathname);return json({...health,network_disabled:false});}});
  assert.deepEqual(endpoints,['/health']);
  assert.equal(report.status,'FAILED');
  assert.equal(report.summary.passed,0);
});

test('a successful HTTP response and job status cannot conceal wrong program output',async()=>{
  const report=await verifyRunner({token,matrix:single,isolation:false,fetchImpl:async url=>{
    const endpoint=new URL(url).pathname;
    if(endpoint==='/health')return json(health);
    if(endpoint==='/runtimes')return json({runtimes:[available]});
    if(endpoint==='/runs')return json({id:job});
    return json({...result('SUCCEEDED','incorrect\n'),stderr:token});
  }});
  assert.equal(report.status,'FAILED');
  assert.equal(report.runtimes[0].cases[0].status,'FAILED');
  assert.match(report.runtimes[0].cases[0].reason,/stdout/);
  assert.equal(report.runtimes[0].cases[0].observed.stderr,'[REDACTED]');
  assert.ok(!JSON.stringify(report).includes(token));
});

test('runner protocol errors fail instead of being treated as timeout success',async()=>{
  const report=await verifyRunner({token,matrix:single,isolation:false,fetchImpl:async url=>{
    const endpoint=new URL(url).pathname;
    if(endpoint==='/health')return json(health);
    if(endpoint==='/runtimes')return json({runtimes:[available]});
    if(endpoint==='/runs')return json({id:job});
    return json({...result('UNKNOWN_STATE')});
  }});
  assert.equal(report.status,'FAILED');
  assert.match(report.runtimes[0].cases[0].reason,/Unknown runner job status/);
});

test('oversized daemon responses are rejected before parsing the catalog',async()=>{
  let calls=0;
  const report=await verifyRunner({token,fetchImpl:async()=>{calls++;return new Response('x'.repeat(512*1024+1));}});
  assert.equal(calls,1);
  assert.equal(report.status,'FAILED');
  assert.match(report.errors[0],/exceeds/);
});

test('an image tag advertised as available is not accepted as a verified immutable image',async()=>{
  const endpoints=[];
  const report=await verifyRunner({token,fetchImpl:async url=>{
    const endpoint=new URL(url).pathname;endpoints.push(endpoint);
    return json(endpoint==='/health'?health:{runtimes:[{...available,image:'python:latest'}]});
  }});
  assert.deepEqual(endpoints,['/health','/runtimes']);
  assert.equal(report.status,'FAILED');
  assert.match(report.errors[0],/immutable image/);
  assert.equal(report.summary.passed,0);
});

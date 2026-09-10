// Real execution verification. Never talks to the academic API/database.
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rmdir,unlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const terminal=new Set(['SUCCEEDED','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT','FAILED']);
const pending=new Set(['QUEUED','DISPATCHING','PROCESSING']);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const outputLimit=4096,responseLimit=512*1024;
const interpreted=['COMPILE_ERROR','RUNTIME_ERROR'];
const compiled=['COMPILE_ERROR'];
const fixture=(id,success,invalid,timeout,stdin,errorStatuses=interpreted)=>({
  id,cases:[
    {id:'valid_program',source:success,expectedStatuses:['SUCCEEDED'],expectedStdout:'RUNNER_OK:'+id+'\n'},
    {id:'syntax_error',source:invalid,expectedStatuses:errorStatuses,diagnostic:true},
    {id:'execution_timeout',source:timeout,expectedStatuses:['TIME_LIMIT']},
    ...(stdin?[{id:'standard_input',source:stdin,stdin:'7 35\n',expectedStatuses:['SUCCEEDED'],expectedStdout:'42\n'}]:[]),
  ],stdin_applicable:Boolean(stdin),
});

// These fixtures contain no credentials, academic answers, file deletion,
// process spawning or memory bombs. Timeout cases are single-process loops.
export const runtimeMatrix=[
  fixture('python',
    'print("RUNNER_OK:python")\n',
    'def broken(:\n    pass\n',
    'while True:\n    pass\n',
    'a, b = map(int, input().split())\nprint(a + b)\n'),
  fixture('php',
    '<?php echo "RUNNER_OK:php\\n";\n',
    '<?php function broken( { }\n',
    '<?php while (true) { }\n',
    '<?php $parts = preg_split("/\\\\s+/", trim(fgets(STDIN))); echo intval($parts[0]) + intval($parts[1]), "\\n";\n'),
  fixture('java',
    'public class Main { public static void main(String[] args) { System.out.println("RUNNER_OK:java"); } }\n',
    'public class Main { public static void main(String[] args) { int broken = ; } }\n',
    'public class Main { public static void main(String[] args) { while (true) { } } }\n',
    'import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner input = new Scanner(System.in); System.out.println(input.nextInt() + input.nextInt()); } }\n',compiled),
  fixture('javascript',
    'console.log("RUNNER_OK:javascript");\n',
    'function broken( { }\n',
    'while (true) { }\n',
    'const fs = require("fs"); const values = fs.readFileSync(0, "utf8").trim().split(/\\s+/).map(Number); console.log(values[0] + values[1]);\n'),
  fixture('typescript',
    'const message: string = "RUNNER_OK:typescript"; console.log(message);\n',
    'const broken: number = ;\n',
    'while (true) { }\n',
    'import {readFileSync} from "node:fs";\nconst input: string = readFileSync(0, "utf8"); const values: number[] = input.trim().split(/\\s+/).map(Number); console.log(values[0] + values[1]);\n',compiled),
  fixture('c',
    '#include <stdio.h>\nint main(void) { puts("RUNNER_OK:c"); return 0; }\n',
    'int main(void) { int broken = ; return 0; }\n',
    'int main(void) { volatile unsigned int tick = 0; while (1) { tick++; } }\n',
    '#include <stdio.h>\nint main(void) { int a, b; if (scanf("%d%d", &a, &b) != 2) return 2; printf("%d\\n", a + b); return 0; }\n',compiled),
  fixture('cpp',
    '#include <iostream>\nint main() { std::cout << "RUNNER_OK:cpp" << std::endl; }\n',
    'int main() { int broken = ; }\n',
    'int main() { volatile unsigned int tick = 0; while (true) { tick = tick + 1; } }\n',
    '#include <iostream>\nint main() { int a, b; if (!(std::cin >> a >> b)) return 2; std::cout << a + b << std::endl; }\n',compiled),
  fixture('csharp',
    'using System;\nclass Program { static void Main() { Console.WriteLine("RUNNER_OK:csharp"); } }\n',
    'class Program { static void Main() { int broken = ; } }\n',
    'class Program { static void Main() { while (true) { } } }\n',
    'using System;\nclass Program { static void Main() { string[] values = Console.ReadLine().Split(new char[] { \' \', \'\\t\' }, StringSplitOptions.RemoveEmptyEntries); Console.WriteLine(int.Parse(values[0]) + int.Parse(values[1])); } }\n',compiled),
  fixture('go',
    'package main\nimport "fmt"\nfunc main() { fmt.Println("RUNNER_OK:go") }\n',
    'package main\nfunc main() { var broken = }\n',
    'package main\nfunc main() { for { } }\n',
    'package main\nimport ("fmt"; "os")\nfunc main() { var a, b int; fmt.Fscan(os.Stdin, &a, &b); fmt.Println(a + b) }\n',compiled),
  fixture('rust',
    'fn main() { println!("RUNNER_OK:rust"); }\n',
    'fn main() { let broken = ; }\n',
    'fn main() { loop { } }\n',
    'use std::io::{self, Read};\nfn main() { let mut input = String::new(); io::stdin().read_to_string(&mut input).unwrap(); let mut values = input.split_whitespace(); let a: i32 = values.next().unwrap().parse().unwrap(); let b: i32 = values.next().unwrap().parse().unwrap(); println!("{}", a + b); }\n',compiled),
  fixture('ruby',
    'puts "RUNNER_OK:ruby"\n',
    'def broken(\n',
    'loop { }\n',
    'a, b = STDIN.read.split.map(&:to_i)\nputs a + b\n'),
  fixture('bash',
    'printf "RUNNER_OK:bash\\n"\n',
    'if then\n',
    'while :; do :; done\n',
    'read -r a b\nprintf "%s\\n" "$((a + b))"\n'),
  fixture('sql',
    "SELECT 'RUNNER_OK:sql';\n",
    'SELEC 42;\n',
    // SQLite UNION ALL needs no duplicate history. No rows are printed.
    // https://www.sqlite.org/lang_with.html
    'WITH RECURSIVE spin(n) AS (SELECT 1 UNION ALL SELECT n FROM spin) SELECT count(*) FROM spin;\n',
    null),
];

function loopbackUrl(value){
  const url=new URL(value);
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)){
    throw new Error('The verification URL must be an HTTP loopback origin, without credentials, path or query.');
  }
  return url.origin;
}
function clean(value,token){
  return String(value).replaceAll(token||'\0','[REDACTED]').slice(0,outputLimit);
}
function summarize(report){
  const cases=[...report.runtimes.flatMap(runtime=>runtime.cases),...report.isolation];
  report.summary={passed:cases.filter(item=>item.status==='PASS').length,failed:cases.filter(item=>item.status==='FAILED').length,skipped:cases.filter(item=>item.status==='SKIPPED').length};
  report.status=report.errors.length||report.summary.failed?'FAILED':report.summary.skipped?'PARTIAL':'PASS';
  report.finished_at=new Date().toISOString();
  return report;
}
async function boundedJson(response){
  if(!response.body)throw new Error('Runner returned an empty HTTP body.');
  const reader=response.body.getReader();let size=0;const parts=[];
  try{
    for(;;){
      const item=await reader.read();if(item.done)break;
      size+=item.value.byteLength;
      if(size>responseLimit)throw new Error('Runner response exceeds the verification limit.');
      parts.push(item.value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function verifyRunner({
  baseURL='http://127.0.0.1:4200',token='',fetchImpl=fetch,
  caseTimeoutMs=90000,totalTimeoutMs=900000,pollIntervalMs=300,
  onProgress=()=>{},isolation=true,matrix=runtimeMatrix,
}={}){
  const base=loopbackUrl(baseURL);
  const started=Date.now();
  const report={
    schema:'uniexam-docker-verification-v1',runner_url:base,started_at:new Date(started).toISOString(),
    limits:{case_timeout_ms:caseTimeoutMs,total_timeout_ms:totalTimeoutMs,response_bytes:responseLimit},
    health:null,errors:[],runtimes:[],isolation:[],
    notice:'Synthetic local fixtures only. SKIPPED is not a successful execution. Passing probes are bounded observations, not a proof of perfect isolation.',
  };
  const failText=error=>clean(error instanceof Error?error.message:error,token);
  async function call(endpoint,body,remaining=caseTimeoutMs){
    const response=await fetchImpl(base+endpoint,{
      method:body===undefined?'GET':'POST',redirect:'error',
      signal:AbortSignal.timeout(Math.max(1,Math.min(15000,remaining))),
      headers:{'X-Auth-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    if(!response.ok){await response.body?.cancel();throw new Error('Runner HTTP '+response.status+' on '+endpoint.split('/').slice(0,2).join('/'));}
    return boundedJson(response);
  }
  async function runCase(runtime,definition){
    const begin=Date.now();
    const entry={case_id:definition.id,status:'FAILED',expected_statuses:definition.expectedStatuses,source_sha256:createHash('sha256').update(definition.source).digest('hex')};
    if(Date.now()-started>=totalTimeoutMs)return {...entry,status:'SKIPPED',reason:'Total verification time budget exhausted.'};
    const deadline=Math.min(begin+caseTimeoutMs,started+totalTimeoutMs);
    try{
      const submitted=await call('/runs',{runtime,source:definition.source,stdin:definition.stdin??''},deadline-Date.now());
      if(!uuid.test(submitted?.id??''))throw new Error('Runner did not return a valid job UUID.');
      entry.run_id=submitted.id;
      let result;
      for(;;){
        const remaining=deadline-Date.now();
        if(remaining<=0)throw new Error('Verification polling deadline expired; the runner did not report a terminal result.');
        result=await call('/runs/'+submitted.id,undefined,remaining);
        if(terminal.has(result?.status))break;
        if(!pending.has(result?.status))throw new Error('Unknown runner job status.');
        await new Promise(resolve=>setTimeout(resolve,Math.min(pollIntervalMs,Math.max(1,deadline-Date.now()))));
      }
      for(const field of ['stdout','stderr','compile_output','message'])if(typeof result[field]!=='string')throw new Error('Runner result field '+field+' must be a string.');
      entry.observed={status:result.status,stdout:clean(result.stdout,token),stderr:clean(result.stderr,token),compile_output:clean(result.compile_output,token),message:clean(result.message,token),time_seconds:result.time_seconds??null,memory_kb:result.memory_kb??null};
      if(!definition.expectedStatuses.includes(result.status))throw new Error('Unexpected terminal status: '+result.status);
      if(definition.expectedStdout!==undefined){
        entry.expected_stdout=definition.expectedStdout;
        if(result.stdout.replaceAll('\r\n','\n')!==definition.expectedStdout)throw new Error('stdout does not match the expected output exactly.');
      }
      if(definition.diagnostic&&!result.stderr.trim()&&!result.compile_output.trim())throw new Error('The syntax failure has no compiler/interpreter diagnostic.');
      entry.status='PASS';
    }catch(error){entry.reason=failText(error);}
    entry.elapsed_ms=Date.now()-begin;
    onProgress(runtime,entry);
    return entry;
  }
  const skipAll=reason=>{
    report.runtimes=matrix.map(runtime=>({id:runtime.id,status:'SKIPPED',stdin_applicable:runtime.stdin_applicable,cases:runtime.cases.map(item=>({case_id:item.id,status:'SKIPPED',reason}))}));
    report.isolation=['host_network_probe','synthetic_host_file'].map(case_id=>({case_id,status:'SKIPPED',reason}));
    return summarize(report);
  };
  let availability;
  try{
    if(!token)throw new Error('RUNNER_AUTH_TOKEN is required; no request was sent.');
    report.health=await call('/health');
    if(report.health?.engine!=='uniexam-docker'||report.health?.protocol!==1||report.health?.network_disabled!==true||report.health?.privileged!==false){
      throw new Error('Runner health does not declare the expected local Docker protocol and isolation settings.');
    }
    const catalog=await call('/runtimes');
    if(!Array.isArray(catalog?.runtimes))throw new Error('Runner runtime catalog is invalid.');
    const ids=new Set();
    for(const entry of catalog.runtimes){
      if(!entry||typeof entry.id!=='string'||ids.has(entry.id)||typeof entry.available!=='boolean'){
        throw new Error('Runner runtime catalog contains malformed or duplicate entries.');
      }
      if(entry.available&&(!/^sha256:[0-9a-f]{64}$/.test(entry.image??'')||typeof entry.version!=='string'||!entry.version.trim())){
        throw new Error('An available runtime is missing its verified immutable image ID or version.');
      }
      ids.add(entry.id);
    }
    availability=new Map(catalog.runtimes.map(item=>[item.id,item]));
  }catch(error){report.errors.push(failText(error));return skipAll('Runner is not ready or could not be verified.');}
  for(const definition of matrix){
    const advertised=availability.get(definition.id);
    const entry={id:definition.id,version:advertised?.version??null,image:advertised?.image??null,stdin_applicable:definition.stdin_applicable,cases:[]};
    if(advertised?.available!==true){
      entry.status='SKIPPED';
      entry.cases=definition.cases.map(item=>({case_id:item.id,status:'SKIPPED',reason:'No available, bootstrapped Docker image is advertised for this language.'}));
    }else{
      for(const item of definition.cases)entry.cases.push(await runCase(definition.id,item));
      entry.status=entry.cases.some(item=>item.status==='FAILED')?'FAILED':entry.cases.some(item=>item.status==='SKIPPED')?'PARTIAL':'PASS';
    }
    report.runtimes.push(entry);
  }
  if(isolation&&availability.get('python')?.available===true){
    report.isolation.push(...await verifyIsolation(runCase,failText));
  }else{
    report.isolation=['host_network_probe','synthetic_host_file'].map(case_id=>({case_id,status:'SKIPPED',reason:isolation?'Python is unavailable for the common-engine isolation probes.':'Isolation probes were not requested by this caller.'}));
  }
  return summarize(report);
}

async function verifyIsolation(runCase,failText){
  const checks=[];
  const nonce=randomUUID();
  let hits=0,server,canaryDirectory,canaryPath;
  try{
    server=createServer({maxHeaderSize:1024,headersTimeout:2000,requestTimeout:2000},(_request,response)=>{hits++;response.writeHead(200,{'Content-Type':'text/plain'}).end('synthetic-probe');});
    server.maxConnections=2;
    // A numeric interface avoids a DNS lookup inside an offline container.
    const hostAddress=Object.values(os.networkInterfaces()).flat().find(item=>item?.family==='IPv4'&&!item.internal)?.address;
    if(!hostAddress)throw new Error('No non-loopback IPv4 interface for the synthetic host network probe.');
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,hostAddress,resolve);});
    const port=server.address().port;
    const networkSource='import socket\ntry:\n    with socket.create_connection(('+JSON.stringify(hostAddress)+', '+port+'), timeout=1.0) as connection:\n        connection.sendall(b"GET /'+nonce+' HTTP/1.0\\r\\nHost: local-probe\\r\\n\\r\\n")\n    print("HOST_NETWORK_REACHED")\nexcept OSError:\n    print("HOST_NETWORK_BLOCKED")\n';
    const network=await runCase('python',{id:'host_network_probe',source:networkSource,expectedStatuses:['SUCCEEDED'],expectedStdout:'HOST_NETWORK_BLOCKED\n'});
    network.host_probe_requests=hits;
    if(hits){network.status='FAILED';network.reason='The synthetic host listener received a request from the job.';}
    checks.push(network);
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    server=undefined;

    canaryDirectory=await mkdtemp(path.join(os.tmpdir(),'uniexam-runner-probe-'));
    canaryPath=path.join(canaryDirectory,'synthetic-host-only.txt');
    const marker='SYNTHETIC_ONLY_'+randomUUID();
    await writeFile(canaryPath,marker,{flag:'wx',mode:0o600});
    const candidates=[canaryPath];
    // Only paths to the newly generated marker are tried. No real host secret is read.
    if(process.platform==='win32'){
      const normalized=canaryPath.replaceAll('\\','/');
      const drive=normalized[0].toLowerCase(),suffix=normalized.slice(2);
      candidates.push('/host_mnt/'+drive+suffix,'/run/desktop/mnt/host/'+drive+suffix);
    }
    const fileSource='from pathlib import Path\npaths = '+JSON.stringify(candidates)+'\nmarker = '+JSON.stringify(marker)+'\nleaked = False\nfor name in paths:\n    try:\n        leaked = leaked or Path(name).read_text(encoding="utf-8") == marker\n    except OSError:\n        pass\nprint("SYNTHETIC_HOST_FILE_LEAK" if leaked else "SYNTHETIC_HOST_FILE_BLOCKED")\n';
    checks.push(await runCase('python',{id:'synthetic_host_file',source:fileSource,expectedStatuses:['SUCCEEDED'],expectedStdout:'SYNTHETIC_HOST_FILE_BLOCKED\n'}));
  }catch(error){checks.push({case_id:'isolation_probe_setup',status:'FAILED',reason:failText(error)});}
  finally{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    // Delete only the file and empty directory created here; never recurse.
    if(canaryPath)await unlink(canaryPath).catch(()=>{});
    if(canaryDirectory)await rmdir(canaryDirectory).catch(()=>{});
  }
  return checks;
}

function environmentSeconds(name,fallback,min,max){
  const raw=process.env[name];
  if(raw===undefined)return fallback*1000;
  const value=Number(raw);
  if(!Number.isFinite(value)||value<min||value>max)throw new Error(name+' must be between '+min+' and '+max+' seconds.');
  return value*1000;
}
async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--help')){
    process.stdout.write('Usage: node scripts/verify-docker-runtimes.mjs [--list] [--output relative/report.json]\n'+
      'RUNNER_BASE_URL defaults to http://127.0.0.1:4200; only HTTP loopback is accepted.\n'+
      'RUNNER_AUTH_TOKEN is required for real tests and is never logged. No .env is loaded automatically.\n'+
      'RUNNER_VERIFY_CASE_TIMEOUT_SECONDS=90 (10..180); RUNNER_VERIFY_TOTAL_TIMEOUT_SECONDS=900 (30..1800).\n'+
      'Real mode runs 51 sequential language fixtures and two synthetic isolation probes.\n'+
      'Exit codes: 0 all passed, 1 failed/configuration error, 2 incomplete (including unavailable images).\n'+
      '--list only prints the fixture plan; it does not contact Docker or validate a compiler.\n');
    return;
  }
  if(args.length===1&&args[0]==='--list'){
    process.stdout.write(JSON.stringify({mode:'PLAN_ONLY',execution_verified:false,language_count:runtimeMatrix.length,language_cases:runtimeMatrix.reduce((n,item)=>n+item.cases.length,0),runtimes:runtimeMatrix.map(item=>({id:item.id,stdin_applicable:item.stdin_applicable,cases:item.cases.map(test=>({id:test.id,expected_statuses:test.expectedStatuses}))}))},null,2)+'\n');
    return;
  }
  if(args.length&&!((args.length===2)&&args[0]==='--output'))throw new Error('Unsupported arguments. Use --help.');
  const name='verification-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8)+'.json';
  const destination=path.resolve(repo,args[1]??path.join('output','runner',name));
  const relative=path.relative(repo,destination);
  if(relative.startsWith('..')||path.isAbsolute(relative)||path.extname(destination)!=='.json')throw new Error('The report must be a JSON file inside this workspace.');
  const token=process.env.RUNNER_AUTH_TOKEN??'';
  const report=await verifyRunner({
    baseURL:process.env.RUNNER_BASE_URL||'http://127.0.0.1:4200',token,
    caseTimeoutMs:environmentSeconds('RUNNER_VERIFY_CASE_TIMEOUT_SECONDS',90,10,180),
    totalTimeoutMs:environmentSeconds('RUNNER_VERIFY_TOTAL_TIMEOUT_SECONDS',900,30,1800),
    onProgress:(runtime,result)=>process.stderr.write('['+runtime+'] '+result.case_id+': '+result.status+(result.observed?' ('+result.observed.status+')':'')+'\n'),
  });
  // Defensive redaction also covers an incorrectly implemented local daemon echoing a token.
  const json=JSON.stringify(report,null,2).replaceAll(token||'\0','[REDACTED]')+'\n';
  await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,json,{flag:'wx'});
  process.stdout.write(json);
  process.stderr.write('Report: '+destination+'\n');
  process.exitCode=report.status==='PASS'?0:report.status==='PARTIAL'?2:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{process.stderr.write(clean(error instanceof Error?error.message:error,process.env.RUNNER_AUTH_TOKEN??'')+'\n');process.exitCode=1;});
}

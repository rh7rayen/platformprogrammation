import {spawn,type ChildProcess} from 'node:child_process';
import {createServer as createPortProbe} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Socket} from 'node:net';
import {TEST_ORIGIN,TEST_API_ORIGIN} from '../tests/e2e/test-origin';
import {e2eRunnerSettings} from './e2e-runner-settings';

const root=path.resolve(process.cwd());
const webPort=3100,apiPort=4100,host='127.0.0.1';
if(!existsSync(path.join(root,'packages/contracts/package.json')))throw new Error('Run E2E from the UniExam workspace root.');

async function requireFreePort(port:number){
  const probe=createPortProbe();
  await new Promise<void>((resolve,reject)=>{probe.once('error',()=>reject(new Error(`E2E port ${port} is occupied. No existing server will be reused or stopped.`)));probe.listen(port,host,resolve);});
  await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
}
const isolatedSettings={
  APP_MODE:'demo',HOST:host,PORT:apiPort,NODE_ENV:'test',WEB_ORIGIN:TEST_ORIGIN,
  DATABASE_URL:'',DATABASE_SSL:'false',DATABASE_CA_FILE:'',SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',
  // memory:true below is mandatory. This path is never opened by the harness.
  DEMO_DATA_DIR:'.data/never-open-e2e',
  AI_ENABLED:'false',OPENAI_API_KEY:'',RUNNER_ENABLED:'false',RUNNER_PROVIDER:'judge0',RUNNER_BASE_URL:'',RUNNER_AUTH_TOKEN:'',RUNNER_LANGUAGE_IDS:'{}',
  EMAIL_ENABLED:'false',RESEND_API_KEY:'',EMAIL_FROM:'',EMAIL_ENCRYPTION_KEY:'',
  RECORDINGS_ENABLED:'false',RECORDINGS_BUCKET:'exam-recordings-e2e',
};

function frontendEnvironment():NodeJS.ProcessEnv{
  // Do not pass .env credentials or a production API_URL to the test frontend.
  const allowed=new Set(['path','systemroot','windir','comspec','pathext','temp','tmp','tmpdir','userprofile','home','appdata','localappdata','programfiles','programfiles(x86)','systemdrive','number_of_processors']);
  const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toLowerCase())));
  for(const [key,value] of Object.entries(isolatedSettings))env[key]=String(value);
  return {...env,NODE_ENV:'development',PORT:String(webPort),PROJECT_ROOT:root,API_URL:TEST_API_ORIGIN,UNIEXAM_E2E:'true',NEXT_TELEMETRY_DISABLED:'1',NO_COLOR:'1'};
}

async function startFrontend(){
  if(process.env.UNIEXAM_E2E!=='true'||process.env.API_URL!==TEST_API_ORIGIN)throw new Error('Refuse frontend without the isolated E2E environment.');
  const declarations=path.join(root,'frontend/next-env.d.ts');
  const originalDeclarations=existsSync(declarations)?await readFile(declarations,'utf8'):null;
  const restoreDeclarations=async()=>{
    // Next writes this generated file even with a distinct distDir. Restore the
    // demo's original type imports without overwriting a concurrent normal build.
    if(originalDeclarations!==null&&(await readFile(declarations,'utf8')).includes('.next-e2e/'))await writeFile(declarations,originalDeclarations);
  };
  const {default:next}=await import('next');
  const app=next({dev:true,dir:path.join(root,'frontend'),hostname:host,port:webPort});
  const server=createHttpServer((request,response)=>{void app.getRequestHandler()(request,response);});
  const sockets=new Set<Socket>();
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.on('upgrade',(request,socket,head)=>{void app.getUpgradeHandler()(request,socket,head);});
  let closing=false;
  const close=async()=>{
    if(closing)return;closing=true;
    const force=setTimeout(()=>process.exit(1),8000);force.unref();
    for(const socket of sockets)socket.destroy();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await app.close();await restoreDeclarations();clearTimeout(force);
    if(process.connected)process.disconnect();
  };
  process.on('message',message=>{if(message==='shutdown')void close();});
  process.on('disconnect',()=>void close());process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
  await app.prepare();
  await restoreDeclarations();
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(webPort,host,resolve);});
  console.log(`[e2e] Frontend ${TEST_ORIGIN} → memory API ${TEST_API_ORIGIN}`);
}

async function startHarness(){
  // Both probes happen before any database. Ports3000/4000 are untouched.
  await requireFreePort(webPort);await requireFreePort(apiPort);
  const env=frontendEnvironment();
  if(!existsSync(path.join(root,'frontend/public/monaco/build-manifest.json')))await import('./prepare-monaco.mjs');
  const [{createApp},{loadConfig}]=await Promise.all([import('../backend/src/app'),import('../backend/src/config')]);
  // loadConfig reads .env server-side. The frontend environment was built above
  // with an allowlist and deliberately never receives these runner credentials.
  const config=e2eRunnerSettings(loadConfig(isolatedSettings),process.env);
  if(config.RUNNER_ENABLED==='true'){
    const {DockerAdapter}=await import('../backend/src/execution/docker.adapter');
    const discovery=await new DockerAdapter(config).discover();
    if(!Object.keys(discovery.languages).length)throw new Error('Live E2E preflight failed: Docker unavailable or no validated runtime. Start and validate the local runner before this suite.');
    console.log('[e2e] Explicit live Docker mode: synthetic test programs only; database remains ephemeral.');
  }
  const runtime=await createApp(config,{memory:true,quiet:true});
  let frontend:ChildProcess|undefined,closing=false;
  const close=async(code=0)=>{
    if(closing)return;closing=true;process.exitCode=code;
    if(frontend&&frontend.exitCode===null&&frontend.signalCode===null){
      const child=frontend;
      await new Promise<void>(resolve=>{
        const force=setTimeout(()=>{child.kill();resolve();},9000);force.unref();
        child.once('exit',()=>{clearTimeout(force);resolve();});
        if(child.connected)child.send('shutdown');else child.kill();
      });
    }
    await runtime.close();
    if(process.connected)process.disconnect();
  };
  process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
  process.on('message',message=>{if(message==='shutdown')void close();});
  process.on('disconnect',()=>void close());
  try{
    await runtime.app.listen(apiPort,host);
    console.log(`[e2e] API ${TEST_API_ORIGIN}/api/v1 · ephemeral PGlite memory`);
    frontend=spawn(process.execPath,['--import','tsx','scripts/e2e-server.ts','--frontend'],{cwd:root,env,stdio:['ignore','inherit','inherit','ipc']});
    frontend.on('error',()=>void close(1));frontend.on('exit',code=>{if(!closing)void close(code??1);});
  }catch(error){await close(1);throw error;}
}

void(process.argv.includes('--frontend')?startFrontend():startHarness()).catch(error=>{
  console.error('[e2e] Isolated startup failed:',error instanceof Error?error.message:'unknown error');process.exitCode=1;
});

import {spawn} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [action,...args]=process.argv.slice(2);
const entries={start:'infrastructure/local-runner/server.ts',bootstrap:'infrastructure/local-runner/bootstrap.ts',verify:'scripts/verify-docker-runtimes.mjs'};
if(!Object.hasOwn(entries,action))throw new Error('Usage : node scripts/local-runner.mjs start|bootstrap|verify [options]');
let fileEnv={};
try{fileEnv=parseEnv(await readFile(path.join(root,'.env'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const settings={...fileEnv,...process.env};
// The execution daemon must never inherit application database, email or session secrets.
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|DOCKER_CONFIG|DOCKER_CONTEXT|DOCKER_HOST|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH)$/i.test(key)));
let dockerPath=settings.LOCAL_RUNNER_DOCKER_PATH;
if(!dockerPath&&process.platform==='win32'&&process.env.LOCALAPPDATA){
 const candidate=path.join(process.env.LOCALAPPDATA,'Programs','DockerDesktop','resources','bin','docker.exe');
 try{await access(candidate);dockerPath=candidate;}catch{}
}
if(dockerPath){
 env.LOCAL_RUNNER_DOCKER_PATH=dockerPath;
 const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')??'PATH';
 env[pathKey]=path.dirname(dockerPath)+path.delimiter+(env[pathKey]??'');
}
if(action!=='bootstrap'){
 const token=settings.RUNNER_AUTH_TOKEN??'';
 if(Buffer.byteLength(token)<16||Buffer.byteLength(token)>256||/[\r\n]/.test(token))throw new Error('Configurez RUNNER_AUTH_TOKEN (16 à 256 octets) dans le .env privé.');
 env.RUNNER_AUTH_TOKEN=token;
 env.RUNNER_BASE_URL='http://127.0.0.1:4200';
}
const child=spawn(process.execPath,['--import','tsx',entries[action],...args],{cwd:root,env,stdio:['inherit','inherit','inherit','ipc']});
let stopping=false;
const stop=()=>{
 if(stopping)return;stopping=true;
 if(child.connected)child.send('shutdown');
};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});

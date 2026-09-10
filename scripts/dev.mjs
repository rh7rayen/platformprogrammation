import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {createServer} from 'node:net';
import './prepare-monaco.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const env = { ...process.env, APP_MODE: process.env.APP_MODE || 'demo', NODE_ENV: 'development', PROJECT_ROOT: root };
// Fail before opening the embedded database when a dev server already runs.
for(const port of [3000,Number(env.PORT||4000)]) {
  const probe=createServer();
  await new Promise((resolve,reject)=>{probe.once('error',()=>reject(new Error(`Le port ${port} est déjà utilisé. Gardez le serveur existant ou arrêtez-le avec Ctrl+C avant de relancer.`)));probe.listen(port,'127.0.0.1',resolve);});
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
}
const jobs = [
  spawn(process.execPath, ['--import', 'tsx', 'backend/src/main.ts'], { cwd: root, env, stdio: ['inherit','inherit','inherit','ipc'] }),
  spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', 'frontend', '--hostname', '127.0.0.1'], { cwd: root, env, stdio: 'inherit' }),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  // Close PGlite and flush its checkpoint before stopping the API process.
  if(jobs[0].connected)jobs[0].send('shutdown');
  jobs[1].kill();
  process.exitCode = code;
}
jobs.forEach(job => job.on('exit', code => stop(code || 0)));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

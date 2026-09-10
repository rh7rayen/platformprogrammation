import { createApp } from './app';
import { loadConfig } from './config';
async function main() {
  const config=loadConfig();
  const runtime=await createApp(config);
  await runtime.app.listen(config.PORT,config.HOST);
  console.log(`UniExam API: http://${config.HOST}:${config.PORT}/api/v1 | ${config.APP_MODE}`);
  let closing=false;
  const stop=async()=>{if(closing)return;closing=true;await runtime.close();if(process.connected)process.disconnect();};
  process.on('message',message=>{if(message==='shutdown')void stop();});
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
main().catch(error=>{console.error('API startup failed:',error instanceof Error?error.message:'unknown error');process.exitCode=1;});

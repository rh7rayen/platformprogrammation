import {createApp} from '../app';
import {loadConfig} from '../config';
import {MonitoringService} from './monitoring.service';
async function main(){const runtime=await createApp(loadConfig(),{quiet:true});try{console.log(JSON.stringify(await runtime.app.get(MonitoringService).purgeExpired()));}finally{await runtime.close();}}
main().catch(()=>{console.error('La purge vidéo a échoué. Réessayez et vérifiez le stockage privé.');process.exitCode=1;});

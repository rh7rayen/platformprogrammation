import type {AppConfig} from '../backend/src/config';

/** Only an explicit live-runner suite may cross from the memory API to Docker. */
export function e2eRunnerSettings(config:AppConfig,environment:NodeJS.ProcessEnv):AppConfig{
  const disabled={...config,RUNNER_ENABLED:'false' as const,RUNNER_PROVIDER:'judge0' as const,RUNNER_BASE_URL:'',RUNNER_AUTH_TOKEN:'',RUNNER_LANGUAGE_IDS:'{}'};
  if(environment.UNIEXAM_E2E_REAL_RUNNER!=='true')return disabled;
  let url:URL;try{url=new URL(environment.RUNNER_BASE_URL??'');}catch{throw new Error('Live E2E requires the Docker runner on loopback port 4200.');}
  if(environment.RUNNER_PROVIDER!=='docker'||url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.port!=='4200'
    ||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Live E2E accepts only the Docker provider at HTTP loopback port 4200.');
  const token=environment.RUNNER_AUTH_TOKEN??'';
  if(token.length<16||/[\r\n]/.test(token))throw new Error('Live E2E requires a configured runner authentication token of at least 16 characters.');
  return {...disabled,RUNNER_ENABLED:'true',RUNNER_PROVIDER:'docker',RUNNER_BASE_URL:url.origin,RUNNER_AUTH_TOKEN:token};
}

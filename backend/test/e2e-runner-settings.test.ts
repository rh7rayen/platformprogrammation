import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../src/config';
import {e2eRunnerSettings} from '../../scripts/e2e-runner-settings';

const config=loadConfig({APP_MODE:'demo',NODE_ENV:'test',RUNNER_ENABLED:'false',RUNNER_PROVIDER:'judge0',AI_ENABLED:'false',EMAIL_ENABLED:'false',RECORDINGS_ENABLED:'false'});
const local={UNIEXAM_E2E_REAL_RUNNER:'true',RUNNER_PROVIDER:'docker',RUNNER_BASE_URL:'http://127.0.0.1:4200',RUNNER_AUTH_TOKEN:'synthetic-contract-token'};
test('ordinary E2E cannot inherit an enabled real provider or its credential',()=>{
  const inherited={...config,RUNNER_ENABLED:'true' as const,RUNNER_PROVIDER:'docker' as const,RUNNER_BASE_URL:local.RUNNER_BASE_URL,RUNNER_AUTH_TOKEN:local.RUNNER_AUTH_TOKEN};
  for(const flag of [undefined,'false','1']){
    const result=e2eRunnerSettings(inherited,{...local,UNIEXAM_E2E_REAL_RUNNER:flag});
    assert.equal(result.RUNNER_ENABLED,'false');assert.equal(result.RUNNER_AUTH_TOKEN,'');assert.equal(result.RUNNER_BASE_URL,'');
  }
});
test('live opt-in accepts only authenticated Docker on loopback4200 and refuses public URLs, other providers and short tokens',()=>{
  const valid=e2eRunnerSettings(config,local);assert.equal(valid.RUNNER_ENABLED,'true');assert.equal(valid.RUNNER_PROVIDER,'docker');assert.equal(valid.RUNNER_BASE_URL,local.RUNNER_BASE_URL);assert.equal(valid.RUNNER_AUTH_TOKEN,local.RUNNER_AUTH_TOKEN);
  for(const override of [{RUNNER_PROVIDER:'judge0'},{RUNNER_PROVIDER:undefined},{RUNNER_AUTH_TOKEN:'short'},{RUNNER_AUTH_TOKEN:'synthetic-token\r\ninjected'},{RUNNER_BASE_URL:'http://127.0.0.1:4000'},{RUNNER_BASE_URL:'http://runner.example:4200'},{RUNNER_BASE_URL:'https://127.0.0.1:4200'},{RUNNER_BASE_URL:'http://user:pass@127.0.0.1:4200'},{RUNNER_BASE_URL:'http://127.0.0.1:4200/other'},{RUNNER_BASE_URL:'http://127.0.0.1:4200?other'}])assert.throws(()=>e2eRunnerSettings(config,{...local,...override}));
});

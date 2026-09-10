import {defineConfig} from '@playwright/test';
import {TEST_ORIGIN} from './tests/e2e/test-origin';

// Separate opt-in suite: excluded from npm run test:e2e and ordinary CI runs.
export default defineConfig({
  testDir:'./tests/runner-e2e',workers:1,fullyParallel:false,retries:0,timeout:420000,globalTimeout:900000,
  expect:{timeout:60000},outputDir:'test-results/runner-live',
  use:{baseURL:TEST_ORIGIN,browserName:'chromium',channel:'chrome',headless:true,viewport:{width:1600,height:1100},trace:'retain-on-failure',screenshot:'only-on-failure'},
  reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report/runner-live'}]],
  webServer:{command:'node --import tsx scripts/e2e-server.ts',url:`${TEST_ORIGIN}/api/health/ready`,reuseExistingServer:false,timeout:180000,
    gracefulShutdown:{signal:'SIGTERM',timeout:12000},env:{UNIEXAM_E2E_REAL_RUNNER:'true'}},
});

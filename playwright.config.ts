import { defineConfig } from '@playwright/test';
import { TEST_ORIGIN } from './tests/e2e/test-origin';
export default defineConfig({
  testDir:'./tests/e2e',workers:1,fullyParallel:false,timeout:45000,
  use:{baseURL:TEST_ORIGIN,browserName:'chromium',channel:'chrome',headless:true,viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
  reporter:[['list'],['html',{open:'never'}]],
  webServer:{command:'node --import tsx scripts/e2e-server.ts',url:`${TEST_ORIGIN}/api/health/ready`,reuseExistingServer:false,timeout:180000,gracefulShutdown:{signal:'SIGTERM',timeout:12000}},
});

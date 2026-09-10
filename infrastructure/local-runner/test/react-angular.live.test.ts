import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {DockerEngine} from '../engine.js';
import {dockerCommand} from '../docker-cli.js';
import {reactAngularRuntimes,frontendFrameworkImage} from '../react-angular.js';

test('live Docker: real React and Angular AOT build, interactive opaque preview, and compiler errors', {skip:process.env.UNIEXAM_FRAMEWORK_LIVE!=='true',timeout:180000},async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'uniexam-framework-live-'));
  const engine=new DockerEngine(dockerCommand(),folder);await engine.init();
  const image=await engine.inspect(frontendFrameworkImage);assert.ok(image,'Build the dedicated framework image before this opt-in test.');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({offline:true});const page=await context.newPage();const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    for(const definition of reactAngularRuntimes){
      const result=await engine.execute(definition,definition.sample,'',image.imageId);
      assert.equal(result.status,'SUCCEEDED',JSON.stringify({...result,preview_html:undefined}));
      assert.equal(result.stdout.trim(),'Bonjour!');assert.ok(result.preview_html);assert.ok(Buffer.byteLength(result.preview_html)<=2*1024*1024);
      await page.setContent('<iframe title="Isolated framework" sandbox="allow-scripts"></iframe>');
      await page.locator('iframe').evaluate((iframe,html)=>{(iframe as HTMLIFrameElement).srcdoc=html;},result.preview_html);
      const preview=page.frameLocator('iframe');
      await preview.getByRole('heading',{name:'Bonjour!'}).waitFor({timeout:10000}).catch(error=>{throw new Error(`${definition.id} preview: ${errors.join(' | ')} / ${error.message}`);});
      await preview.getByRole('button',{name:'Compteur 0',exact:true}).click();
      await preview.getByRole('button',{name:'Compteur 1',exact:true}).waitFor();
      const frame=page.frames().find(frame=>frame!==page.mainFrame())!;
      assert.equal(await frame.evaluate(()=>{try{void window.parent.document.body;return false;}catch{return true;}}),true);
      console.log(`${definition.id}: actual ${Buffer.byteLength(result.preview_html)}-byte bundle rendered offline; counter 0 → 1; parent DOM inaccessible.`);
      const invalid=JSON.parse(definition.sample);const filename=definition.id==='react'?'App.tsx':'app.component.ts';
      invalid.files[filename]=definition.id==='react'?'export default function App() { const count: number = "wrong"; return <div>{count}</div>; }':'import {Component} from "@angular/core"; @Component({selector:"app-root",standalone:true,template:"<h1>{{ missingProperty }}</h1>"}) export class AppComponent {}';
      const error=await engine.execute(definition,JSON.stringify(invalid),'',image.imageId);
      assert.equal(error.status,'COMPILE_ERROR',JSON.stringify(error));assert.ok(error.compile_output.trim());assert.equal(error.preview_html,undefined);
      console.log(`${definition.id}: actual TypeScript/template error rejected by compiler.`);
    }
    await context.close();
  }finally{
    await browser.close();await engine.stop();
    assert.equal(path.dirname(folder),tmpdir());assert.ok(path.basename(folder).startsWith('uniexam-framework-live-'));
    await rm(folder,{recursive:true,force:true});
  }
});

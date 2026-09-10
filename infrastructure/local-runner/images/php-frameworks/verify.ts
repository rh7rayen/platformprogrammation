import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {DockerEngine,DATA,type RunnerResult} from '../../engine.js';
import type {Runtime} from '../../catalog.js';
import {phpFrameworkRuntimes} from '../../php-frameworks.js';

if(!process.argv.includes('--run'))throw new Error('Exécuter explicitement verify.ts --run après disponibilité de Docker et accord de coordination.');
const engine=new DockerEngine(undefined,path.join(DATA,'framework-verification'));
await engine.init();
const report:{runtime:string;case:string;status:string;preview_bytes:number;passed:boolean;detail:string}[]=[];
const images:Record<string,string>={};
let failures=0;
try{
  for(const definition of phpFrameworkRuntimes){
    const image=await engine.inspect(definition.image);assert.ok(image,'Image de framework non construite.');
    images[definition.id]=image.imageId;
    const project=JSON.parse(definition.sample) as {format:string;runtime:string;files:Record<string,string>};
    const sourceFile=definition.id==='symfony'?'src/Controller/ExamController.php':'routes/web.php';
    const viewFile=definition.id==='symfony'?'templates/exam.html.twig':'resources/views/exam.blade.php';
    const cases:[string,string,string,(result:RunnerResult&{preview_html?:string})=>void][]=[
      ['GET réel',definition.sample,'',result=>{assert.equal(result.status,'SUCCEEDED');assert.ok(result.preview_html?.includes('Bonjour monde'));assert.match(result.stdout,/HTTP 200/);assert.equal(result.stderr,'');}],
      ['POST réel',definition.sample,JSON.stringify({method:'POST',path:'/',body:{name:'Lina'}}),result=>{assert.equal(result.status,'SUCCEEDED');assert.ok(result.preview_html?.includes('Bonjour Lina'));}],
      ['Paramètres GET',definition.sample,JSON.stringify({method:'GET',path:'/?name=Amine',body:''}),result=>{assert.equal(result.status,'SUCCEEDED');assert.ok(result.preview_html?.includes('Bonjour Amine'));}],
      ['Route absente',definition.sample,JSON.stringify({method:'GET',path:'/uniexam-route-absente',body:''}),result=>{assert.equal(result.status,'SUCCEEDED');assert.match(result.stdout,/HTTP 404/);assert.ok(result.preview_html);}],
      ['Vue réellement modifiée',JSON.stringify({...project,files:{...project.files,[viewFile]:project.files[viewFile].replace('Une vraie réponse','VIEW_EXECUTED · Une vraie réponse')}}),'',result=>{assert.equal(result.status,'SUCCEEDED');assert.ok(result.preview_html?.includes('VIEW_EXECUTED'));}],
      ['Erreur PHP',JSON.stringify({...project,files:{...project.files,[sourceFile]:'<?php this is invalid php ;'}}),'',result=>{assert.ok(['RUNTIME_ERROR','COMPILE_ERROR'].includes(result.status));assert.ok(result.stderr||result.compile_output);}],
      ['Chemin non autorisé',JSON.stringify({...project,files:{...project.files,'../escape.php':'<?php echo 1;'}}),'',result=>{assert.equal(result.status,'COMPILE_ERROR');}],
      ['URL absolue refusée',definition.sample,JSON.stringify({method:'GET',path:'https://example.invalid/',body:''}),result=>{assert.equal(result.status,'RUNTIME_ERROR');assert.match(result.stderr,/chemin/);}],
      ['Échappement des templates',definition.sample,JSON.stringify({method:'POST',path:'/',body:{name:'<script>unsafe()</script>'}}),result=>{assert.equal(result.status,'SUCCEEDED');assert.ok(result.preview_html?.includes('&lt;script&gt;'));assert.ok(!result.preview_html?.includes('<script>unsafe()'));}],
    ];
    const loop=definition.id==='symfony'?project.files[sourceFile].replace('$name =','while (true) {}\n        $name ='):project.files[sourceFile].replace('return view','while (true) {}\n    return view');
    cases.push(['Limite réelle de temps',JSON.stringify({...project,files:{...project.files,[sourceFile]:loop}}),'',result=>assert.equal(result.status,'TIME_LIMIT')]);
    for(const [name,source,stdin,verify] of cases){
      const result=await engine.execute(definition as Runtime,source,stdin,image.imageId) as RunnerResult&{preview_html?:string};
      let passed=true,detail='';try{verify(result);}catch(error){passed=false;failures++;detail=(error as Error).message.slice(0,500);}
      report.push({runtime:definition.id,case:name,status:result.status,preview_bytes:Buffer.byteLength(result.preview_html??''),passed,detail:passed?'':detail+' '+(result.stderr||result.compile_output||result.message).slice(0,1200)});
      console.log(`${definition.id} · ${name} : ${passed?'PASS':'FAIL'} (${result.status})`);
    }
  }
}finally{await engine.stop();await writeFile(path.join(DATA,'framework-verification.json'),JSON.stringify({verified_at:new Date().toISOString(),images,tests:report},null,2)+'\n');}
if(failures)process.exitCode=1;

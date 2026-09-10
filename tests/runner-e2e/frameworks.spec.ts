import {test,expect,type Page} from '@playwright/test';
import {TEST_ORIGIN} from '../e2e/test-origin';
import {RUNTIME_CATALOG,type RuntimeId,type ExecutionRun} from '../../packages/contracts/src/runtimes';
import {frameworkIds,parseFrameworkProject,type FrameworkId} from '../../packages/contracts/src/projects';
import type {AttemptData} from '../../packages/contracts/src/assessments';

const university='/api/universities/10000000-0000-4000-8000-000000000001';
const offering='60000000-0000-4000-8000-000000000005';
const ids:RuntimeId[]=[...frameworkIds,'mysql'];
const terminal=new Set(['SUCCEEDED','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT','FAILED']);
const minute=()=>new Promise(resolve=>setTimeout(resolve,60000));
function card(page:Page,title:string){return page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});}
function publicRun(body:string):ExecutionRun{
  expect(body).not.toMatch(/provider_token|source_code|preview_html|RUNNER_AUTH_TOKEN|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|\.env\b|<!doctype|<html\b|<script\b/i);
  const run=JSON.parse(body) as ExecutionRun;expect(run.id).toMatch(/^[0-9a-f-]{36}$/);return run;
}

test('live framework UI: editable React, Angular, Symfony and Laravel projects, private previews, and real MySQL',async({page,context},testInfo)=>{
  page.setDefaultTimeout(30000);
  // The real quota is per student, including runs in another test file.
  await test.step('Respecter le quota étudiant partagé avec les autres recettes : attendre 60 secondes',minute);
  const directRunnerRequests:string[]=[],environmentRequests:string[]=[];
  context.on('request',request=>{const url=new URL(request.url());if(url.port==='4200')directRunnerRequests.push(url.origin+url.pathname);if(/\/\.env(?:$|\?)/.test(url.pathname))environmentRequests.push(url.pathname);});
  const title=`Recette frameworks réelle · ${Date.now()}`;
  const evidence:{runtime:RuntimeId;run_id:string;answer_version:number;status:string;stdout:string;scenario:string}[]=[];
  await page.goto('/');await page.getByRole('button',{name:/Sami Haddad/}).click();
  await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
  const catalogue=await page.request.get(`${university}/execution/runtimes`);expect(catalogue.ok(),await catalogue.text()).toBeTruthy();
  const availability=(await catalogue.json()).data as {id:RuntimeId;execution_available:boolean;reason:string}[];
  expect(availability.map(item=>item.id).sort()).toEqual(RUNTIME_CATALOG.map(item=>item.id).sort());
  for(const id of ids){const runtime=availability.find(item=>item.id===id)!;expect(runtime.execution_available,`${id}: ${runtime.reason}`).toBe(true);}
  const created=await page.request.post(`${university}/assessments`,{headers:{origin:TEST_ORIGIN},data:{
    title,description:'Recette synthétique des projets et bases pédagogiques isolés.',course_offering_id:offering,kind:'PRACTICAL',
    opens_at:new Date(Date.now()-60000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:60,allow_paste:false,requires_code:false,
    questions:ids.map(runtime=>({type:'CODE',runtime,title:`Projet ${runtime}`,statement:'Modifiez les fichiers et testez cette application synthétique dans la plateforme.',points:1,starter_code:RUNTIME_CATALOG.find(item=>item.id===runtime)!.starterCode})),
  }});expect(created.ok(),await created.text()).toBeTruthy();const assessment=(await created.json()).id as string;
  await page.reload();await card(page,title).getByRole('button',{name:'Publier',exact:true}).click();
  await page.getByRole('button',{name:'Confirmer la publication',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Lina Ben Salem');await page.getByRole('dialog').getByRole('button',{name:'Fermer',exact:true}).click();
  await page.getByRole('button',{name:'Mon profil',exact:true}).click();await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();
  await page.getByRole('button',{name:/Lina Ben Salem/}).click();await card(page,title).getByRole('button',{name:'Ouvrir mon devoir',exact:true}).click();
  await page.getByRole('button',{name:'Commencer le devoir',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Questions du devoir'}).getByRole('button')).toHaveCount(5);
  const attempt=new URL(page.url()).searchParams.get('attempt');expect(attempt).toBeTruthy();const base=`${university}/attempts/${attempt}`;
  const readAttempt=async():Promise<AttemptData>=>{const response=await page.request.get(base);expect(response.ok()).toBeTruthy();return response.json();};
  const initial=await readAttempt();let starts=0;
  const preview=()=>page.frameLocator('iframe[title="Aperçu du projet web"]');
  async function execute(runtime:RuntimeId,scenario:string):Promise<ExecutionRun>{
    if(starts>0&&starts%5===0)await test.step('Respecter le quota : attendre 60 secondes après cinq exécutions',minute);
    const question=initial.questions.find(item=>item.runtime===runtime)!;
    const button=page.getByRole('button',{name:'Exécuter',exact:true});await expect(button).toBeEnabled();
    const accepted=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`${base}/questions/${question.id}/runs`));
    await button.click();const response=await accepted;const acceptedBody=await response.text();expect(response.ok(),`${response.status()}: ${acceptedBody}`).toBeTruthy();
    starts++;const job=publicRun(acceptedBody);const request=response.request().postDataJSON() as {expected_version:number};expect(job.answer_version).toBe(request.expected_version);
    let result=job;
    await expect.poll(async()=>{const response=await page.request.get(`${base}/runs/${job.id}`);const body=await response.text();expect(response.ok(),`${response.status()}: ${body}`).toBeTruthy();result=publicRun(body);return terminal.has(result.status);},{timeout:120000,intervals:[1000,1500,2000]}).toBe(true);
    expect(result.status,JSON.stringify(result)).toBe('SUCCEEDED');expect(result.question_id).toBe(question.id);expect(result.answer_version).toBe(request.expected_version);
    await expect(page.locator('.code-terminal')).toContainText(`Version enregistrée : ${result.answer_version}`);
    evidence.push({runtime,run_id:result.id,answer_version:result.answer_version,status:result.status,stdout:result.stdout,scenario});
    return result;
  }
  async function openProject(runtime:FrameworkId){
    const question=initial.questions.find(item=>item.runtime===runtime)!;
    await page.getByRole('navigation',{name:'Questions du devoir'}).getByRole('button',{name:new RegExp(`Projet ${runtime}\\b`)}).click();
    const project=parseFrameworkProject(question.starter_code,runtime),files=Object.keys(project.files);
    await expect(page.getByRole('tablist',{name:'Fichiers du projet'}).getByRole('tab')).toHaveCount(2);
    for(const filename of files){await page.getByRole('tab',{name:filename,exact:true}).click();await expect(page.getByRole('textbox',{name:`Code ${filename}`,exact:true})).toBeVisible();}
    // A real Monaco edit in the second file must survive the saved project snapshot.
    const filename=files[1],marker=runtime==='react'||runtime==='angular'?`\n/* UI_${runtime} */`:`\n<!-- UI_${runtime} -->`;
    const editor=page.getByRole('textbox',{name:`Code ${filename}`,exact:true});await editor.press('Control+End');await page.keyboard.insertText(marker);
    await expect.poll(async()=>{const saved=(await readAttempt()).answers.find(item=>item.question_id===question.id);if(!saved)return '';return (parseFrameworkProject(saved.answer_text,runtime).files as Record<string,string>)[filename];}).toBe((project.files as Record<string,string>)[filename]+marker);
  }
  for(const runtime of ['react','angular'] as const){
    await test.step(`${runtime}: compile two edited files and interact with the framework`,async()=>{
      await openProject(runtime);await execute(runtime,'interactive counter');
      await expect(preview().getByRole('heading',{name:runtime==='react'?'Bonjour React !':'Bonjour Angular !',exact:true})).toBeVisible();
      await preview().getByRole('button',{name:'Compteur 0',exact:true}).click();await expect(preview().getByRole('button',{name:'Compteur 1',exact:true})).toBeVisible();
      await expect(page.locator('iframe[title="Aperçu du projet web"]')).not.toHaveAttribute('sandbox',/allow-same-origin/);
    });
  }
  for(const runtime of ['symfony','laravel'] as const){
    await test.step(`${runtime}: GET and POST requests use the saved controller and template`,async()=>{
      await openProject(runtime);
      for(const method of ['GET','POST'] as const){
        const name=`${method}_${runtime}`;const request=method==='GET'?{method,path:`/?name=${name}`}:{method,path:'/',body:{name}};
        await page.getByRole('textbox',{name:'Entrée standard',exact:true}).fill(JSON.stringify(request));
        const result=await execute(runtime,`${method} name`);expect(result.stdout).toContain('HTTP 200');
        await expect(page.getByRole('region',{name:'Sortie du programme',exact:true})).toContainText('HTTP 200');
        await expect(preview().getByRole('heading',{name:`Bonjour ${name} !`,exact:true})).toBeVisible();
      }
    });
  }
  await test.step('MySQL: ephemeral table, insertion, and real aggregation return42',async()=>{
    await page.getByRole('navigation',{name:'Questions du devoir'}).getByRole('button',{name:/Projet mysql\b/}).click();
    await expect(page.getByRole('textbox',{name:'Code MySQL',exact:true})).toBeVisible();
    const result=await execute('mysql','CREATE/INSERT/SUM');expect(result.stdout).toMatch(/(?:^|\s)42(?:\s|$)/);
    await expect(page.getByRole('region',{name:'Sortie du programme',exact:true})).toContainText('42');
  });
  expect(directRunnerRequests).toEqual([]);expect(environmentRequests).toEqual([]);
  await testInfo.attach('framework-ui-results.json',{body:Buffer.from(JSON.stringify({assessment,attempt,evidence,directRunnerRequests,environmentRequests},null,2)),contentType:'application/json'});
  await page.screenshot({path:testInfo.outputPath('mysql-real-result.png'),fullPage:true});
});

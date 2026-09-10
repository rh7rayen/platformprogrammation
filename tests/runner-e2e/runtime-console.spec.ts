import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {TEST_ORIGIN} from '../e2e/test-origin';
import {RUNTIME_CATALOG,type RuntimeId,type ExecutionRun} from '../../packages/contracts/src/runtimes';
import type {AttemptData} from '../../packages/contracts/src/assessments';

const university='/api/universities/10000000-0000-4000-8000-000000000001';
const offering='60000000-0000-4000-8000-000000000005';
const programs:{runtime:RuntimeId;source:string}[]=[
  {runtime:'php',source:'<?php echo "UI_OK_php\\n";\n'},
  {runtime:'python',source:'print("UI_OK_python")\n'},
  {runtime:'java',source:'public class Main { public static void main(String[] args) { System.out.println("UI_OK_java"); } }\n'},
  {runtime:'javascript',source:'console.log("UI_OK_javascript");\n'},
  {runtime:'typescript',source:'const message: string = "UI_OK_typescript"; console.log(message);\n'},
  {runtime:'c',source:'#include <stdio.h>\nint main(void) { puts("UI_OK_c"); return 0; }\n'},
  {runtime:'cpp',source:'#include <iostream>\nint main() { std::cout << "UI_OK_cpp" << std::endl; return 0; }\n'},
  {runtime:'csharp',source:'using System; class Program { static void Main() { Console.WriteLine("UI_OK_csharp"); } }\n'},
  {runtime:'go',source:'package main\nimport "fmt"\nfunc main() { fmt.Println("UI_OK_go") }\n'},
  {runtime:'rust',source:'fn main() { println!("UI_OK_rust"); }\n'},
  {runtime:'ruby',source:'puts "UI_OK_ruby"\n'},
  {runtime:'bash',source:'printf "UI_OK_bash\\n"\n'},
  {runtime:'sql',source:"SELECT 'UI_OK_sql';\n"},
];
const terminal=new Set(['SUCCEEDED','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT','FAILED']);
function card(page:Page,title:string){return page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});}

test('live Docker UI: Sami publishes thirteen language questions; Lina runs saved code and sees real stdout and PHP errors',async({page},testInfo:TestInfo)=>{
  page.setDefaultTimeout(30000);
  await test.step('Respecter le quota étudiant partagé avec les autres recettes : attendre 60 secondes',async()=>{await new Promise(resolve=>setTimeout(resolve,60000));});
  const expected:RuntimeId[]=['php','python','java','javascript','typescript','c','cpp','csharp','go','rust','ruby','bash','sql'];
  expect(programs.map(program=>program.runtime).sort()).toEqual([...expected].sort());
  for(const id of expected)expect(RUNTIME_CATALOG.find(runtime=>runtime.id===id)?.kind).toBe('REMOTE');
  const title=`Recette Docker réelle · ${Date.now()}`;
  const evidence:{runtime:RuntimeId;run_id:string;answer_version:number;status:string;stdout:string}[]=[];
  await page.goto('/');await page.getByRole('button',{name:/Sami Haddad/}).click();
  await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
  const availabilityResponse=await page.request.get(`${university}/execution/runtimes`);expect(availabilityResponse.ok()).toBeTruthy();
  const availability=(await availabilityResponse.json()).data as {id:RuntimeId;execution_available:boolean;reason:string}[];
  for(const program of programs)expect(availability.find(runtime=>runtime.id===program.runtime)?.execution_available,`Missing real Docker runtime: ${program.runtime}`).toBe(true);

  // Assessment setup also goes through the authenticated BFF and real Nest API.
  const created=await page.request.post(`${university}/assessments`,{headers:{origin:TEST_ORIGIN},data:{
    title,description:'Programmes synthétiques pour la recette locale ; aucune copie réelle utilisée.',course_offering_id:offering,kind:'PRACTICAL',
    opens_at:new Date(Date.now()-60000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:60,allow_paste:false,requires_code:false,
    questions:programs.map(program=>({type:'CODE',runtime:program.runtime,title:`Exécution ${program.runtime}`,statement:'Exécutez ce programme synthétique et vérifiez sa sortie dans la console.',points:1,starter_code:program.source})),
  }});expect(created.ok()).toBeTruthy();const assessment=(await created.json()).id as string;
  await page.reload();await card(page,title).getByRole('button',{name:'Publier',exact:true}).click();
  await page.getByRole('button',{name:'Confirmer la publication',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Lina Ben Salem');await page.getByRole('dialog').getByRole('button',{name:'Fermer',exact:true}).click();
  await page.getByRole('button',{name:'Mon profil',exact:true}).click();await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();
  await page.getByRole('button',{name:/Lina Ben Salem/}).click();
  await card(page,title).getByRole('button',{name:'Ouvrir mon devoir',exact:true}).click();await page.getByRole('button',{name:'Commencer le devoir',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Questions du devoir'}).getByRole('button')).toHaveCount(13);
  const attempt=new URL(page.url()).searchParams.get('attempt');expect(attempt).toBeTruthy();
  const base=`${university}/attempts/${attempt}`;
  const readAttempt=async():Promise<AttemptData>=>{const response=await page.request.get(base);expect(response.ok()).toBeTruthy();return response.json();};
  const initial=await readAttempt();expect(initial.attempt.assessment_id).toBe(assessment);
  let starts=0;
  async function execute(questionId:string):Promise<ExecutionRun>{
    // Keep the actual production admission quota (six starts/minute). No test bypass.
    if(starts>0&&starts%5===0)await test.step('Respecter le quota : attendre 60 secondes après cinq exécutions',async()=>{await new Promise(resolve=>setTimeout(resolve,60000));});
    const button=page.getByRole('button',{name:'Exécuter',exact:true});await expect(button).toBeEnabled();
    const accepted=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`${base}/questions/${questionId}/runs`));
    await button.click();const response=await accepted;expect(response.ok(),`Execution ${response.status()}: ${await response.text()}`).toBeTruthy();starts++;
    const request=response.request().postDataJSON() as {expected_version:number};const job=await response.json() as ExecutionRun;
    expect(job.answer_version).toBe(request.expected_version);expect(job.answer_version).toBeGreaterThan(0);
    await expect.poll(async()=>{const result=await page.request.get(`${base}/runs/${job.id}`);expect(result.ok()).toBeTruthy();return terminal.has((await result.json()).status);},{timeout:60000,intervals:[1000,1500,2000]}).toBe(true);
    const persisted=await (await page.request.get(`${base}/runs/${job.id}`)).json() as ExecutionRun;
    expect(persisted.question_id).toBe(questionId);expect(persisted.answer_version).toBe(request.expected_version);
    return persisted;
  }
  for(const program of programs){
    await test.step(`Real ${program.runtime} execution and visible console output`,async()=>{
      const question=initial.questions.find(item=>item.runtime===program.runtime)!;
      await page.getByRole('navigation',{name:'Questions du devoir'}).getByRole('button',{name:new RegExp(`Exécution ${program.runtime}\\b`)}).click();
      const definition=RUNTIME_CATALOG.find(runtime=>runtime.id===program.runtime)!;
      await expect(page.getByRole('textbox',{name:`Code ${definition.label}`,exact:true})).toBeVisible();
      const result=await execute(question.id);expect(result.status,JSON.stringify(result)).toBe('SUCCEEDED');
      expect(result.stdout.trim()).toBe(`UI_OK_${program.runtime}`);
      await expect(page.getByRole('region',{name:'Sortie du programme',exact:true})).toContainText(`UI_OK_${program.runtime}`);
      await expect(page.locator('.code-terminal')).toContainText(`Version enregistrée : ${result.answer_version}`);
      const saved=(await readAttempt()).answers.find(answer=>answer.question_id===question.id)!;
      expect(saved.answer_text).toBe(program.source);expect(saved.version).toBe(result.answer_version);
      evidence.push({runtime:program.runtime,run_id:result.id,answer_version:result.answer_version,status:result.status,stdout:result.stdout});
    });
  }

  await test.step('PHP syntax failure is persisted and visible in the error stream',async()=>{
    const question=initial.questions.find(item=>item.runtime==='php')!;
    await page.getByRole('navigation',{name:'Questions du devoir'}).getByRole('button',{name:/Exécution php\b/}).click();
    const editor=page.getByRole('textbox',{name:'Code PHP',exact:true});await editor.press('Control+A');await page.keyboard.insertText('<?php echo ;');
    await expect.poll(async()=>(await readAttempt()).answers.find(answer=>answer.question_id===question.id)?.answer_text).toBe('<?php echo ;');
    const result=await execute(question.id);expect(result.status).toBe('RUNTIME_ERROR');expect(result.stderr).toMatch(/parse error|syntax error/i);
    await expect(page.getByRole('region',{name:'Erreurs du programme',exact:true})).toContainText(/parse error|syntax error/i);
    await expect(page.locator('.code-terminal')).toContainText('Erreur d’exécution');expect(result.answer_version).toBeGreaterThan(1);
    await page.screenshot({path:testInfo.outputPath('php-syntax-error.png'),fullPage:true});
  });
  await testInfo.attach('real-runtime-results.json',{body:Buffer.from(JSON.stringify({assessment,attempt,evidence},null,2)),contentType:'application/json'});
});

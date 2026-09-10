import {expect,request,test,type Page} from '@playwright/test';
import {TEST_ORIGIN} from './test-origin';

const origin=TEST_ORIGIN;
const university='/api/universities/10000000-0000-4000-8000-000000000001';
const sami='20000000-0000-4000-8000-000000000007';
const webOffering='60000000-0000-4000-8000-000000000007';
type Project={format:'uniexam-web-v1';files:{'index.html':string;'style.css':string;'script.js':string}};
type Attempt={
  attempt:{deadline:string;status:string};
  questions:{id:string;runtime:string;title:string}[];
  answers:{question_id:string;answer_text:string;version:number}[];
};

function examCard(page:Page,title:string){
  return page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
}

test('editor controls preserve typing, undo and saved files through expansion, mobile layout and submission',async({page},testInfo)=>{
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const teacher=await request.newContext({baseURL:origin,extraHTTPHeaders:{origin}});
  try{
    expect((await teacher.post('/api/auth/demo',{data:{user_id:sami}})).ok()).toBeTruthy();
    const title=`Web · commandes de l’éditeur ${Date.now()}`;
    const statement='Écrivez votre script, vérifiez ses fichiers et conservez vos réponses en changeant de question.';
    const starter:Project={format:'uniexam-web-v1',files:{
      'index.html':'<main><h1>Commandes de l’éditeur</h1></main>',
      'style.css':'main { padding: 16px; }',
      'script.js':'// Atelier des commandes\n',
    }};
    // A fresh assessment keeps demo access codes and already submitted attempts untouched.
    const creation=await teacher.post(`${university}/assessments`,{data:{
      title,description:'Devoir isolé du test des commandes de l’éditeur.',
      course_offering_id:webOffering,kind:'PRACTICAL',
      opens_at:new Date(Date.now()-60000).toISOString(),
      closes_at:new Date(Date.now()+3600000).toISOString(),
      duration_minutes:30,requires_code:false,allow_paste:false,
      questions:[
        {type:'CODE',runtime:'web',title:'Projet Web des commandes',statement,points:15,starter_code:JSON.stringify(starter)},
        {type:'CODE',runtime:'php',title:'Vérification PHP',statement:'Affichez un message de vérification en PHP.',points:5,starter_code:'<?php\n// Seconde question\n'},
      ],
    }});
    expect(creation.ok()).toBeTruthy();
    const assessment=(await creation.json()).id;
    expect((await teacher.post(`${university}/assessments/${assessment}/publish`,{data:{}})).ok()).toBeTruthy();

    await page.goto('/');
    await page.getByRole('button',{name:/Lina Ben Salem/}).click();
    await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
    await examCard(page,title).getByRole('button',{name:'Ouvrir mon devoir',exact:true}).click();
    await page.getByRole('button',{name:'Commencer le devoir',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Code index.html',exact:true})).toBeVisible();
    const attemptId=new URL(page.url()).searchParams.get('attempt');
    expect(attemptId).toBeTruthy();
    const attemptPath=`${university}/attempts/${attemptId}`;
    const readAttempt=async():Promise<Attempt>=>{
      const response=await page.request.get(attemptPath);
      expect(response.ok()).toBeTruthy();
      return response.json();
    };
    const before=await readAttempt();
    const questionId=before.questions.find(question=>question.runtime==='web')!.id;
    const savedProject=async()=>{
      const answer=(await readAttempt()).answers.find(answer=>answer.question_id===questionId);
      return answer?JSON.parse(answer.answer_text) as Project:undefined;
    };
    const expectSaved=async(source:string)=>{
      await expect.poll(async()=>(await savedProject())?.files['script.js'],{message:'Le serveur conserve exactement le script saisi'}).toBe(source);
      await expect(page.locator('.exam-person [role="status"]')).toHaveText('Enregistré');
    };

    await page.getByRole('tab',{name:'script.js',exact:true}).click();
    const editor=page.getByRole('textbox',{name:'Code script.js',exact:true});
    await expect(editor).toBeVisible();
    const monaco=page.locator('.monaco-host .monaco-editor').first();
    const monacoNode=await monaco.elementHandle();
    const textareaNode=await editor.elementHandle();
    expect(monacoNode).toBeTruthy();expect(textareaNode).toBeTruthy();
    const expectSameEditor=async()=>{
      expect(await monaco.evaluate((node,previous)=>node===previous,monacoNode)).toBe(true);
      expect(await editor.evaluate((node,previous)=>node===previous,textareaNode)).toBe(true);
    };
    const normalWidth=(await monaco.boundingBox())!.width;
    const sourceBefore=starter.files['script.js']+'const avant = 1;';
    const sourceAfter=sourceBefore+'\nconst apres = 2;';
    await editor.press('Control+End');
    // Exercise rapid real keystrokes without clipboard permission or a paste shortcut.
    await editor.pressSequentially('const avant = 1;',{delay:10});
    await expectSaved(sourceBefore);

    await page.getByRole('button',{name:'Agrandir l’éditeur',exact:true}).click();
    await expect(page.getByRole('button',{name:'Réduire l’éditeur',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.question-panel')).toBeHidden();
    await expect.poll(async()=>(await monaco.boundingBox())!.width,{message:'Le mode agrandi gagne une largeur réelle'}).toBeGreaterThan(normalWidth+100);
    await expectSameEditor();
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('const avant = 1;');
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.pressSequentially('const apres = 2;',{delay:10});
    await expectSaved(sourceAfter);

    await page.getByRole('button',{name:'Augmenter la taille du texte',exact:true}).click();
    await expect(page.locator('.editor-font-size output')).toHaveText('16 px');
    await expect(page.locator('.monaco-editor .view-lines')).toHaveCSS('font-size','16px');
    await expectSameEditor();
    await expect(page.locator('.code-terminal')).toBeVisible();
    await page.getByRole('button',{name:'Masquer la console',exact:true}).click();
    await expect(page.locator('.code-terminal')).toBeHidden();
    await expect(page.getByRole('button',{name:'Afficher la console',exact:true})).toHaveAttribute('aria-expanded','false');
    await page.getByRole('button',{name:'Afficher la console',exact:true}).click();
    await expect(page.locator('.code-terminal')).toBeVisible();
    await expectSameEditor();

    await page.getByRole('button',{name:'Réduire l’éditeur',exact:true}).click();
    await expect(page.getByRole('button',{name:'Agrandir l’éditeur',exact:true})).toHaveAttribute('aria-pressed','false');
    await expect.poll(async()=>(await monaco.boundingBox())!.width).toBeLessThan(normalWidth+5);
    await expectSameEditor();
    // Monaco groups insertion at token boundaries. Walk a bounded number of undo
    // operations to the earlier saved revision instead of assuming one atomic edit.
    let undoOperations=0,undoneSource=sourceAfter;
    while(undoneSource!==sourceBefore&&undoOperations<12){
      const previousSource=undoneSource;
      await editor.press('Control+z');
      undoOperations++;
      await expect.poll(async()=>(await savedProject())?.files['script.js'],{message:'L’historique annule effectivement la saisie après redimensionnement'}).not.toBe(previousSource);
      undoneSource=(await savedProject())!.files['script.js'];
    }
    await expectSaved(sourceBefore);
    for(let i=0;i<undoOperations;i++)await editor.press('Control+y');
    await expectSaved(sourceAfter);
    await expectSameEditor();

    await page.getByRole('button',{name:'Plein écran',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('exam-workspace')??false),{message:'Le navigateur place réellement la copie en plein écran'}).toBe(true);
    await expect(page.getByRole('button',{name:'Quitter le plein écran',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.exam-clock')).toBeVisible();
    await expectSameEditor();
    await page.screenshot({path:testInfo.outputPath('editor-controls-fullscreen.png'),fullPage:true});
    await page.getByRole('button',{name:'Quitter le plein écran',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
    await expectSameEditor();

    await expect(page.getByRole('button',{name:'Réduire l’éditeur',exact:true})).toBeVisible();
    await page.locator('.expanded-question-context summary').click();
    await expect(page.locator('.expanded-question-context details')).toHaveAttribute('open','');
    await expect(page.locator('.expanded-question-context')).toContainText(statement);
    const currentQuestion=page.getByRole('combobox',{name:'Question en cours',exact:true});
    await currentQuestion.selectOption('1');
    await expect(page.getByRole('textbox',{name:'Code PHP',exact:true})).toBeVisible();
    await expect(currentQuestion).toHaveValue('1');
    await page.locator('.expanded-question-context summary').click();
    await expect(page.locator('.expanded-question-context')).toContainText('Affichez un message de vérification en PHP.');
    await currentQuestion.selectOption('0');
    await expect(page.getByRole('textbox',{name:'Code index.html',exact:true})).toBeVisible();
    await page.getByRole('tab',{name:'script.js',exact:true}).click();
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('const apres = 2;');
    await editor.press('Escape');
    await expect(page.getByRole('button',{name:'Agrandir l’éditeur',exact:true})).toBeVisible();
    await expect(page.locator('.question-panel')).toBeVisible();
    await expectSaved(sourceAfter);

    const expected:Project={...starter,files:{...starter.files,'script.js':sourceAfter}};
    expect(await savedProject()).toEqual(expected);
    await page.reload();
    await expect(page.getByRole('textbox',{name:'Code index.html',exact:true})).toBeVisible();
    expect((await readAttempt()).attempt.deadline).toBe(before.attempt.deadline);
    expect(await savedProject()).toEqual(expected);
    await page.getByRole('tab',{name:'script.js',exact:true}).click();
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('const avant = 1;');
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('const apres = 2;');
    const reloadedMonacoNode=await monaco.elementHandle();

    await page.setViewportSize({width:390,height:844});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'Pas de débordement horizontal sur mobile'}).toBeLessThanOrEqual(1);
    await page.getByRole('button',{name:'Agrandir l’éditeur',exact:true}).click();
    await expect(page.getByRole('button',{name:'Réduire l’éditeur',exact:true})).toBeVisible();
    await expect(currentQuestion).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'Le mode agrandi reste dans la largeur du mobile'}).toBeLessThanOrEqual(1);
    await page.getByRole('button',{name:'Ouvrir l’aperçu',exact:true}).click();
    const preview=page.frameLocator('iframe[title="Aperçu du projet web"]');
    await expect(preview.getByRole('heading',{name:'Commandes de l’éditeur',exact:true})).toBeVisible();
    await expect(preview.locator('main')).toHaveCSS('padding','16px');
    // Playwright's visible-text matcher deliberately skips script contents.
    await expect.poll(()=>preview.locator('script').last().textContent()).toBe(sourceAfter);
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('const apres = 2;');
    await page.locator('.code-terminal').scrollIntoViewIfNeeded();
    await expect(page.locator('.code-terminal')).toBeInViewport();
    await page.locator('.code-status').scrollIntoViewIfNeeded();
    await expect(page.locator('.code-status')).toBeInViewport();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'L’aperçu Web ne provoque aucun débordement horizontal sur mobile'}).toBeLessThanOrEqual(1);
    await page.screenshot({path:testInfo.outputPath('editor-controls-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Fermer l’aperçu',exact:true}).click();
    await page.setViewportSize({width:1440,height:1000});
    expect(await monaco.evaluate((node,previous)=>node===previous,reloadedMonacoNode)).toBe(true);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:testInfo.outputPath('editor-controls-expanded.png'),fullPage:true});

    await page.getByRole('button',{name:'Remettre ma copie',exact:true}).click();
    await page.getByRole('button',{name:'Confirmer la remise',exact:true}).click();
    await expect(page.getByText('Votre copie a bien été remise.',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Réduire l’éditeur',exact:true})).toBeVisible();
    await expect(page.locator('.coding-shell .editor-readonly')).toContainText('Cette copie a été remise.');
    await expect(page.locator('.coding-shell .editor-readonly')).toContainText('ouvrez un devoir encore actif');
    await expect(page.getByRole('button',{name:'Ouvrir un autre devoir',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Remettre ma copie',exact:true})).toBeDisabled();
    await editor.press('Control+End');
    await page.keyboard.insertText('\nMODIFICATION_APRES_REMISE');
    await expect(page.locator('.monaco-editor .view-lines')).not.toContainText('MODIFICATION_APRES_REMISE');
    const submitted=await readAttempt();
    expect(submitted.attempt.status).toBe('SUBMITTED');
    expect(await savedProject()).toEqual(expected);
    const answer=submitted.answers.find(answer=>answer.question_id===questionId)!;
    const denied=await page.request.put(`${attemptPath}/answers/${questionId}`,{headers:{origin},data:{answer_text:JSON.stringify(starter),expected_version:answer.version}});
    expect(denied.status()).toBe(410);
    await page.getByRole('button',{name:'Ouvrir un autre devoir',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
  }finally{
    await teacher.dispose();
  }
});

import {test,expect,request,type Page} from '@playwright/test';

import { TEST_ORIGIN } from './test-origin';
const origin=TEST_ORIGIN;
const university='/api/universities/10000000-0000-4000-8000-000000000001';
const sami='20000000-0000-4000-8000-000000000007';
const webOffering='60000000-0000-4000-8000-000000000007';
const phpOffering='60000000-0000-4000-8000-000000000005';
type Project={format:'uniexam-web-v1';files:{'index.html':string;'style.css':string;'script.js':string}};
type Attempt={attempt:{deadline:string;status:string};answers:{question_id:string;answer_text:string;version:number}[]};

function examCard(page:Page,title:string){return page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});}
test.beforeEach(({page})=>{page.setDefaultTimeout(15000);});

test('teacher studio: default exams page, three-step PHP/Web builder, publication and honest email state',async({page})=>{
  test.setTimeout(90000);
  const title=`Atelier PHP et Web · navigateur ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button',{name:/Sami Haddad/}).click();
  await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Devoirs & examens',exact:true})).toHaveAttribute('aria-current','page');
  await page.getByRole('button',{name:'Créer un devoir',exact:true}).click();
  await expect(page.locator('.builder-steps li.current')).toHaveText('1Classe & horaires');
  await page.getByRole('combobox',{name:'Classe du devoir',exact:true}).selectOption('40000000-0000-4000-8000-000000000003');
  await page.getByRole('combobox',{name:'Enseignement',exact:true}).selectOption(phpOffering);
  await page.getByRole('textbox',{name:'Titre du devoir',exact:true}).fill(title);
  await page.getByRole('textbox',{name:'Consignes générales',exact:true}).fill('Créez un calcul en PHP et une petite page interactive.');
  await page.getByRole('combobox',{name:'Type de devoir',exact:true}).selectOption('PRACTICAL');
  await page.getByRole('spinbutton',{name:'Durée en minutes',exact:true}).fill('45');
  await page.getByRole('button',{name:'Continuer',exact:true}).click();

  const php=page.getByRole('group',{name:'Question 1',exact:true});
  await php.getByRole('combobox',{name:'Format',exact:true}).selectOption('CODE');
  await php.getByRole('combobox',{name:'Langage de programmation',exact:true}).selectOption('php');
  await php.getByRole('textbox',{name:'Titre de la question',exact:true}).fill('Total du panier PHP');
  await php.getByRole('textbox',{name:'Énoncé',exact:true}).fill('Calculez la somme des prix et affichez le total du panier.');
  await expect(php.getByRole('textbox',{name:'Code initial · main.php',exact:true})).toHaveValue(/<\?php/);
  await page.getByRole('button',{name:'Ajouter une question',exact:true}).click();
  const web=page.getByRole('group',{name:'Question 2',exact:true});
  await web.getByRole('combobox',{name:'Langage de programmation',exact:true}).selectOption('web');
  await web.getByRole('textbox',{name:'Titre de la question',exact:true}).fill('Interface de commande Web');
  await web.getByRole('textbox',{name:'Énoncé',exact:true}).fill('Créez une page HTML, CSS et JavaScript qui affiche la commande.');
  for(const file of ['index.html','style.css','script.js'])await expect(web.getByRole('textbox',{name:`Code initial · ${file}`,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Continuer',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Votre devoir est prêt à être enregistré',exact:true})).toBeVisible();
  await expect(page.locator('.builder-question-summary')).toHaveCount(2);
  await expect(page.locator('.builder-question-summary').first()).toContainText('PHP');
  await expect(page.locator('.builder-question-summary').last()).toContainText('HTML / CSS / JavaScript');
  const createdResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`${university}/assessments`));
  await page.getByRole('button',{name:'Enregistrer le brouillon',exact:true}).click();
  const created=await createdResponse;expect(created.ok()).toBeTruthy();const {id}=await created.json();
  const card=examCard(page,title);await expect(card).toContainText('Brouillon');
  await card.getByRole('button',{name:'Publier',exact:true}).click();
  await page.getByRole('button',{name:'Confirmer la publication',exact:true}).click();
  const modal=page.getByRole('dialog');
  await expect(modal.getByRole('heading',{name:'Devoir publié · codes personnels',exact:true})).toBeVisible();
  await expect(modal).toContainText('Lina Ben Salem');
  await expect(modal).toContainText('lina@uniexam.example');
  await expect(modal.locator('.access-code-row code')).toHaveText(/[A-F0-9-]{20,}/);
  await modal.getByRole('button',{name:'Fermer',exact:true}).click();
  await card.getByRole('button',{name:'Inviter les étudiants',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Configurer un domaine email vérifié');
  await expect(page.getByRole('button',{name:'Envoyer les invitations',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Sélectionner les étudiants disponibles',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('checkbox').first()).toBeChecked();
  await page.getByRole('textbox',{name:'Ou saisir les emails des étudiants de cette classe',exact:true}).fill('lina@uniexam.example');
  await expect(page.getByRole('button',{name:'Envoyer les invitations',exact:true})).toBeDisabled();
  // Persisted server data, not just the builder's summary.
  const saved=await (await page.request.get(`${university}/assessments/${id}`)).json();
  expect(saved.publication_status).toBe('PUBLISHED');expect(saved.duration_minutes).toBe(45);
  expect(saved.questions.map((q:{runtime:string})=>q.runtime)).toEqual(['php','web']);
  const recipients=await (await page.request.get(`${university}/assessments/${id}/recipients`)).json();
  expect(recipients.email_available).toBe(false);expect(recipients.data.every((r:{email_status:string|null})=>r.email_status===null)).toBeTruthy();
  await page.screenshot({path:'test-results/teacher-php-web-invitations.png',fullPage:true});
});

test('student Web workspace: three files, working preview, isolated origin, autosave, reload and immutable submission',async({page})=>{
  test.setTimeout(120000);
  const teacher=await request.newContext({baseURL:origin,extraHTTPHeaders:{origin}});
  try{
    expect((await teacher.post('/api/auth/demo',{data:{user_id:sami}})).ok()).toBeTruthy();
    const title=`Web · atelier isolé navigateur ${Date.now()}`;
    const starter:Project={format:'uniexam-web-v1',files:{'index.html':'','style.css':'','script.js':''}};
    const creation=await teacher.post(`${university}/assessments`,{data:{title,description:'Devoir créé uniquement pour ce parcours automatisé.',course_offering_id:webOffering,kind:'PRACTICAL',opens_at:new Date(Date.now()-60000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:30,requires_code:false,allow_paste:false,questions:[{type:'CODE',runtime:'web',title:'Compteur de tâches',statement:'Créez et testez un compteur dans les trois fichiers du projet.',points:20,starter_code:JSON.stringify(starter)}]}});
    expect(creation.ok()).toBeTruthy();const assessment=(await creation.json()).id;
    expect((await teacher.post(`${university}/assessments/${assessment}/publish`,{data:{}})).ok()).toBeTruthy();
    await page.goto('/');await page.getByRole('button',{name:/Lina Ben Salem/}).click();
    await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
    await examCard(page,title).getByRole('button',{name:'Ouvrir mon devoir',exact:true}).click();
    await page.getByRole('button',{name:'Commencer le devoir',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Code index.html',exact:true})).toBeVisible();
    await expect(page.getByRole('tablist',{name:'Fichiers du projet'}).getByRole('tab')).toHaveCount(3);
    await expect(page.getByRole('region',{name:'Enregistrement d’écran'})).toContainText('Aucun écran n’est capturé');
    const attempt=new URL(page.url()).searchParams.get('attempt');expect(attempt).toBeTruthy();
    const attemptPath=`${university}/attempts/${attempt}`;
    const readAttempt=async():Promise<Attempt>=>{const response=await page.request.get(attemptPath);expect(response.ok()).toBeTruthy();return response.json();};
    const before=await readAttempt();
    const blockedFormUrl=`${origin}/api/auth/me?e2e_blocked_form=${assessment}`;
    const formRequests:string[]=[];
    page.on('request',outgoing=>{if(outgoing.url()===blockedFormUrl)formRequests.push(outgoing.url());});
    const project:Project={format:'uniexam-web-v1',files:{
      'index.html':`<main><h1>Mon compteur de tâches</h1><form id="counter-form"><input aria-label="Tâche à ajouter" value="Réviser PHP" required><button type="submit">Ajouter une tâche</button></form><output id="count">0</output><p id="boundary"></p><p id="network"></p><form action="${blockedFormUrl}" method="post"><button type="submit">Tester le blocage d’envoi</button></form><p id="form-boundary"></p></main>`,
      'style.css':'body { font-family: system-ui; padding: 24px; background: #f0faf5; } h1 { color: rgb(0, 90, 65); } button { padding: 12px; } output { display: block; font-size: 32px; }',
      'script.js':`let count = 0;
document.getElementById('counter-form').addEventListener('submit', event => {
  event.preventDefault();
  count += 1;
  document.getElementById('count').textContent = String(count);
});
try {
  void parent.document.body;
  document.getElementById('boundary').textContent = 'PARENT_ACCESSIBLE';
} catch {
  document.getElementById('boundary').textContent = 'Parent protégé';
}
document.addEventListener('securitypolicyviolation', event => {
  if (event.effectiveDirective === 'connect-src') {
    document.getElementById('network').textContent = 'Réseau bloqué par CSP';
  }
  if (event.effectiveDirective === 'form-action') {
    document.getElementById('form-boundary').textContent = 'Envoi du formulaire bloqué par CSP';
  }
});
fetch('${origin}/api/auth/me').catch(() => {});`.replace(/\n\s*/g,' '),
    }};
    for(const file of Object.keys(project.files) as (keyof Project['files'])[]){
      await page.getByRole('tab',{name:file,exact:true}).click();
      const editor=page.getByRole('textbox',{name:`Code ${file}`,exact:true});await expect(editor).toBeVisible();
      await editor.press('Control+A');await page.keyboard.insertText(project.files[file]);
      await expect.poll(async()=>{const saved=await readAttempt();return saved.answers[0]?JSON.parse(saved.answers[0].answer_text).files[file]:null;},{message:`Autosave réel de ${file}`}).toBe(project.files[file]);
      await expect(page.locator('.exam-person [role="status"]')).toHaveText('Enregistré');
    }
    await page.getByRole('button',{name:'Ouvrir l’aperçu',exact:true}).click();
    const preview=page.frameLocator('iframe[title="Aperçu du projet web"]');
    await expect(page.locator('iframe[title="Aperçu du projet web"]')).toHaveAttribute('sandbox','allow-scripts allow-forms');
    await expect(preview.getByRole('heading',{name:'Mon compteur de tâches'})).toHaveCSS('color','rgb(0, 90, 65)');
    await preview.getByRole('button',{name:'Ajouter une tâche',exact:true}).click();
    await preview.getByRole('button',{name:'Ajouter une tâche',exact:true}).click();
    await expect(preview.locator('#count')).toHaveText('2');
    await expect(preview.locator('#boundary')).toHaveText('Parent protégé');
    await expect(preview.locator('#network')).toHaveText('Réseau bloqué par CSP');
    await expect(preview.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content',/connect-src 'none'/);
    await expect(preview.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content',/form-action 'none'/);
    await preview.getByRole('button',{name:'Tester le blocage d’envoi',exact:true}).click();
    await expect(preview.locator('#form-boundary')).toHaveText('Envoi du formulaire bloqué par CSP');
    expect(formRequests).toEqual([]);
    await expect(preview.getByRole('heading',{name:'Mon compteur de tâches'})).toBeVisible();
    await page.screenshot({path:'test-results/web-editor-live-preview.png',fullPage:true});

    await page.reload();await expect(page.getByRole('textbox',{name:'Code index.html',exact:true})).toBeVisible();
    const reloaded=await readAttempt();expect(reloaded.attempt.deadline).toBe(before.attempt.deadline);expect(JSON.parse(reloaded.answers[0].answer_text)).toEqual(project);
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('Mon compteur de tâches');
    await page.getByRole('tab',{name:'style.css',exact:true}).click();await expect(page.locator('.monaco-editor .view-lines')).toContainText('rgb(0, 90, 65)');
    await page.getByRole('tab',{name:'script.js',exact:true}).click();await expect(page.locator('.monaco-editor .view-lines')).toContainText('let count = 0;');
    await page.getByRole('button',{name:'Ouvrir l’aperçu',exact:true}).click();
    await expect(preview.locator('#count')).toHaveText('0');await preview.getByRole('button',{name:'Ajouter une tâche',exact:true}).click();await expect(preview.locator('#count')).toHaveText('1');
    await page.getByRole('button',{name:'Remettre ma copie',exact:true}).click();await page.getByRole('button',{name:'Confirmer la remise',exact:true}).click();
    await expect(page.getByText('Votre copie a bien été remise.',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Remettre ma copie',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Enregistrer maintenant',exact:true})).toBeDisabled();
    const locked=page.getByRole('textbox',{name:'Code script.js',exact:true});
    await locked.press('Control+End');await page.keyboard.insertText('\nSHOULD_NOT_BE_SAVED');
    const final=await readAttempt();expect(final.attempt.status).toBe('SUBMITTED');expect(JSON.parse(final.answers[0].answer_text)).toEqual(project);
    await expect(page.locator('.monaco-editor .view-lines')).not.toContainText('SHOULD_NOT_BE_SAVED');
    const denied=await page.request.put(`${attemptPath}/answers/${final.answers[0].question_id}`,{headers:{origin},data:{answer_text:JSON.stringify(starter),expected_version:final.answers[0].version}});expect(denied.status()).toBe(410);
    const submissions=await (await teacher.get(`${university}/assessments/${assessment}/submissions`)).json();expect(submissions.data).toHaveLength(1);expect(submissions.data[0].student_name).toBe('Lina Ben Salem');
    const copy=await (await teacher.get(`${university}/assessments/${assessment}/submissions/${submissions.data[0].id}`)).json();expect(JSON.parse(copy.answers[0].answer_text)).toEqual(project);
  }finally{await teacher.dispose();}
});

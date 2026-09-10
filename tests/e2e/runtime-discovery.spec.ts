import {test,expect} from '@playwright/test';

const university='/api/universities/10000000-0000-4000-8000-000000000001';
const requested=[
  ['python','Python','main.py'],['csharp','C#','Main.cs'],
  ['react','React','App.tsx'],['angular','Angular','app.component.ts'],
  ['symfony','Symfony','src/Controller/ExamController.php'],
  ['laravel','Laravel','routes/web.php'],['mysql','MySQL','query.sql'],
  ['oracle_plsql','Oracle · PL/SQL','main.sql'],
] as const;

test('all requested environments are discoverable before creating a draft, including on mobile',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');await page.getByRole('button',{name:/Sami Haddad/}).click();
  const catalog=page.getByRole('region',{name:'Créer un devoir de programmation',exact:true});
  await expect(catalog).toBeVisible();await expect(catalog.getByRole('button')).toHaveCount(20);
  const before=await (await page.request.get(`${university}/assessments`)).json();
  await expect(catalog.getByRole('button',{name:'Créer un devoir Oracle · PL/SQL',exact:true})).toContainText('Édition seule');
  for(const [runtime,label,file] of requested){
    await catalog.getByRole('button',{name:`Créer un devoir ${label}`,exact:true}).click();
    await expect(page.getByRole('combobox',{name:'Langage du premier exercice',exact:true})).toHaveValue(runtime);
    await page.getByRole('textbox',{name:'Titre du devoir',exact:true}).fill(`Découverte ${label}`);
    await page.getByRole('button',{name:'Continuer',exact:true}).click();
    await expect(page.getByRole('combobox',{name:'Langage de programmation',exact:true})).toHaveValue(runtime);
    await expect(page.getByRole('textbox',{name:`Code initial · ${file}`,exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Retour aux devoirs',exact:true}).click();
  }
  const after=await (await page.request.get(`${university}/assessments`)).json();
  expect(after.data.map((a:{id:string})=>a.id).sort()).toEqual(before.data.map((a:{id:string})=>a.id).sort());
  await page.setViewportSize({width:390,height:844});
  await expect(catalog.getByRole('button',{name:'Créer un devoir Python',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await catalog.getByRole('button',{name:'Créer un devoir MySQL',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Langage du premier exercice',exact:true})).toHaveValue('mysql');
  await page.getByRole('button',{name:'Retour aux devoirs',exact:true}).click();
  await catalog.scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/runtime-catalog-mobile.png'});
});

test('first-step language persists independently from the course and keeps customized code',async({page})=>{
  test.setTimeout(90000);
  await page.goto('/');await page.getByRole('button',{name:/Sami Haddad/}).click();
  await page.getByRole('button',{name:'Créer un devoir',exact:true}).click();
  await page.getByRole('combobox',{name:'Langage du premier exercice',exact:true}).selectOption('react');
  await page.getByRole('combobox',{name:'Enseignement',exact:true}).selectOption('60000000-0000-4000-8000-000000000005');
  const title=`React dans une matière PHP ${Date.now()}`;
  await page.getByRole('textbox',{name:'Titre du devoir',exact:true}).fill(title);
  await page.getByRole('button',{name:'Continuer',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Langage de programmation',exact:true})).toHaveValue('react');
  const source='export default function App() { return <h1>Mon exercice React conservé</h1>; }';
  await page.getByRole('textbox',{name:'Code initial · App.tsx',exact:true}).fill(source);
  await page.getByRole('textbox',{name:'Titre de la question',exact:true}).fill('Créer un composant React');
  await page.getByRole('textbox',{name:'Énoncé',exact:true}).fill('Affichez votre prénom dans un composant React.');
  await page.getByRole('button',{name:'Précédent',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Langage du premier exercice',exact:true})).toHaveValue('react');
  await expect(page.getByRole('combobox',{name:'Langage du premier exercice',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Continuer',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Code initial · App.tsx',exact:true})).toHaveValue(source);
  await page.getByRole('button',{name:'Continuer',exact:true}).click();
  const createdResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`${university}/assessments`));
  await page.getByRole('button',{name:'Enregistrer le brouillon',exact:true}).click();
  const created=await createdResponse;expect(created.ok()).toBeTruthy();const {id}=await created.json();
  const saved=await (await page.request.get(`${university}/assessments/${id}`)).json();
  expect(saved.course_offering_id).toBe('60000000-0000-4000-8000-000000000005');
  expect(saved.questions[0].runtime).toBe('react');
  expect(JSON.parse(saved.questions[0].starter_code).files['App.tsx']).toBe(source);
  await page.reload();
  await page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Modifier',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Langage du premier exercice',exact:true})).toHaveValue('react');
  // Student accounts still only receive exams published for their own class.
  await page.context().clearCookies();await page.goto('/');await page.getByRole('button',{name:/Lina Ben Salem/}).click();
  await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Créer un devoir de programmation',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:title,exact:true})).toHaveCount(0);
});

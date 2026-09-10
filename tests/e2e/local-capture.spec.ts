import {test,expect,request,type Page} from '@playwright/test';
import {stat} from 'node:fs/promises';
import {TEST_ORIGIN} from './test-origin';
const origin=TEST_ORIGIN,u='/api/universities/10000000-0000-4000-8000-000000000001';
type Probe={calls:number;dataEvents:number;mode:'allow'|'deny'|'pending';constraints:DisplayMediaStreamOptions[];streams:MediaStream[];recorders:MediaRecorder[];resolvePending?:()=>void;rejectPending?:()=>void};

async function syntheticCapture(page:Page){
  // Only getDisplayMedia is substituted. Chrome's native MediaRecorder encodes a
  // generated canvas, so these tests never request or capture the user's screen.
  await page.addInitScript(()=>{
    const probe={calls:0,dataEvents:0,mode:'allow',constraints:[],streams:[],recorders:[]} as Probe;
    (window as typeof window&{captureProbe:Probe}).captureProbe=probe;
    function makeStream(){
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const context=canvas.getContext('2d')!;let frame=0;
      function paint(){context.fillStyle='#173e30';context.fillRect(0,0,640,360);context.fillStyle='#cef0da';context.font='28px sans-serif';context.fillText('Flux de test synthétique',35,70);context.fillStyle='#77c697';context.fillRect((frame++*4)%520,150,90,90);}
      paint();const stream=canvas.captureStream(10);probe.streams.push(stream);
      const draw=setInterval(()=>{if(stream.getTracks().every(track=>track.readyState==='ended'))clearInterval(draw);else paint();},80);
      return stream;
    }
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async(options:DisplayMediaStreamOptions)=>{
      probe.calls++;probe.constraints.push(options);
      if(probe.mode==='deny')throw new DOMException('Refus synthétique','NotAllowedError');
      if(probe.mode==='pending')return new Promise<MediaStream>((resolve,reject)=>{probe.resolvePending=()=>resolve(makeStream());probe.rejectPending=()=>reject(new DOMException('Refus tardif synthétique','NotAllowedError'));});
      return makeStream();
    }});
    const NativeRecorder=window.MediaRecorder;
    window.MediaRecorder=class extends NativeRecorder{constructor(stream:MediaStream,options?:MediaRecorderOptions){super(stream,options);probe.recorders.push(this);this.addEventListener('dataavailable',event=>{if(event.data.size)probe.dataEvents++;});}};
  });
}
async function activeAttempt(page:Page){
  const teacher=await request.newContext({baseURL:origin,extraHTTPHeaders:{origin}});
  try{
    expect((await teacher.post('/api/auth/demo',{data:{user_id:'20000000-0000-4000-8000-000000000007'}})).ok()).toBeTruthy();
    const creation=await teacher.post(`${u}/assessments`,{data:{title:`Capture locale · test ${Date.now()}`,description:'Tentative propre au test navigateur.',course_offering_id:'60000000-0000-4000-8000-000000000005',kind:'PRACTICAL',opens_at:new Date(Date.now()-60000).toISOString(),closes_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:30,requires_code:false,allow_paste:false,questions:[{type:'CODE',runtime:'php',title:'Code et capture locale',statement:'Écrivez un petit programme PHP.',points:20,starter_code:'<?php\necho "Bonjour";'}]}});
    expect(creation.ok()).toBeTruthy();const assessment=(await creation.json()).id;
    expect((await teacher.post(`${u}/assessments/${assessment}/publish`,{data:{}})).ok()).toBeTruthy();
    expect((await page.request.post('/api/auth/demo',{headers:{origin},data:{user_id:'20000000-0000-4000-8000-000000000008'}})).ok()).toBeTruthy();
    const started=await page.request.post(`${u}/assessments/${assessment}/attempts`,{headers:{origin},data:{}});expect(started.ok()).toBeTruthy();const {id}=await started.json();
    await page.goto(`/?view=exams&attempt=${id}`);await expect(page.getByRole('heading',{name:/Capture locale · test/})).toBeVisible();
    await expect(page.getByRole('button',{name:'Tester la capture sur cet appareil',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Tester la capture sur cet appareil',exact:true}).click();
    return {id,path:`${u}/attempts/${id}`};
  }finally{await teacher.dispose();}
}
const local=(page:Page)=>page.getByRole('region',{name:'Test de capture locale',exact:true});
async function consentAndStart(page:Page){await local(page).getByRole('checkbox').check();await local(page).getByRole('button',{name:'Choisir un écran et démarrer le test',exact:true}).click();}
async function streamsEnded(page:Page){return page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));}
test.beforeEach(async({page})=>{page.setDefaultTimeout(15000);await syntheticCapture(page);});

test('local capture uses real MediaRecorder, previews and downloads without a cloud upload',async({page},testInfo)=>{
  const writes:string[]=[];page.on('request',outgoing=>{if(['POST','PUT','PATCH'].includes(outgoing.method())&&(/\/recording(?:s|\/)/.test(outgoing.url())||outgoing.url().includes('/storage/v1/')))writes.push(outgoing.url());});
  const attempt=await activeAttempt(page);
  await expect(local(page)).toContainText('Il n’est envoyé ni au serveur ni à votre enseignant');
  await expect(local(page).getByRole('button',{name:'Choisir un écran et démarrer le test',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.calls)).toBe(0);
  await consentAndStart(page);
  await expect(local(page).getByRole('status')).toContainText('Capture locale en cours');
  await expect.poll(()=>page.locator('video[aria-label="Aperçu de la capture locale en direct"]').evaluate((video:HTMLVideoElement)=>video.videoWidth)).toBe(640);
  const options=await page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.constraints);expect(options).toHaveLength(1);expect(options[0].audio).toBe(false);
  await page.getByRole('button',{name:'Mes devoirs',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Arrêtez la capture'})).toBeVisible();expect(new URL(page.url()).searchParams.get('attempt')).toBe(attempt.id);
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.dataEvents)).toBeGreaterThan(0);
  await local(page).getByRole('button',{name:'Arrêter le test local',exact:true}).click();
  await expect(local(page).getByRole('status')).toHaveText('Capture locale arrêtée');
  await expect.poll(()=>streamsEnded(page)).toBe(true);
  const video=page.locator('video[aria-label="Vidéo de test locale"]');
  await video.evaluate((node:HTMLVideoElement)=>{void node.play().catch(()=>{});});
  await expect.poll(()=>video.evaluate((node:HTMLVideoElement)=>node.readyState>=2&&node.videoWidth===640)).toBe(true);
  await expect.poll(()=>video.evaluate((node:HTMLVideoElement)=>node.currentTime)).toBeGreaterThan(0);
  const downloaded=page.waitForEvent('download');await local(page).getByRole('link',{name:'Télécharger la vidéo locale',exact:true}).click();
  const download=await downloaded,output=testInfo.outputPath('capture-canvas-synthetique.webm');await download.saveAs(output);const metadata=await stat(output);expect(metadata.size).toBeGreaterThan(0);expect(metadata.size).toBeLessThanOrEqual(8*1024*1024);
  const recordings=await (await page.request.get(`${attempt.path}/recording`)).json();expect(recordings.sessions).toEqual([]);expect(writes).toEqual([]);
  const url=await video.getAttribute('src');await page.screenshot({path:testInfo.outputPath('capture-locale-preview.png'),fullPage:true});
  await local(page).getByRole('button',{name:'Supprimer la vidéo locale',exact:true}).click();await expect(video).toHaveCount(0);
  expect(await page.evaluate(async source=>{try{await fetch(source!);return true;}catch{return false;}},url)).toBe(false);
  await page.getByRole('button',{name:'Mes devoirs',exact:true}).click();await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
});

test('local capture ignores a stale denial and preserves the video when the attempt closes',async({page})=>{
  const attempt=await activeAttempt(page);
  await page.evaluate(()=>{(window as typeof window&{captureProbe:Probe}).captureProbe.mode='deny';});
  await consentAndStart(page);await expect(local(page).getByRole('alert')).toContainText('Le partage a été refusé ou annulé');
  expect(await page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.recorders.length)).toBe(0);
  await page.evaluate(()=>{(window as typeof window&{captureProbe:Probe}).captureProbe.mode='pending';});
  await local(page).getByRole('button',{name:'Choisir un écran et démarrer le test',exact:true}).click();await expect(local(page).getByRole('status')).toContainText('Choix de l’écran');
  await local(page).getByRole('button',{name:'Annuler la demande',exact:true}).click();
  await page.evaluate(()=>{(window as typeof window&{captureProbe:Probe}).captureProbe.mode='allow';});
  await local(page).getByRole('button',{name:'Choisir un écran et démarrer le test',exact:true}).click();await expect(local(page).getByRole('status')).toContainText('Capture locale en cours');
  await page.evaluate(()=>{(window as typeof window&{captureProbe:Probe}).captureProbe.rejectPending?.();});
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.dataEvents)).toBeGreaterThan(0);
  expect(await streamsEnded(page)).toBe(false);
  await page.getByRole('button',{name:'Remettre ma copie',exact:true}).click();await page.getByRole('button',{name:'Confirmer la remise',exact:true}).click();
  await expect(page.getByText('Votre copie a bien été remise.',{exact:true})).toBeVisible();
  await expect.poll(()=>streamsEnded(page)).toBe(true);
  await expect(local(page).getByRole('link',{name:'Télécharger la vidéo locale',exact:true})).toBeVisible();
  await expect(local(page).getByRole('button',{name:'Choisir un écran pour un nouveau test',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.recorders.length)).toBe(1);
  expect((await (await page.request.get(`${attempt.path}/recording`)).json()).sessions).toEqual([]);
});

test('local capture releases a permission result arriving after component unmount',async({page})=>{
  await activeAttempt(page);await page.evaluate(()=>{(window as typeof window&{captureProbe:Probe}).captureProbe.mode='pending';});
  await consentAndStart(page);await expect(local(page).getByRole('status')).toContainText('Choix de l’écran');
  await local(page).getByRole('button',{name:'Annuler la demande',exact:true}).click();
  await page.getByRole('button',{name:'Mes devoirs',exact:true}).click();await expect(page.getByRole('heading',{name:'Devoirs & examens',exact:true})).toBeVisible();
  await page.evaluate(()=>{(window as typeof window&{captureProbe:Probe}).captureProbe.resolvePending?.();});
  expect(await page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.streams.length)).toBe(1);
  await expect.poll(()=>streamsEnded(page)).toBe(true);
  expect(await page.evaluate(()=>(window as typeof window&{captureProbe:Probe}).captureProbe.recorders.length)).toBe(0);
});

test('local capture stops at sixty seconds and discards an oversized retained chunk',async({page})=>{
  await page.clock.install();await activeAttempt(page);await consentAndStart(page);
  await expect.poll(()=>page.locator('video[aria-label="Aperçu de la capture locale en direct"]').evaluate((video:HTMLVideoElement)=>video.videoWidth)).toBe(640);
  await page.clock.fastForward(60100);
  await expect(local(page).getByRole('status')).toHaveText('Capture locale arrêtée');await expect(local(page)).toContainText('Arrêt automatique après 60 secondes');await expect.poll(()=>streamsEnded(page)).toBe(true);
  // Delayed/oversized browser blobs are simulated at the native recorder's event
  // boundary; this test does not claim to encode 8 MiB from a real screen.
  const again=local(page).getByRole('button',{name:/Choisir un écran (pour un nouveau test|et démarrer le test)/});await again.click();
  await expect(local(page).getByRole('status')).toContainText('Capture locale en cours');
  await page.evaluate(()=>{(window as typeof window&{captureProbe:Probe}).captureProbe.recorders[0].dispatchEvent(new Event('error'));});
  await expect(local(page).getByRole('status')).toContainText('Capture locale en cours');expect(await streamsEnded(page)).toBe(false);
  await page.evaluate(()=>{const probe=(window as typeof window&{captureProbe:Probe}).captureProbe;probe.recorders.at(-1)!.dispatchEvent(new BlobEvent('dataavailable',{data:new Blob([new Uint8Array(8*1024*1024+1)],{type:'video/webm'})}));});
  await expect(local(page).getByRole('alert')).toContainText('La limite de 8 Mio a été atteinte');
  await expect(local(page).getByRole('status')).toHaveText('Capture locale arrêtée');await expect.poll(()=>streamsEnded(page)).toBe(true);
  await expect(local(page).getByRole('link',{name:'Télécharger la vidéo locale',exact:true})).toHaveCount(0);
});

import path from 'node:path';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {DockerEngine,ROOT,type Manifest,type VerifiedImage} from './engine.js';
import {runtimes} from './catalog.js';

const args=process.argv.slice(2),pull=args.includes('--pull'),onlyIndex=args.indexOf('--only');
const ids=onlyIndex>=0?(args[onlyIndex+1]??'').split(','):runtimes.map(item=>item.id);
if(ids.some(id=>!runtimes.some(item=>item.id===id))||!ids.length)throw new Error('Langage inconnu dans --only.');
if(args.some((arg,index)=>arg!=='--pull'&&arg!=='--only'&&!(onlyIndex>=0&&index===onlyIndex+1)))throw new Error('Usage : bootstrap.ts [--pull] [--only php,python,...]');
const engine=new DockerEngine();await engine.init();
if(!await engine.health())throw new Error('Démarrez Docker Desktop en mode Linux avant de préparer les langages.');
let previous:Manifest={protocol:1,runtimes:[]};try{previous=JSON.parse(await readFile(engine.manifestPath,'utf8'));}catch{}
const prepared:VerifiedImage[]=Array.isArray(previous.runtimes)?previous.runtimes.filter(item=>!ids.includes(item.id)):[];
const inspectedImages=new Map<string,Awaited<ReturnType<DockerEngine['inspect']>>>();let failed=false;
for(const definition of runtimes.filter(item=>ids.includes(item.id))){
  try{
    if(!inspectedImages.has(definition.image)){
      if(pull){
        const command=definition.build?['build','--pull','--tag',definition.image,path.join(ROOT,'images',definition.build)]:['pull',definition.image];
        console.log(`Préparation ${definition.image}…`);
        const result=await engine.command(command,{timeoutMs:20*60*1000,outputLimit:1024*1024});
        if(result.code||result.timedOut||result.overflow)throw new Error(`Image non préparée : ${result.stderr.slice(-1200)}`);
      }
      inspectedImages.set(definition.image,await engine.inspect(definition.image));
    }
    const image=inspectedImages.get(definition.image);if(!image)throw new Error('Image absente ; utilisez --pull après autorisation de l’installation.');
    const result=await engine.execute(definition,definition.sample,'',image.imageId);
    if(result.status!=='SUCCEEDED'||(definition.previewFile?!result.preview_html?.includes('Bonjour'):result.stdout.trim()!=='Bonjour!'))throw new Error(`${result.status} : ${result.message||result.compile_output||result.stderr}`);
    prepared.push({id:definition.id,version:definition.version,sourceImage:definition.image,...image,testedAt:new Date().toISOString(),policyVerified:true});
    console.log(`${definition.id} : vrai programme exécuté, isolation inspectée, image ${image.imageId}.`);
  }catch(error){failed=true;console.error(`${definition.id} : ${(error as Error).message}`);}
  // Persist every completed language so a later download failure does not pretend
  // that missing images passed, or discard the verified earlier successes.
  const temp=`${engine.manifestPath}.tmp`;await writeFile(temp,JSON.stringify({protocol:1,runtimes:prepared},null,2)+'\n',{mode:0o600});await rename(temp,engine.manifestPath);
}
if(failed)process.exitCode=1;

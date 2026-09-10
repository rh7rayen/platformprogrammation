// Executed only inside the disposable Docker container. No student JS is imported
// or evaluated by Node: TypeScript/Angular compile it, esbuild bundles for browser.
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';
import {build} from 'esbuild';
import {parseProject,previewDocument} from './project.mjs';

const root='/tmp/build';
const allowedImports={react:new Set(['react','react/jsx-runtime','react-dom/client']),angular:new Set(['@angular/core','@angular/common','@angular/forms','rxjs','rxjs/operators'])};
function validateSource(code,filename,runtime){
  const source=ts.createSourceFile(filename,code,ts.ScriptTarget.Latest,true,filename.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  if(source.referencedFiles.length||source.typeReferenceDirectives.length||source.libReferenceDirectives.length)throw new Error('Les références de fichiers externes sont interdites.');
  const check=specifier=>{if(!ts.isStringLiteral(specifier)||!allowedImports[runtime].has(specifier.text))throw new Error('Import non disponible dans cet environnement hors réseau.');};
  function visit(node){
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)check(node.moduleSpecifier);
    if(ts.isImportTypeNode(node)||ts.isImportEqualsDeclaration(node))throw new Error('Imports indirects non disponibles dans cet environnement.');
    if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require')))throw new Error('Imports dynamiques non disponibles dans cet environnement.');
    if(runtime==='angular'&&ts.isComputedPropertyName(node))throw new Error('Les propriétés calculées ne sont pas disponibles dans ce projet Angular borné.');
    if(runtime==='angular'&&(ts.isPropertyAssignment(node)||ts.isShorthandPropertyAssignment(node)||ts.isGetAccessor(node)||ts.isMethodDeclaration(node))&&['templateUrl','styleUrl','styleUrls'].includes(node.name.getText(source).replace(/['"]/g,'')))throw new Error('Utilisez un template et des styles inline ; les fichiers externes Angular sont interdits.');
    ts.forEachChild(node,visit);
  }
  visit(source);
}
async function compiler(runtime){
  const filename=runtime==='react'?'App.tsx':'app.component.ts';
  const project=parseProject(await readFile('/work/project.json','utf8'),runtime);
  validateSource(project.files[filename],filename,runtime);
  await mkdir(root,{recursive:false});await symlink('/opt/uniexam/node_modules',`${root}/node_modules`,'dir');
  await writeFile(`${root}/${filename}`,project.files[filename],{flag:'wx'});
  const options={target:'ES2022',module:'ES2022',moduleResolution:'bundler',strict:true,skipLibCheck:true,types:runtime==='react'?['react','react-dom']:[],lib:['ES2022','DOM'],experimentalDecorators:true,useDefineForClassFields:false,jsx:'react-jsx',outDir:'./compiled',noEmitOnError:true};
  const config={compilerOptions:options,files:[filename],...(runtime==='angular'?{angularCompilerOptions:{compilationMode:'full',strictTemplates:true,strictInjectionParameters:true,enableResourceInlining:true}}:{})};
  await writeFile(`${root}/tsconfig.json`,JSON.stringify(config),{flag:'wx'});
  const executable=runtime==='angular'?'/opt/uniexam/node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js':'/opt/uniexam/node_modules/typescript/bin/tsc';
  const compiled=spawnSync(process.execPath,['--max-old-space-size=384',executable,'-p',`${root}/tsconfig.json`],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:30000,env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',NG_CLI_ANALYTICS:'false'}});
  if(compiled.error||compiled.status!==0)throw new Error((compiled.stdout+compiled.stderr).trim()||'Le compilateur a dépassé sa limite de temps ou de sortie.');
  const entry=runtime==='react'?'import {createRoot} from "react-dom/client"; import App from "./App.js"; createRoot(document.getElementById("root")).render(<App/>);':'import {bootstrapApplication} from "@angular/platform-browser"; import {AppComponent} from "./app.component.js"; bootstrapApplication(AppComponent).catch(error => { console.error(error); document.body.textContent = "Erreur Angular : " + error.message; });';
  const plugins=[];
  if(runtime==='angular'){
    const {transformAsync}=await import('@babel/core');
    const {default:linker}=await import('@angular/compiler-cli/linker/babel');
    plugins.push({name:'official-angular-aot-linker',setup(builder){builder.onLoad({filter:/\.m?js$/},async({path:filename})=>{
      if(!filename.includes('/node_modules/@angular/'))return;
      const source=await readFile(filename,'utf8');
      const result=await transformAsync(source,{filename,configFile:false,babelrc:false,compact:false,plugins:[[linker,{jitMode:false}]]});
      return {contents:result.code,loader:'js',resolveDir:path.dirname(filename)};
    });}});
  }
  const bundled=await build({stdin:{contents:entry,resolveDir:`${root}/compiled`,sourcefile:'uniexam-entry.tsx',loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',target:'es2022',minify:true,write:false,metafile:true,sourcemap:false,legalComments:'inline',nodePaths:['/opt/uniexam/node_modules'],define:{'process.env.NODE_ENV':'"production"','ngDevMode':'false','ngJitMode':'false'},plugins,logLevel:'silent'});
  if(bundled.warnings.length||Object.values(bundled.metafile.outputs).some(output=>output.imports.some(item=>item.external)))throw new Error('Le bundle nécessite une ressource externe ou présente un avertissement de compilation.');
  if(bundled.outputFiles.length!==1)throw new Error('Le compilateur doit produire un seul bundle autonome.');
  const html=previewDocument(runtime,bundled.outputFiles[0].text,project.files['style.css']);
  await writeFile('/tmp/preview.html',html,{flag:'wx',mode:0o600});
  console.log(`${runtime==='angular'?'Angular AOT':'React'} : compilation réussie, aperçu autonome (${Buffer.byteLength(html)} octets).`);
}
try{await compiler(process.argv[2]);}catch(error){console.error(String(error?.message??'Échec de compilation.').slice(0,27000));process.exitCode=1;}

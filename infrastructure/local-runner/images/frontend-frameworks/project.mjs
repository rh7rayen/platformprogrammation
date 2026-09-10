export const SOURCE_LIMIT=30000;
export const PREVIEW_LIMIT=2*1024*1024;
const runtimeFiles={react:['App.tsx','style.css'],angular:['app.component.ts','style.css']};
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export function parseProject(text,runtime){
  if(!Object.hasOwn(runtimeFiles,runtime))throw new Error('Framework inconnu.');
  if(typeof text!=='string'||Buffer.byteLength(text)>SOURCE_LIMIT||text.includes('\0'))throw new Error('Projet limité à 30 000 octets, sans caractère nul.');
  let project;try{project=JSON.parse(text);}catch{throw new Error('Projet JSON invalide.');}
  if(!exact(project,['format','runtime','files'])||project.format!=='uniexam-project-v1'||project.runtime!==runtime||!exact(project.files,runtimeFiles[runtime]))throw new Error('Format du projet ou fichiers non autorisés.');
  for(const filename of runtimeFiles[runtime])if(typeof project.files[filename]!=='string'||project.files[filename].includes('\0'))throw new Error('Chaque fichier doit contenir du texte valide.');
  return project;
}

export function previewDocument(runtime,javascript,css){
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
  const body=runtime==='react'?'<div id="root"></div>':'<app-root></app-root>';
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.replace(/<\/style/gi,'<\\/style')}</style></head><body>${body}<script>${javascript.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
  if(Buffer.byteLength(html)>PREVIEW_LIMIT)throw new Error('Aperçu compilé limité à 2 Mio.');
  return html;
}

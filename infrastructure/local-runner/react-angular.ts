// Trusted definitions only. Their JSON project is data, never Docker argv.
export const frontendFrameworkImage='uniexam/frontend-frameworks:react19.3.0-angular22.1.6-v1';
type FrameworkRuntime={id:'react'|'angular';version:string;image:string;filename:string;build:string;compile:string[][];run:string[];previewFile:'/tmp/preview.html';sample:string};
export const reactAngularRuntimes:FrameworkRuntime[]=[
  {id:'react',version:'React 19.3.0 / TypeScript 6.0.3',image:frontendFrameworkImage,filename:'project.json',build:'frontend-frameworks',
    compile:[['node','--max-old-space-size=384','/opt/uniexam/build.mjs','react']],
    run:['node','/opt/uniexam/summary.mjs'],previewFile:'/tmp/preview.html',
    sample:JSON.stringify({format:'uniexam-project-v1',runtime:'react',files:{'App.tsx':'import { useState } from "react";\nexport default function App() { const [count,setCount] = useState(0); return <main><h1>Bonjour!</h1><button onClick={() => setCount(count + 1)}>Compteur {count}</button></main>; }','style.css':'body { font-family: system-ui; padding: 2rem; }'}})},
  {id:'angular',version:'Angular 22.1.6 AOT / TypeScript 6.0.3',image:frontendFrameworkImage,filename:'project.json',build:'frontend-frameworks',
    compile:[['node','--max-old-space-size=384','/opt/uniexam/build.mjs','angular']],
    run:['node','/opt/uniexam/summary.mjs'],previewFile:'/tmp/preview.html',
    sample:JSON.stringify({format:'uniexam-project-v1',runtime:'angular',files:{'app.component.ts':'import { Component, signal } from "@angular/core";\n@Component({ selector: "app-root", standalone: true, template: `<main><h1>Bonjour!</h1><button (click)="count.set(count() + 1)">Compteur {{ count() }}</button></main>` })\nexport class AppComponent { readonly count = signal(0); }','style.css':'body { font-family: system-ui; padding: 2rem; }'}})},
];

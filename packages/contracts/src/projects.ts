import {z} from 'zod';

export const frameworkIds=['react','angular','symfony','laravel'] as const;
export type FrameworkId=typeof frameworkIds[number];
const source=z.string().max(20000);
const base={format:z.literal('uniexam-project-v1')};
export const frameworkProjectSchema=z.discriminatedUnion('runtime',[
 z.object({...base,runtime:z.literal('react'),files:z.object({'App.tsx':source,'style.css':source}).strict()}).strict(),
 z.object({...base,runtime:z.literal('angular'),files:z.object({'app.component.ts':source,'style.css':source}).strict()}).strict(),
 z.object({...base,runtime:z.literal('symfony'),files:z.object({'src/Controller/ExamController.php':source,'templates/exam.html.twig':source}).strict()}).strict(),
 z.object({...base,runtime:z.literal('laravel'),files:z.object({'routes/web.php':source,'resources/views/exam.blade.php':source}).strict()}).strict(),
]);
export type FrameworkProject=z.infer<typeof frameworkProjectSchema>;
export function isFrameworkRuntime(id:string|null):id is FrameworkId{return frameworkIds.includes(id as FrameworkId);}
export function parseFrameworkProject(text:string,runtime?:FrameworkId):FrameworkProject{
 const project=frameworkProjectSchema.parse(JSON.parse(text));
 if(runtime&&project.runtime!==runtime)throw new Error('Le projet doit utiliser le framework choisi par l’enseignant.');
 return project;
}
export function projectFileLanguage(filename:string){
 if(filename.endsWith('.tsx')||filename.endsWith('.ts'))return 'typescript';
 if(filename.endsWith('.css'))return 'css';
 if(filename.endsWith('.twig')||filename.endsWith('.blade.php')||filename.endsWith('.html'))return 'html';
 if(filename.endsWith('.php'))return 'php';
 return 'javascript';
}

export const defaultFrameworkProjects:Record<FrameworkId,FrameworkProject>={
 react:{format:'uniexam-project-v1',runtime:'react',files:{
  'App.tsx':'import { useState } from "react";\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return <main>\n    <h1>Bonjour React !</h1>\n    <button onClick={() => setCount(count + 1)}>Compteur {count}</button>\n  </main>;\n}\n',
  'style.css':'body { font-family: system-ui; padding: 2rem; }\nbutton { padding: .7rem 1rem; cursor: pointer; }\n',
 }},
 angular:{format:'uniexam-project-v1',runtime:'angular',files:{
  'app.component.ts':'import { Component, signal } from "@angular/core";\n\n@Component({\n  selector: "app-root",\n  standalone: true,\n  template: `<main><h1>Bonjour Angular !</h1><button (click)="count.set(count() + 1)">Compteur {{ count() }}</button></main>`\n})\nexport class AppComponent {\n  readonly count = signal(0);\n}\n',
  'style.css':'body { font-family: system-ui; padding: 2rem; }\nbutton { padding: .7rem 1rem; cursor: pointer; }\n',
 }},
 symfony:{format:'uniexam-project-v1',runtime:'symfony',files:{
  'src/Controller/ExamController.php':'<?php\nnamespace App\\Controller;\n\nuse Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;\nuse Symfony\\Component\\HttpFoundation\\Request;\nuse Symfony\\Component\\HttpFoundation\\Response;\nuse Symfony\\Component\\Routing\\Attribute\\Route;\n\nfinal class ExamController extends AbstractController\n{\n    #[Route("/", name: "exam", methods: ["GET", "POST"])]\n    public function index(Request $request): Response\n    {\n        $name = $request->request->get("name", $request->query->get("name", "monde"));\n        return $this->render("exam.html.twig", ["name" => $name]);\n    }\n}\n',
  'templates/exam.html.twig':'<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>Mon devoir Symfony</title></head>\n<body><h1>Bonjour {{ name }} !</h1><p>Une vraie réponse Symfony et Twig.</p></body></html>\n',
 }},
 laravel:{format:'uniexam-project-v1',runtime:'laravel',files:{
  'routes/web.php':'<?php\nuse Illuminate\\Http\\Request;\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::match(["get", "post"], "/", function (Request $request) {\n    return view("exam", ["name" => $request->input("name", "monde")]);\n});\n',
  'resources/views/exam.blade.php':'<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>Mon devoir Laravel</title></head>\n<body><h1>Bonjour {{ $name }} !</h1><p>Une vraie réponse Laravel et Blade.</p></body></html>\n',
 }},
};

import { z } from 'zod';
import {defaultFrameworkProjects,frameworkIds} from './projects';

export const runtimeIds = ['python','php','java','javascript','typescript','c','cpp','csharp','go','rust','ruby','bash','sql','web','react','angular','symfony','laravel','mysql','oracle_plsql'] as const;
export const runtimeSchema = z.enum(runtimeIds);
export type RuntimeId = z.infer<typeof runtimeSchema>;
export type RuntimeDefinition = { id:RuntimeId;label:string;monacoLanguage:string;filename:string;starterCode:string;kind:'REMOTE'|'EDIT_ONLY'|'WEB_PREVIEW' };
export const webProjectSchema = z.object({
  format:z.literal('uniexam-web-v1'),
  files:z.object({'index.html':z.string().max(20000),'style.css':z.string().max(10000),'script.js':z.string().max(10000)}).strict(),
}).strict();
export type WebProject = z.infer<typeof webProjectSchema>;
export const defaultWebProject:WebProject = {
  format:'uniexam-web-v1',
  files:{'index.html':'<main>\n  <h1>Mon application</h1>\n  <button id="hello">Dire bonjour</button>\n  <p id="result"></p>\n</main>',
    'style.css':'body { font-family: system-ui; padding: 2rem; }\nbutton { padding: .7rem 1rem; cursor: pointer; }',
    'script.js':'document.getElementById("hello").addEventListener("click", () => {\n  document.getElementById("result").textContent = "Bonjour !";\n});'},
};
export function parseWebProject(text:string):WebProject {
  return webProjectSchema.parse(JSON.parse(text));
}
export const RUNTIME_CATALOG:readonly RuntimeDefinition[] = [
  {id:'python',label:'Python',monacoLanguage:'python',filename:'main.py',starterCode:'print("Bonjour !")\n',kind:'REMOTE'},
  {id:'php',label:'PHP',monacoLanguage:'php',filename:'main.php',starterCode:'<?php\necho "Bonjour !\\n";\n',kind:'REMOTE'},
  {id:'java',label:'Java',monacoLanguage:'java',filename:'Main.java',starterCode:'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Bonjour !");\n    }\n}\n',kind:'REMOTE'},
  {id:'javascript',label:'JavaScript',monacoLanguage:'javascript',filename:'main.js',starterCode:'console.log("Bonjour !");\n',kind:'REMOTE'},
  {id:'typescript',label:'TypeScript',monacoLanguage:'typescript',filename:'main.ts',starterCode:'const message: string = "Bonjour !";\nconsole.log(message);\n',kind:'REMOTE'},
  {id:'c',label:'C',monacoLanguage:'c',filename:'main.c',starterCode:'#include <stdio.h>\nint main(void) {\n    puts("Bonjour !");\n    return 0;\n}\n',kind:'REMOTE'},
  {id:'cpp',label:'C++',monacoLanguage:'cpp',filename:'main.cpp',starterCode:'#include <iostream>\nint main() {\n    std::cout << "Bonjour !" << std::endl;\n    return 0;\n}\n',kind:'REMOTE'},
  {id:'csharp',label:'C#',monacoLanguage:'csharp',filename:'Main.cs',starterCode:'using System;\nclass Program {\n    static void Main() { Console.WriteLine("Bonjour !"); }\n}\n',kind:'REMOTE'},
  {id:'go',label:'Go',monacoLanguage:'go',filename:'main.go',starterCode:'package main\nimport "fmt"\nfunc main() { fmt.Println("Bonjour !") }\n',kind:'REMOTE'},
  {id:'rust',label:'Rust',monacoLanguage:'rust',filename:'main.rs',starterCode:'fn main() {\n    println!("Bonjour !");\n}\n',kind:'REMOTE'},
  {id:'ruby',label:'Ruby',monacoLanguage:'ruby',filename:'main.rb',starterCode:'puts "Bonjour !"\n',kind:'REMOTE'},
  {id:'bash',label:'Bash',monacoLanguage:'shell',filename:'main.sh',starterCode:'printf "Bonjour !\\n"\n',kind:'REMOTE'},
  {id:'sql',label:'SQL · SQLite',monacoLanguage:'sql',filename:'query.sql',starterCode:'-- Base SQLite éphémère et isolée.\nSELECT 1;\n',kind:'REMOTE'},
  {id:'web',label:'Web · HTML / CSS / JavaScript',monacoLanguage:'html',filename:'index.html',starterCode:JSON.stringify(defaultWebProject),kind:'WEB_PREVIEW'},
  ...frameworkIds.map(id=>({id,label:({react:'React',angular:'Angular',symfony:'Symfony',laravel:'Laravel'})[id],monacoLanguage:id==='react'||id==='angular'?'typescript':'php',filename:Object.keys(defaultFrameworkProjects[id].files)[0],starterCode:JSON.stringify(defaultFrameworkProjects[id]),kind:'REMOTE' as const})),
  {id:'mysql',label:'MySQL',monacoLanguage:'sql',filename:'query.sql',starterCode:'-- Base MySQL éphémère et isolée.\nCREATE TABLE nombres (valeur INT);\nINSERT INTO nombres VALUES (7), (35);\nSELECT SUM(valeur) AS total FROM nombres;\n',kind:'REMOTE'},
  {id:'oracle_plsql',label:'Oracle · PL/SQL',monacoLanguage:'sql',filename:'main.sql',starterCode:"SET SERVEROUTPUT ON\nBEGIN\n  DBMS_OUTPUT.PUT_LINE('Bonjour Oracle !');\nEND;\n/\n",kind:'REMOTE'},
];
export function runtimeDefinition(id:RuntimeId):RuntimeDefinition { return RUNTIME_CATALOG.find(runtime=>runtime.id===id)!; }
export type RuntimeAvailability = RuntimeDefinition & {status:'READY'|'UNAVAILABLE'|'EDIT_ONLY'|'WEB_PREVIEW';execution_available:boolean;reason:string;provider_language?:string};
export const executionRequestSchema=z.object({expected_version:z.number().int().min(1).optional(),stdin:z.string().max(4000).default('')}).strict();
export type ExecutionRequest=z.infer<typeof executionRequestSchema>;
export type ExecutionStatus='QUEUED'|'DISPATCHING'|'PROCESSING'|'SUCCEEDED'|'COMPILE_ERROR'|'RUNTIME_ERROR'|'TIME_LIMIT'|'FAILED';
export type ExecutionRun={id:string;question_id:string;runtime:RuntimeId;answer_version:number;status:ExecutionStatus;stdout:string;stderr:string;compile_output:string;message:string;time_seconds:number|null;memory_kb:number|null;created_at:string;finished_at:string|null};

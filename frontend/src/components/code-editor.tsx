'use client';
import Editor,{type OnMount} from '@monaco-editor/react';
import { useEffect,useRef,useState } from 'react';
import { prepareMonaco } from '../lib/monaco-runtime';

export default function CodeEditor({value,onChange,readOnly,allowPaste,language='python',label='Code Python',fontSize=14,readOnlyReason='Cette réponse est en lecture seule.'}:{value:string;onChange:(value:string)=>void;readOnly:boolean;allowPaste:boolean;language?:string;label?:string;fontSize?:number;readOnlyReason?:string}) {
  const [ready,setReady]=useState(false);
  const [loadError,setLoadError]=useState('');
  useEffect(()=>{let active=true;void prepareMonaco().then(()=>{if(active)setReady(true);},error=>{if(active)setLoadError(error.message);});return()=>{active=false;};},[]);
  const cleanup=useRef<()=>void>(()=>{});
  useEffect(()=>()=>cleanup.current(),[]);
  const mount:OnMount=(editor,monaco)=>{
    editor.updateOptions({ariaLabel:label});
    const node=editor.getDomNode();
    const block=(event:Event)=>{if(!allowPaste){event.preventDefault();event.stopImmediatePropagation();}};
    for(const kind of ['paste','copy','cut','drop']) node?.addEventListener(kind,block,true);
    const keys=editor.onKeyDown(event=>{
      if(!allowPaste&&(((event.ctrlKey||event.metaKey)&&[monaco.KeyCode.KeyV,monaco.KeyCode.KeyC,monaco.KeyCode.KeyX].includes(event.keyCode))||(event.shiftKey&&event.keyCode===monaco.KeyCode.Insert))){event.preventDefault();event.stopPropagation();}
    });
    cleanup.current=()=>{keys.dispose();for(const kind of ['paste','copy','cut','drop'])node?.removeEventListener(kind,block,true);};
  };
  // Monaco owns its live buffer; React state mirrors changes for autosave.
  // Replaying delayed controlled values can overwrite rapid keystrokes.
  if(loadError)return <div className="editor-loading" role="alert">{loadError}</div>;
  if(!ready)return <div className="editor-loading">Chargement de l’éditeur…</div>;
  return <Editor height="100%" language={language} theme="vs-dark" defaultValue={value} onChange={value=>onChange(value??'')} onMount={mount}
    loading={<div className="editor-loading">Chargement de l’éditeur…</div>}
    options={{readOnly,readOnlyMessage:{value:readOnlyReason},editContext:false,fontSize,fontFamily:'Consolas, monospace',lineHeight:Math.round(fontSize*1.7),minimap:{enabled:false},padding:{top:18},scrollBeyondLastLine:false,automaticLayout:true,tabSize:4,insertSpaces:true,wordWrap:'on',contextmenu:allowPaste,dragAndDrop:allowPaste,quickSuggestions:false,suggestOnTriggerCharacters:false,parameterHints:{enabled:false},unicodeHighlight:{ambiguousCharacters:false}}}/>;
}

'use client';
import {useEffect,useState} from 'react';
import {RUNTIME_CATALOG,isFrameworkRuntime,type RuntimeId,type RuntimeAvailability} from '@uniexam/contracts';
import {api} from '@/lib/api';
import './runtime-catalog.css';

const groups=[
  {label:'Langages',items:RUNTIME_CATALOG.filter(r=>!isFrameworkRuntime(r.id)&&!['web','sql','mysql','oracle_plsql'].includes(r.id))},
  {label:'Projets web',items:RUNTIME_CATALOG.filter(r=>r.id==='web'||isFrameworkRuntime(r.id))},
  {label:'Bases de données',items:RUNTIME_CATALOG.filter(r=>['sql','mysql','oracle_plsql'].includes(r.id))},
];

export function RuntimeOptions(){return groups.map(group=><optgroup key={group.label} label={group.label}>{group.items.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</optgroup>);}

export function RuntimeCatalog({u,onChoose}:{u:string;onChoose:(runtime:RuntimeId)=>void}){
  const [availability,setAvailability]=useState<RuntimeAvailability[]>(),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let active=true,pending=false;
    async function check(){
      if(pending)return;pending=true;
      try{const result=await api<{data:RuntimeAvailability[]}>(`/universities/${u}/execution/runtimes`);if(active){setAvailability(result.data);setFailed(false);}}
      catch{if(active){setAvailability(undefined);setFailed(true);}}
      finally{pending=false;}
    }
    setAvailability(undefined);setFailed(false);void check();window.addEventListener('focus',check);
    return()=>{active=false;window.removeEventListener('focus',check);};
  },[u]);
  return <section className="runtime-catalog" aria-labelledby="runtime-catalog-title">
    <header><h2 id="runtime-catalog-title">Créer un devoir de programmation</h2><span>{RUNTIME_CATALOG.length} environnements</span></header>
    <p>Choisissez un langage, un framework ou une base de données, puis préparez le devoir pour votre classe.</p>
    <div className="runtime-groups">{groups.map(group=><div className="runtime-group" key={group.label}>
      <h3>{group.label}</h3><div className="runtime-choices">{group.items.map(runtime=>{
        const current=availability?.find(item=>item.id===runtime.id);
        const status=runtime.kind==='WEB_PREVIEW'?'preview':current?.execution_available?'ready':current?'unavailable':'unknown';
        const statusText=status==='preview'?'Aperçu web':status==='ready'?'Exécution prête':status==='unavailable'?'Édition seule':failed?'Disponibilité non vérifiée':'Vérification du moteur…';
        return <button type="button" key={runtime.id} className="runtime-choice" aria-label={`Créer un devoir ${runtime.label}`} aria-describedby={`runtime-status-${runtime.id}`} onClick={()=>onChoose(runtime.id)} title={current?.reason??statusText}>
          <span className={`runtime-dot ${status}`} aria-hidden="true"/>{runtime.label}
          <span id={`runtime-status-${runtime.id}`} className={status==='unavailable'?'runtime-limitation':'sr-only'}>{statusText}</span>
        </button>;
      })}</div>
    </div>)}</div>
    <footer><span><i className="runtime-dot ready"/>Exécution prête</span><span><i className="runtime-dot preview"/>Aperçu web</span><span><i className="runtime-dot unavailable"/>Édition seule : moteur indisponible</span>{(!availability)&&<span role="status">{failed?'Disponibilité non vérifiée. Consultez la console avant de publier.':'Vérification des moteurs…'}</span>}</footer>
  </section>;
}

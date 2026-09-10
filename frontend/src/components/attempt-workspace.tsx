'use client';
import {runtimeDefinition} from '@uniexam/contracts';
import {CodingWorkbench} from './coding-workbench';
import {ScreenRecorder} from './screen-recorder';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,ChevronRight,Clock,LockKeyhole,Save,Send} from 'lucide-react';
import type {AttemptData} from '@uniexam/contracts';
import {api,ApiError,post} from '@/lib/api';
import {ErrorNotice,Loading,Modal} from './ui';

type Draft={value:string;version:number;dirty:boolean};

export function AttemptWorkspace({u,id,studentName,onBack}:{u:string;id:string;studentName:string;onBack:()=>void}) {
  const path=`/universities/${u}/attempts/${id}`;
  const [data,setData]=useState<AttemptData>(),[index,setIndex]=useState(0),[values,setValues]=useState<Record<string,string>>({});
  const [error,setError]=useState(''),[saveState,setSaveState]=useState('Chargement…'),[remaining,setRemaining]=useState(0),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[conflict,setConflict]=useState(false);
  const drafts=useRef<Record<string,Draft>>({}),flight=useRef<Promise<void>|null>(null),debounce=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),active=useRef(true),closed=useRef(false),conflicted=useRef(false);
  const timing=useRef({server:0,local:0,deadline:0});
  const generation=useRef(0);
  const [bufferRevision,setBufferRevision]=useState(0);
  const [recordingReady,setRecordingReady]=useState(true);
  const [editorExpanded,setEditorExpanded]=useState(false);
  const workspace=useRef<HTMLElement|null>(null);
  const [fullscreen,setFullscreen]=useState(false);
  useEffect(()=>{const changed=()=>setFullscreen(document.fullscreenElement===workspace.current);document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
  async function toggleFullscreen(){
    try{
      if(document.fullscreenElement===workspace.current)await document.exitFullscreen();
      else if(workspace.current?.requestFullscreen){await workspace.current.requestFullscreen();setEditorExpanded(true);}
      else setError('Le plein écran n’est pas disponible dans ce navigateur. Le mode agrandi reste utilisable.');
    }catch{setError('Le navigateur a refusé le plein écran. Vous pouvez continuer avec le mode agrandi.');}
  }
  useEffect(()=>{
    if(!editorExpanded)return;
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!event.isComposing&&!(event.target instanceof Element&&event.target.closest('[role="dialog"]')))setEditorExpanded(false);
    };
    // Monaco handles Escape itself; capture keeps the advertised layout shortcut available while typing.
    window.addEventListener('keydown',escape,true);
    return()=>window.removeEventListener('keydown',escape,true);
  },[editorExpanded]);
  const refresh=useCallback(async(initial=false)=>{
    const current=generation.current;
    const next=await api<AttemptData>(path);
    if(!active.current||current!==generation.current)return;
    timing.current={server:Date.parse(next.server_time),local:performance.now(),deadline:Date.parse(next.attempt.deadline)};
    setRemaining(Math.max(0,Math.ceil((Date.parse(next.attempt.deadline)-Date.parse(next.server_time))/1000)));
    closed.current=next.attempt.status!=='IN_PROGRESS';
    setData(next);
    if(initial){
      setBufferRevision(version=>version+1);
      drafts.current=Object.fromEntries(next.questions.map(q=>{const saved=next.answers.find(a=>a.question_id===q.id);return [q.id,{value:saved?.answer_text??q.starter_code,version:saved?.version??0,dirty:!closed.current&&!saved&&q.starter_code!==''}];}));
      setValues(Object.fromEntries(Object.entries(drafts.current).map(([key,d])=>[key,d.value])));
      conflicted.current=false;setConflict(false);setError('');
      setSaveState(Object.values(drafts.current).some(d=>d.dirty)?'Modifications à enregistrer':'Enregistré');
    }
  },[path]);
  const flush=useCallback(async()=>{
    if(flight.current)return flight.current;
    if(conflicted.current)throw new Error('Rechargez la version du serveur avant de continuer.');
    if(closed.current)return;
    const task=(async()=>{
      try{
        while(true){
          const entry=Object.entries(drafts.current).find(([,d])=>d.dirty);
          if(!entry)break;
          const [questionId,draft]=entry,snapshot=draft.value;
          if(active.current)setSaveState('Enregistrement…');
          const saved=await api<{version:number}>(`${path}/answers/${questionId}`,{method:'PUT',body:JSON.stringify({answer_text:snapshot,expected_version:draft.version})});
          draft.version=saved.version;draft.dirty=draft.value!==snapshot;
        }
        if(active.current){setSaveState('Enregistré');setError('');}
      }catch(e){
        if(active.current){
          setError((e as Error).message);setSaveState('Non enregistré');
          if(e instanceof ApiError&&e.status===409){conflicted.current=true;setConflict(true);}
          if(e instanceof ApiError&&e.status===410){closed.current=true;await refresh();}
        }
        throw e;
      }
    })();
    flight.current=task;
    try{await task;}finally{flight.current=null;}
  },[path,refresh]);
  useEffect(()=>{
    active.current=true;generation.current++;
    void refresh(true).then(()=>flush()).catch(e=>{if(active.current)setError((e as Error).message);});
    const poll=setInterval(()=>void refresh().catch(e=>{if(active.current)setError((e as Error).message);}),15000);
    const clock=setInterval(()=>{const t=timing.current;setRemaining(Math.max(0,Math.ceil((t.deadline-t.server-(performance.now()-t.local))/1000)));},500);
    const unload=(event:BeforeUnloadEvent)=>{if(Object.values(drafts.current).some(d=>d.dirty)&&!closed.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return()=>{active.current=false;generation.current++;clearInterval(poll);clearInterval(clock);clearTimeout(debounce.current);window.removeEventListener('beforeunload',unload);};
  },[refresh,flush]);
  useEffect(()=>{
    if(data&&remaining===0&&timing.current.deadline&&Date.parse(data.attempt.deadline)<=timing.current.server+performance.now()-timing.current.local&&!closed.current)void refresh().catch(e=>setError(e.message));
  },[remaining,data,refresh]);
  function change(value:string){
    if(!data||closed.current||conflicted.current)return;
    const q=data.questions[index];drafts.current[q.id].value=value;drafts.current[q.id].dirty=true;
    setValues(previous=>({...previous,[q.id]:value}));setSaveState('Modifications à enregistrer');
    clearTimeout(debounce.current);debounce.current=setTimeout(()=>void flush().catch(()=>{}),800);
  }
  async function back(){if(!recordingReady){setError('Arrêtez la capture et attendez la fin des transferts vidéo avant de quitter votre devoir.');return;}setBusy(true);try{await flush();onBack();}catch{}finally{setBusy(false);}}
  async function submit(){setBusy(true);try{await flush();await post(`${path}/finalize`,{});await refresh();setConfirm(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(!data)return <main className="attempt-loading"><button className="button secondary" onClick={onBack}><ArrowLeft size={16}/>Retour aux devoirs</button>{error?<ErrorNotice message={error}/>:<Loading label="Ouverture de votre devoir…"/>}</main>;
  const q=data.questions[index],isClosed=data.attempt.status!=='IN_PROGRESS',readOnly=isClosed||busy||conflict||remaining===0;
  const expanded=editorExpanded&&q.type==='CODE';
  const readOnlyReason=isClosed?'Cette copie a été remise. Pour écrire du code, ouvrez un devoir encore actif depuis « Mes devoirs ».':conflict?'Rechargez la version du serveur pour résoudre le conflit avant de reprendre la saisie.':remaining===0?'Le temps est écoulé. Votre copie est en lecture seule.':'Enregistrement de la copie en cours…';
  const answered=Object.values(values).filter(v=>v.trim()).length;
  const minutes=Math.floor(remaining/60),seconds=remaining%60;
  const block=(event:React.ClipboardEvent|React.DragEvent)=>{if(!data.assessment.allow_paste){event.preventDefault();setError('Le copier-coller et le glisser-déposer sont désactivés pour ce devoir.');}};
  return <main ref={workspace} className={`exam-workspace${expanded?' editor-expanded':''}`}>
    <header className="exam-top"><button className="exam-back" onClick={back} disabled={busy}><ArrowLeft size={18}/><span>Mes devoirs</span></button><div className="exam-heading"><span>ESPACE ÉTUDIANT / ÉVALUATION</span><h1>{data.assessment.title}</h1></div><div className={`exam-clock ${remaining<300?'urgent':''}`}><Clock size={18}/><div><small>{isClosed?'DEVOIR TERMINÉ':'TEMPS RESTANT'}</small><strong>{isClosed?'Remis':`${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`}</strong></div></div><button className="button primary" onClick={()=>setConfirm(true)} disabled={readOnly}><Send size={16}/>Remettre ma copie</button></header>
    <div className="exam-person"><span><span className="status-dot"/>{studentName}</span><span role="status" className={saveState==='Non enregistré'?'save-error':''}><Save size={14}/>{isClosed?'Copie remise et verrouillée':saveState}</span><button onClick={()=>void flush().catch(()=>{})} disabled={isClosed||busy||conflict}>Enregistrer maintenant</button></div>
    {error&&<div className="exam-error"><ErrorNotice message={error}/>{conflict&&<button className="button secondary" onClick={()=>{if(window.confirm('Remplacer vos modifications locales par la version enregistrée sur le serveur ?'))void refresh(true).catch(e=>setError(e.message));}}>Recharger la version du serveur</button>}</div>}
    {isClosed&&<div className="exam-receipt" role="status"><Check size={20}/><span><strong>{data.attempt.status==='AUTO_SUBMITTED'?'Temps écoulé : votre copie a été remise automatiquement.':'Votre copie a bien été remise.'}</strong> {data.results?`Résultat : ${data.results.total_score} / ${data.results.total_points}`:'Votre enseignant peut maintenant la corriger.'}</span><button className="button secondary" onClick={back} disabled={busy}>Ouvrir un autre devoir</button></div>}
    <ScreenRecorder universityId={u} attemptId={id} disabled={isClosed||remaining===0} onLeaveReadyChange={setRecordingReady}/>
    <div className="exam-body" onPaste={block} onCopy={block} onCut={block} onDrop={block}>
      {expanded&&<div className="expanded-question-context"><label>Question en cours<select aria-label="Question en cours" value={index} onChange={event=>setIndex(Number(event.target.value))}>{data.questions.map((question,i)=><option key={question.id} value={i}>{i+1}. {question.title}</option>)}</select></label><details key={q.id}><summary>Lire la consigne · {q.points} points</summary><p>{q.statement}</p><small>{data.assessment.allow_paste?'Le copier-coller est autorisé.':'Le copier-coller est désactivé pour ce devoir.'}</small></details><span>Échap pour réduire</span></div>}
      <aside className="question-panel"><div className="question-panel-top"><span className="eyebrow">VOTRE DEVOIR</span><h2>Questions</h2><span>{answered} / {data.questions.length} réponses commencées</span></div><nav aria-label="Questions du devoir">{data.questions.map((question,i)=><button key={question.id} className={index===i?'selected':''} onClick={()=>setIndex(i)} aria-current={index===i?'step':undefined}><span className="question-number">{i+1}</span><span><strong>{question.title}</strong><small>{question.type==='CODE'?runtimeDefinition(question.runtime!).label:question.type==='SINGLE_CHOICE'?'QCM':'Réponse rédigée'} · {question.points} pts</small></span><ChevronRight size={14}/></button>)}</nav><div className="question-statement"><div className="statement-label">QUESTION {index+1}<span>{q.points} POINTS</span></div><h2>{q.title}</h2><p>{q.statement}</p></div><div className="exam-rules"><LockKeyhole size={17}/><p>{data.assessment.allow_paste?'Le copier-coller est autorisé.':'Le copier-coller est désactivé dans cet espace.'}<br/>Vos réponses sont enregistrées automatiquement. Le temps continue si vous quittez la page.</p></div></aside>
      <section className="answer-panel" aria-label="Espace de réponse">
        {q.type==='CODE'?<CodingWorkbench key={q.id} u={u} attemptId={id} questionId={q.id} runtime={q.runtime!} value={values[q.id]??''} onChange={change} readOnly={readOnly} readOnlyReason={readOnlyReason} fullscreen={fullscreen} onToggleFullscreen={()=>void toggleFullscreen()} expanded={expanded} onToggleExpanded={()=>setEditorExpanded(value=>!value)} allowPaste={data.assessment.allow_paste} bufferRevision={bufferRevision} save={async()=>{await flush();return drafts.current[q.id].version;}}/>:<div className="written-answer"><span className="eyebrow">VOTRE RÉPONSE</span><h2>{q.type==='SINGLE_CHOICE'?'Choisissez une réponse':'Rédigez votre réponse'}</h2>{q.type==='SINGLE_CHOICE'?<fieldset disabled={readOnly}><legend className="sr-only">{q.title}</legend>{q.options.map(option=><label className={`exam-choice ${values[q.id]===option.id?'chosen':''}`} key={option.id}><input type="radio" name={q.id} value={option.id} checked={values[q.id]===option.id} onChange={()=>change(option.id)}/><span>{option.text}</span></label>)}</fieldset>:<><textarea aria-label="Réponse rédigée" value={values[q.id]??''} onChange={e=>change(e.target.value)} disabled={readOnly} maxLength={30000} rows={18}/><small>{(values[q.id]??'').length} / 30 000 caractères</small></>}<p>Votre réponse est enregistrée sans quitter cette question.</p></div>}
        {data.results&&<div className="exam-feedback">Note : {data.results.answers.find(a=>a.question_id===q.id)?.score} / {q.points}<p>{data.results.answers.find(a=>a.question_id===q.id)?.feedback}</p></div>}
      </section>
    </div>
    {confirm&&<Modal title="Remettre votre devoir ?" onClose={()=>{if(!busy)setConfirm(false);}}><div className="stack"><p>Vos dernières réponses seront enregistrées, puis votre copie sera transmise à votre enseignant. Vous ne pourrez plus la modifier.</p><p>{answered} réponse(s) commencée(s) sur {data.questions.length}.</p><button className="button primary" onClick={submit} disabled={busy}>{busy?'Remise en cours…':'Confirmer la remise'}</button><button className="button secondary" onClick={()=>setConfirm(false)} disabled={busy}>Continuer mon devoir</button></div></Modal>}
  </main>;
}

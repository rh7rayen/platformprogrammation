'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,MonitorPlay,Square,Trash2} from 'lucide-react';
import './local-screen-capture.css';

const MAX_BYTES=8*1024*1024;
const MAX_DURATION_MS=60000;
type Phase='IDLE'|'STARTING'|'RECORDING'|'STOPPING'|'FINISHED';
type Clip={url:string;bytes:number;filename:string};
type Props={disabled?:boolean;onLeaveReadyChange?:(ready:boolean)=>void};
const busy=(phase:Phase)=>phase==='STARTING'||phase==='RECORDING'||phase==='STOPPING';

/** An explicitly local device test. This component has no network or API dependencies. */
export function LocalScreenCapture({disabled=false,onLeaveReadyChange}:Props){
  const [open,setOpen]=useState(false),[consent,setConsent]=useState(false),[supported,setSupported]=useState(false);
  const [phase,setPhase]=useState<Phase>('IDLE'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[elapsed,setElapsed]=useState(0),[clip,setClip]=useState<Clip|null>(null);
  const [hasStarted,setHasStarted]=useState(false);
  const mounted=useRef(true),generation=useRef(0),phaseRef=useRef<Phase>('IDLE'),disabledRef=useRef(disabled);
  const stream=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null),parts=useRef<Blob[]>([]),bytes=useRef(0),discard=useRef(false),objectUrl=useRef<string|null>(null);
  const liveVideo=useRef<HTMLVideoElement|null>(null),savedVideo=useRef<HTMLVideoElement|null>(null);
  const timeout=useRef<ReturnType<typeof setTimeout>|null>(null),ticker=useRef<ReturnType<typeof setInterval>|null>(null),startedAt=useRef(0);
  const leaveCallback=useRef(onLeaveReadyChange);leaveCallback.current=onLeaveReadyChange;disabledRef.current=disabled;
  function transition(next:Phase){phaseRef.current=next;if(mounted.current)setPhase(next);leaveCallback.current?.(!busy(next));}
  const clearTimers=useCallback(()=>{if(timeout.current)clearTimeout(timeout.current);if(ticker.current)clearInterval(ticker.current);timeout.current=null;ticker.current=null;},[]);
  const releaseTracks=useCallback(()=>{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;if(liveVideo.current)liveVideo.current.srcObject=null;},[]);
  const releaseClip=useCallback(()=>{
    if(savedVideo.current){savedVideo.current.pause();savedVideo.current.removeAttribute('src');savedVideo.current.load();}
    if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=null;
  },[]);
  const stopRef=useRef<(reason?:string)=>void>(()=>{});

  useEffect(()=>{
    mounted.current=true;
    setSupported(typeof navigator.mediaDevices?.getDisplayMedia==='function'&&typeof window.MediaRecorder==='function');
    const unload=(event:BeforeUnloadEvent)=>{if(busy(phaseRef.current)){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return()=>{
      mounted.current=false;generation.current++;clearTimers();
      const current=recorder.current;if(current){current.ondataavailable=null;current.onstop=null;current.onerror=null;if(current.state!=='inactive')current.stop();}
      recorder.current=null;releaseTracks();releaseClip();parts.current=[];bytes.current=0;phaseRef.current='IDLE';leaveCallback.current?.(true);
      window.removeEventListener('beforeunload',unload);
    };
  },[clearTimers,releaseClip,releaseTracks]);
  useEffect(()=>{if(disabled)stopRef.current('La tentative est terminée.');},[disabled]);
  useEffect(()=>{if(phase==='RECORDING'&&liveVideo.current&&stream.current){liveVideo.current.srcObject=stream.current;void liveVideo.current.play().catch(()=>{});}},[phase]);

  function stop(reason='Le test local est terminé.'){
    if(phaseRef.current==='STARTING'){
      generation.current++;releaseTracks();if(mounted.current)setNotice('Demande annulée.');transition('IDLE');return;
    }
    if(phaseRef.current!=='RECORDING')return;
    clearTimers();if(mounted.current)setNotice(reason);transition('STOPPING');
    const current=recorder.current;
    if(current&&current.state!=='inactive')current.stop();
    releaseTracks();
  }
  stopRef.current=stop;
  async function start(){
    if(!consent||!supported||disabledRef.current||busy(phaseRef.current))return;
    const currentGeneration=++generation.current;
    setError('');setNotice('');setElapsed(0);transition('STARTING');
    let capture:MediaStream|undefined;
    try{
      // The user's explicit click is the only entry point to the browser's share chooser.
      capture=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:10,width:1280,height:720},audio:false});
      if(!mounted.current||generation.current!==currentGeneration||disabledRef.current){capture.getTracks().forEach(track=>track.stop());return;}
      const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      if(!mime)throw new Error('Ce navigateur ne prend pas en charge les formats vidéo du test.');
      releaseClip();setClip(null);parts.current=[];bytes.current=0;discard.current=false;stream.current=capture;
      const next=new MediaRecorder(capture,{mimeType:mime,videoBitsPerSecond:300000});recorder.current=next;
      next.ondataavailable=event=>{
        if(!mounted.current||generation.current!==currentGeneration||discard.current||!event.data.size)return;
        // Never retain a chunk that would push application-owned media above 8 MiB.
        // Browser encoder buffers and timeslice scheduling are outside JavaScript's control.
        if(bytes.current+event.data.size>MAX_BYTES){
          discard.current=true;parts.current=[];bytes.current=0;setError('La limite de 8 Mio a été atteinte. La capture a été arrêtée et cette vidéo n’a pas été conservée.');stopRef.current('Limite mémoire atteinte.');return;
        }
        parts.current.push(event.data);bytes.current+=event.data.size;
        if(Date.now()-startedAt.current>=MAX_DURATION_MS)stopRef.current('Arrêt automatique après 60 secondes.');
      };
      next.onerror=()=>{if(!mounted.current||generation.current!==currentGeneration)return;discard.current=true;parts.current=[];bytes.current=0;setError('Le navigateur a interrompu l’enregistrement. Cette vidéo n’a pas été conservée.');stopRef.current('Enregistrement interrompu.');};
      next.onstop=()=>{
        if(!mounted.current||generation.current!==currentGeneration)return;
        clearTimers();releaseTracks();recorder.current=null;
        if(!discard.current&&bytes.current){
          const result=new Blob(parts.current,{type:next.mimeType});parts.current=[];bytes.current=0;
          const url=URL.createObjectURL(result);objectUrl.current=url;
          setClip({url,bytes:result.size,filename:`capture-locale-${Date.now()}.${next.mimeType.startsWith('video/mp4')?'mp4':'webm'}`});
        }else{parts.current=[];bytes.current=0;if(!discard.current)setError('Aucune image n’a été enregistrée. Relancez le test et attendez un instant avant de l’arrêter.');}
        transition('FINISHED');
      };
      capture.getVideoTracks()[0].addEventListener('ended',()=>{if(generation.current===currentGeneration)stopRef.current('Le partage a été arrêté dans le navigateur.');},{once:true});
      startedAt.current=Date.now();next.start(500);setHasStarted(true);transition('RECORDING');
      timeout.current=setTimeout(()=>stopRef.current('Arrêt automatique après 60 secondes.'),MAX_DURATION_MS);
      ticker.current=setInterval(()=>{if(mounted.current)setElapsed(Math.min(60,Math.floor((Date.now()-startedAt.current)/1000)));if(Date.now()-startedAt.current>=MAX_DURATION_MS)stopRef.current('Arrêt automatique après 60 secondes.');},250);
    }catch(reason){
      capture?.getTracks().forEach(track=>track.stop());
      if(!mounted.current||generation.current!==currentGeneration)return;
      clearTimers();releaseTracks();recorder.current=null;
      const denied=reason instanceof DOMException&&reason.name==='NotAllowedError';
      setError(denied?'Le partage a été refusé ou annulé. Aucun écran n’est enregistré.':reason instanceof Error?reason.message:'La capture locale est indisponible.');transition('IDLE');
    }
  }
  function remove(){if(busy(phaseRef.current))return;releaseClip();setClip(null);setNotice('La vidéo locale a été supprimée de cet onglet.');transition('IDLE');}
  if(disabled&&!hasStarted)return null;
  return <section className="local-screen-capture" aria-label="Test de capture locale">
    {!open?<button type="button" onClick={()=>setOpen(true)}><MonitorPlay size={15}/>Tester la capture sur cet appareil</button>:<>
      <div className="local-capture-heading"><MonitorPlay size={18}/><strong>Test local · aucune vidéo envoyée</strong><span role="status">{phase==='RECORDING'?`Capture locale en cours · ${elapsed} / 60 s`:phase==='STARTING'?'Choix de l’écran…':phase==='STOPPING'?'Préparation de la vidéo…':phase==='FINISHED'?'Capture locale arrêtée':'Prêt à tester'}</span></div>
      <p>Ce test vérifie la capture sur votre appareil. Il n’est envoyé ni au serveur ni à votre enseignant. Seule la surface choisie est enregistrée, sans microphone ni webcam. Arrêt automatique après 60 secondes, vidéo limitée à 8 Mio.</p>
      {!supported?<p className="local-capture-error" role="alert">Ce navigateur ne propose pas la capture d’écran. Ouvrez la plateforme dans Chrome ou Edge sur un ordinateur, avec HTTPS ou localhost.</p>:null}
      {!busy(phase)&&!disabled&&<label className="local-capture-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>J’accepte de tester la capture locale de la surface que je vais choisir.</label>}
      {disabled&&<p>Le test local est fermé. Vous pouvez encore télécharger la vidéo déjà enregistrée.</p>}
      <div className="local-capture-actions">
        {!busy(phase)?<button type="button" disabled={disabled||!consent||!supported} onClick={()=>void start()}><MonitorPlay size={15}/>{clip?'Choisir un écran pour un nouveau test':'Choisir un écran et démarrer le test'}</button>:<button type="button" disabled={phase==='STOPPING'} onClick={()=>stop()}><Square size={15}/>{phase==='STARTING'?'Annuler la demande':'Arrêter le test local'}</button>}
        {clip&&<><a href={clip.url} download={clip.filename}><Download size={15}/>Télécharger la vidéo locale</a><button type="button" disabled={busy(phase)} onClick={remove}><Trash2 size={14}/>Supprimer la vidéo locale</button></>}
      </div>
      {phase==='RECORDING'&&<video ref={liveVideo} aria-label="Aperçu de la capture locale en direct" autoPlay muted playsInline/>}
      {clip&&<div className="local-capture-result"><video ref={savedVideo} aria-label="Vidéo de test locale" src={clip.url} controls playsInline preload="metadata" onError={()=>setError('La vidéo ne peut pas être lue dans ce navigateur. Vous pouvez la télécharger pour la vérifier.')}/><p>{Math.ceil(clip.bytes/1024)} Kio · Téléchargez votre vidéo avant de quitter la page ou de lancer un nouveau test. Elle ne fait pas partie de la copie du devoir.</p></div>}
      {notice&&<p>{notice}</p>}{error&&<p className="local-capture-error" role="alert">{error}</p>}
    </>}
  </section>;
}

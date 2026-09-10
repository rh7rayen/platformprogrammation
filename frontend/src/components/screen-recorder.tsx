'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Video,Square,CloudUpload,RefreshCw,Play} from 'lucide-react';
import {api,post} from '../lib/api';
import {LocalScreenCapture} from './local-screen-capture';
import './screen-recorder.css';

type Props={universityId:string;attemptId:string;disabled?:boolean;onLeaveReadyChange?:(ready:boolean)=>void};
type StorageStatus={state:string;message:string;max_chunk_bytes:number;retention_days:number;segment_seconds:number};
type Reserved={id:string;status:string;upload_url?:string;headers?:Record<string,string>};
type Segment={sequence:number;blob:Blob;reservation?:Reserved};
const message=(error:unknown)=>error instanceof Error?error.message:'Le transfert a échoué.';

export function ScreenRecorder({universityId,attemptId,disabled=false,onLeaveReadyChange}:Props){
  const base=`/universities/${universityId}/attempts/${attemptId}`;
  const [status,setStatus]=useState<StorageStatus|null>(null),[error,setError]=useState(''),[consent,setConsent]=useState(false);
  const [state,setState]=useState<'IDLE'|'STARTING'|'RECORDING'|'STOPPING'|'STOPPED'>('IDLE');
  const [uploaded,setUploaded]=useState(0),[pending,setPending]=useState(0),[surface,setSurface]=useState('');
  const [supported,setSupported]=useState(false);
  const [localReady,setLocalReady]=useState(true);
  useEffect(()=>{onLeaveReadyChange?.((state==='IDLE'||state==='STOPPED')&&pending===0&&localReady);},[state,pending,localReady,onLeaveReadyChange]);
  const stream=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null),session=useRef<string|null>(null);
  const sequence=useRef(0),queue=useRef<Segment[]>([]),processing=useRef<Promise<void>|null>(null),active=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),mounted=useRef(true),wantStop=useRef(false),stopSent=useRef(false);
  const capturingSegment=useRef(false);
  const flushRef=useRef<()=>Promise<void>>(async()=>{}),recordRef=useRef<()=>void>(()=>{}),stopRef=useRef<()=>void>(()=>{});

  const loadStatus=useCallback(()=>{void api<StorageStatus>(`${base}/recording`).then(data=>{if(mounted.current)setStatus(data);}).catch(e=>{if(mounted.current)setError(message(e));});},[base]);
  useEffect(()=>{mounted.current=true;setSupported(typeof navigator.mediaDevices?.getDisplayMedia==='function'&&typeof window.MediaRecorder==='function');loadStatus();return()=>{mounted.current=false;active.current=false;wantStop.current=true;if(timer.current)clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());};},[loadStatus]);
  useEffect(()=>{if(disabled)stopRef.current();},[disabled]);
  useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(active.current||queue.current.length){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[]);

  async function finish(){
    if(!wantStop.current||capturingSegment.current||queue.current.length||!session.current||stopSent.current)return;
    await post(`${base}/recording/sessions/${session.current}/stop`,{});stopSent.current=true;
    if(mounted.current)setState('STOPPED');
  }
  async function flush(){
    if(processing.current)return processing.current;
    processing.current=(async()=>{
      try{
        while(queue.current.length){
          const item=queue.current[0],path=`${base}/recording/sessions/${session.current}/chunks`;
          item.reservation??=await post<Reserved>(path,{sequence:item.sequence,size_bytes:item.blob.size,mime_type:item.blob.type.split(';')[0]});
          if(item.reservation.status!=='READY'){
            // Bytes go directly to the signed storage URL. The application API receives metadata only.
            const response=await fetch(item.reservation.upload_url!,{method:'PUT',headers:item.reservation.headers,body:item.blob,signal:AbortSignal.timeout(20000),credentials:'omit',referrerPolicy:'no-referrer'});
            if(!response.ok&&response.status>=500)throw new Error('Le stockage vidéo est indisponible. Réessayez le transfert.');
            // A retried PUT can report an existing object; the API independently checks size and MIME.
            await post(`${path}/${item.reservation.id}/complete`,{});
          }
          queue.current.shift();if(mounted.current){setPending(queue.current.length);setUploaded(v=>v+1);}
        }
        await finish();
      }catch(e){if(mounted.current)setError(`${message(e)} ${queue.current.length?'Les segments en attente restent dans cet onglet ; réessayez avant de le fermer.':'Réessayez pour confirmer l’arrêt de la session.'}`);stopRef.current();}
      finally{processing.current=null;}
    })();
    return processing.current;
  }
  flushRef.current=flush;
  function stop(){
    if(!session.current)return;
    active.current=false;wantStop.current=true;if(timer.current)clearTimeout(timer.current);
    if(mounted.current)setState('STOPPING');
    if(recorder.current?.state==='recording')recorder.current.stop();
    else void flushRef.current();
    stream.current?.getTracks().forEach(t=>t.stop());
  }
  stopRef.current=stop;
  function record(){
    if(!active.current||!stream.current)return;
    const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime){setError('Ce navigateur ne sait pas enregistrer dans un format pris en charge.');stop();return;}
    const next=new MediaRecorder(stream.current,{mimeType:mime,videoBitsPerSecond:250000});
    recorder.current=next;capturingSegment.current=true;const data:BlobPart[]=[];
    next.ondataavailable=event=>{if(event.data.size)data.push(event.data);};
    next.onerror=()=>{if(mounted.current)setError('Le navigateur a interrompu la capture.');stop();};
    next.onstop=()=>{
      capturingSegment.current=false;
      const blob=new Blob(data,{type:mime.split(';')[0]});
      if(blob.size){
        if(blob.size>(status?.max_chunk_bytes??4194304)||queue.current.length>=2){
          if(mounted.current)setError('La capture a été arrêtée : le segment dépasse la limite ou la connexion est trop lente. Le dernier segment n’a pas été transféré.');
          active.current=false;wantStop.current=true;stream.current?.getTracks().forEach(t=>t.stop());if(mounted.current)setState('STOPPING');
        }else{queue.current.push({sequence:sequence.current++,blob});if(mounted.current)setPending(queue.current.length);}
      }
      void flushRef.current();
      if(active.current)recordRef.current();
    };
    next.start();timer.current=setTimeout(()=>{if(next.state==='recording')next.stop();},15000);
  }
  recordRef.current=record;
  async function start(){
    if(!consent||status?.state!=='READY'||disabled||!localReady)return;
    setError('');setState('STARTING');
    let capture:MediaStream|undefined;
    try{
      // Must remain inside this explicit click, before the first unrelated await.
      capture=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:10,width:1280,height:720},audio:false});
      if(!mounted.current){capture.getTracks().forEach(t=>t.stop());return;}
      stream.current=capture;
      const created=await post<{id:string}>(`${base}/recording/sessions`,{consented:true,consent_version:'screen-v1'});
      if(!mounted.current){capture.getTracks().forEach(t=>t.stop());await post(`${base}/recording/sessions/${created.id}/stop`,{});return;}
      session.current=created.id;active.current=true;wantStop.current=false;stopSent.current=false;sequence.current=0;queue.current=[];
      setUploaded(0);setPending(0);setSurface(capture.getVideoTracks()[0].getSettings().displaySurface??'surface choisie');setState('RECORDING');
      capture.getVideoTracks()[0].addEventListener('ended',()=>stopRef.current(),{once:true});recordRef.current();
    }catch(e){capture?.getTracks().forEach(t=>t.stop());setState('IDLE');setError(message(e));}
  }
  return <section className="screen-recorder" aria-label="Enregistrement d’écran">
    <div className="recording-title"><Video size={17}/><strong>Enregistrement d’écran</strong><span className={state==='RECORDING'?'recording-live':'recording-label'}>{state==='RECORDING'?'● Capture en cours':state==='STOPPING'?'Transfert final':state==='STOPPED'?'Capture arrêtée':'Sur consentement'}</span></div>
    {status?.state!=='READY'?<p>{status?.message??'Vérification du stockage vidéo…'} {localReady?'Aucun écran n’est capturé pour l’enseignant.':'Un test de capture locale est en cours ; aucun transfert vers l’enseignant.'}</p>:<>
      <p>Seule la surface choisie dans le navigateur est enregistrée, sans microphone ni webcam. Les segments sont stockés dans un espace cloud privé. Les enseignants affectés au devoir peuvent les consulter pendant {status.retention_days} jours.</p>
      {state==='IDLE'||state==='STOPPED'?<label className="recording-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>J’accepte cet enregistrement et je peux l’arrêter à tout moment.</label>:null}
      {!supported?<p>La capture nécessite un navigateur compatible et une connexion HTTPS (ou localhost).</p>:null}
      <div className="recording-actions">
        {state==='IDLE'||state==='STOPPED'?<button type="button" onClick={()=>void start()} disabled={!consent||!supported||disabled||pending>0||!localReady}><Video size={15}/>Choisir un écran et enregistrer</button>:<button type="button" onClick={stop} disabled={state==='STARTING'||state==='STOPPING'}><Square size={15}/>Arrêter la capture</button>}
        <span><CloudUpload size={15}/>{uploaded} segment(s) reçu(s){pending?` · ${pending} en attente`:''}</span>
        {error&&state==='STOPPING'?<button type="button" onClick={()=>{setError('');void flushRef.current();}}><RefreshCw size={14}/>Réessayer le transfert</button>:null}
      </div>
      {surface?<p className="recording-hint">Surface choisie : {surface}. Une interruption ou un changement de surface ne constitue pas une preuve de fraude.</p>:null}
    </>}
    {error?<p className="recording-error" role="alert">{error}</p>:null}
    {status?.state!=='READY'?<button type="button" onClick={loadStatus}><RefreshCw size={14}/>Vérifier à nouveau</button>:null}
    <LocalScreenCapture disabled={disabled||status?.state==='READY'||(!status&&!error)} onLeaveReadyChange={setLocalReady}/>
  </section>;
}

type ReviewSession={id:string;status:string;started_at:string;lease_until:string;expires_at:string;chunks:{id:string;sequence:number;size_bytes:number;status:string;created_at:string}[]};
export function RecordingsReview({universityId,attemptId}:Omit<Props,'disabled'>){
  const [data,setData]=useState<{data:ReviewSession[];configured:boolean;notice:string}|null>(null),[error,setError]=useState(''),[video,setVideo]=useState<{url:string;label:string}|null>(null),[loading,setLoading]=useState(false);
  const base=`/universities/${universityId}/attempts/${attemptId}`;
  const load=useCallback(()=>{setError('');void api<{data:ReviewSession[];configured:boolean;notice:string}>(`${base}/recordings`).then(setData).catch(e=>setError(message(e)));},[base]);
  useEffect(load,[load]);
  async function play(id:string,label:string){setLoading(true);setError('');try{const result=await api<{url:string}>(`${base}/recordings/${id}/play`);setVideo({url:result.url,label});}catch(e){setError(message(e));}finally{setLoading(false);}}
  return <section className="recordings-review" aria-label="Vidéos de la tentative"><div className="recording-title"><Video size={18}/><strong>Captures de l’étudiant</strong><button type="button" onClick={load}><RefreshCw size={14}/>Actualiser</button></div>
    <p>{data?.notice??'Chargement des métadonnées vidéo…'}</p>{data&&!data.configured?<p>Le stockage cloud n’est pas configuré sur ce serveur.</p>:null}
    {data?.data.length===0?<p>Aucun enregistrement n’a été reçu pour cette tentative.</p>:null}
    {data?.data.map((s,index)=><div className="recording-session" key={s.id}><strong>Session {index+1} · {new Date(s.started_at).toLocaleString('fr-FR')}</strong><p>{s.status==='RECORDING'?(Date.parse(s.lease_until)>Date.now()?'Capture active':'Capture interrompue (connexion perdue)'):s.status==='STOPPED'?'Capture arrêtée':'Capture interrompue'} · conservation jusqu’au {new Date(s.expires_at).toLocaleDateString('fr-FR')}</p><div className="recording-clips">{s.chunks.map(c=><button type="button" key={c.id} disabled={c.status!=='READY'||loading||Date.parse(s.expires_at)<=Date.now()} onClick={()=>void play(c.id,`Session ${index+1}, segment ${c.sequence+1}`)}><Play size={13}/>{c.sequence+1} · {c.status==='READY'?`${Math.ceil(c.size_bytes/1024)} Kio`:c.status==='DELETED'?'Expiré':'Non reçu'}</button>)}</div></div>)}
    {video?<div className="recording-player"><strong>{video.label}</strong><video key={video.url} src={video.url} controls playsInline preload="metadata" controlsList="nodownload" onError={()=>setError('La lecture a échoué ou le lien a expiré. Cliquez de nouveau sur le segment.')}/><p>Le lien de lecture expire après deux minutes ; cliquez sur le segment pour le renouveler.</p></div>:null}
    {error?<p className="recording-error" role="alert">{error}</p>:null}
  </section>;
}

'use client';
import { useEffect,useState } from 'react';
import { BookOpen,Building2,CalendarDays,ChevronDown,ChevronRight,ClipboardList,GraduationCap,LayoutDashboard,Link2,LogOut,Menu,MonitorPlay,Search,Settings2,ShieldCheck,Sparkles,Users,X } from 'lucide-react';
import { roleLabels,type SessionProfile } from '@uniexam/contracts';
import { api } from '@/lib/api';
import { Login } from './login';
import { Dashboard } from './dashboard';
import { CatalogView } from './catalog-view';
import { PeopleView } from './people-view';
import { AssignmentsView } from './assignments-view';
import { AiView } from './ai-view';
import { ExamsView } from './exams-view';
import { AttemptWorkspace } from './attempt-workspace';
import { RoadmapView } from './roadmap-view';
import { ErrorNotice,Loading,Modal,initials } from './ui';
const navigation=[
  {id:'dashboard',name:'Vue d’ensemble',icon:LayoutDashboard},
  {id:'exams',name:'Devoirs & examens',icon:ClipboardList},
  {id:'structure',name:'Structure universitaire',icon:Building2},
  {id:'classes',name:'Classes & groupes',icon:Users},
  {id:'subjects',name:'Matières',icon:BookOpen},
  {id:'course_offerings',name:'Enseignements',icon:GraduationCap},
  {id:'people',name:'Équipe & étudiants',icon:Users},
  {id:'assignments',name:'Affectations',icon:Link2},
];
export function Workspace() {
  const [profile,setProfile]=useState<SessionProfile|null>(),[university,setUniversity]=useState(''),[view,setView]=useState('exams');
  const [attempt,setAttempt]=useState('');
  useEffect(()=>{const query=new URLSearchParams(window.location.search);if(query.get('view')==='exams'){setView('exams');const id=query.get('attempt');if(id&&/^[0-9a-f-]{36}$/i.test(id))setAttempt(id);}},[]);
  function openAttempt(id:string){setAttempt(id);setView('exams');window.history.replaceState(null,'',id?'?view=exams&attempt='+id:'?view=exams');}
  const [mobile,setMobile]=useState(false),[account,setAccount]=useState(false),[expired,setExpired]=useState(false),[error,setError]=useState('');
  async function load(){setError('');try{const p=await api<SessionProfile>('/auth/me');setProfile(p);setUniversity(p.universities[0]?.id??'');setExpired(false);}catch{setProfile(null);}}
  useEffect(()=>{load();const handle=()=>{setProfile(null);setUniversity('');setExpired(true);};window.addEventListener('session-expired',handle);return()=>window.removeEventListener('session-expired',handle);},[]);
  async function logout(){try{await api('/auth/logout',{method:'POST',body:'{}'});}finally{setProfile(null);setUniversity('');setView('exams');setAttempt('');window.history.replaceState(null,'','?view=exams');setAccount(false);}}
  function navigate(next:string){setView(next);setAttempt('');window.history.replaceState(null,'',next==='exams'?'?view=exams':'/');setMobile(false);window.scrollTo({top:0,behavior:'instant'});}
  if(profile===undefined)return <main className="initial-loading"><GraduationCap size={42}/><Loading label="Ouverture de votre campus…"/></main>;
  if(profile===null)return <Login onLogin={load} expired={expired}/>;
  const roles=profile.assignments.filter(a=>a.university_id===university).map(a=>a.role);
  const admin=roles.includes('UNIVERSITY_ADMIN'),manager=admin||roles.includes('ACADEMIC_MANAGER'),staff=manager||roles.includes('TEACHER')||roles.includes('SCHOOL_OFFICE');
  const universityRecord=profile.universities.find(u=>u.id===university);
  const visibleNav=navigation.filter(item=>staff||!['people','assignments','structure'].includes(item.id));
  const label=[...navigation,{id:'ai',name:'Assistant IA'},{id:'roadmap',name:'Devoirs & examens'},{id:'monitoring',name:'Surveillance'}].find(n=>n.id===view)?.name??'Mon espace';
  if(view==='exams'&&attempt&&university)return <AttemptWorkspace key={attempt} u={university} id={attempt} studentName={profile.user.full_name} onBack={()=>openAttempt('')}/>;
  return <div className="app-shell"><a className="skip-link" href="#main-content">Aller au contenu</a>{mobile&&<button className="mobile-scrim" aria-label="Fermer le menu" onClick={()=>setMobile(false)}/>}<aside className={`sidebar ${mobile?'open':''}`}><button className="brand" onClick={()=>navigate('dashboard')}><span className="brand-icon"><GraduationCap size={24}/></span>uni<span>exam</span><i/></button><div className="university-switch"><span className="university-logo"><Building2 size={19}/></span><label><span>ESPACE UNIVERSITAIRE</span><select aria-label="Université active" value={university} onChange={e=>{setUniversity(e.target.value);setView('dashboard');}}>{profile.universities.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label></div><div className="nav-label">CAMPUS</div><nav aria-label="Navigation principale">{visibleNav.map(item=><button className={`nav-item ${view===item.id?'active':''}`} key={item.id} aria-current={view===item.id?'page':undefined} onClick={()=>navigate(item.id)}><item.icon size={19}/><span>{item.name}</span>{view===item.id&&<span className="nav-active-dot"/>}</button>)}<button className={`nav-item ai-nav ${view==='ai'?'active':''}`} onClick={()=>navigate('ai')}><Sparkles size={19}/><span>Assistant IA</span><span className="mini-badge">IA</span></button><div className="nav-label upcoming-label">OUTILS D’ÉVALUATION</div><button className={`nav-item ${view==='monitoring'?'active':''}`} onClick={()=>navigate('monitoring')}><MonitorPlay size={19}/><span>Surveillance</span></button></nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="small-icon"><ShieldCheck size={20}/></span><strong>Votre espace, vos accès.</strong><p>Les données visibles dépendent de votre rôle et de vos affectations.</p></div><button className="user-button" onClick={()=>setAccount(true)}><span className="avatar mint">{initials(profile.user.full_name)}</span><span><strong>{profile.user.full_name}</strong><small>{roleLabels[roles[0]]??'Compte universitaire'}</small></span><ChevronDown size={15}/></button></div></aside><div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Ouvrir le menu" onClick={()=>setMobile(true)}><Menu size={22}/></button><span>Mon espace</span><ChevronRight size={14}/><strong>{label}</strong></div><div className="topbar-right">{profile.mode==='demo'&&<span className="demo-tag"><span className="status-dot"/>Données de démonstration</span>}<span className="date-label"><CalendarDays size={16}/>{new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:universityRecord?.timezone??'Africa/Tunis'}).format(new Date())}</span><button className="avatar small mint" aria-label="Mon profil" onClick={()=>setAccount(true)}>{initials(profile.user.full_name)}</button></div></header><main id="main-content" className="main-content">{error&&<ErrorNotice message={error}/>} {!university?<div className="empty"><h1>Votre compte attend une affectation.</h1><p>Contactez votre établissement pour activer vos accès.</p><button className="button secondary" onClick={logout}>Se déconnecter</button></div>:view==='dashboard'?<Dashboard key={university} profile={profile} u={university} navigate={navigate}/>:['structure','classes','subjects','course_offerings'].includes(view)?<CatalogView key={`${university}-${view}`} u={university} initial={view} canManage={manager}/>:view==='people'?<PeopleView key={university} u={university} canManage={admin} currentId={profile.user.id}/>:view==='assignments'?<AssignmentsView key={university} u={university} canManage={manager||roles.includes('SCHOOL_OFFICE')}/>:view==='exams'?<ExamsView key={university} u={university} isStudent={roles.includes('STUDENT')} onAttempt={openAttempt}/>:view==='ai'?<AiView key={university} u={university} canGenerate={manager||roles.includes('TEACHER')}/>:<RoadmapView monitoring={view==='monitoring'}/>}</main></div>{account&&<Modal title="Mon compte" onClose={()=>setAccount(false)}><div className="account-profile"><span className="avatar large mint">{initials(profile.user.full_name)}</span><h3>{profile.user.full_name}</h3><p>{profile.user.email}</p></div><dl className="details-list"><div><dt>Université</dt><dd>{universityRecord?.name??'En attente d’affectation'}</dd></div><div><dt>Rôles</dt><dd>{roles.map(role=>roleLabels[role]).join(', ')||'Aucun rôle actif'}</dd></div><div><dt>Session</dt><dd>Durée maximale : une heure</dd></div></dl><button className="button secondary full-width" onClick={logout}><LogOut size={17}/>Se déconnecter</button></Modal>}</div>;
}

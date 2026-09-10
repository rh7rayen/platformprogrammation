'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, LoaderCircle, X } from 'lucide-react';
export function Loading({label='Chargement des données…'}:{label?:string}) { return <div className="loading" role="status"><LoaderCircle size={22} className="spin"/>{label}</div>; }
export function ErrorNotice({message}:{message:string}) { return <div className="notice error" role="alert"><AlertCircle size={18}/><span>{message}</span></div>; }
export function Empty({title,children}:{title:string;children?:ReactNode}) { return <div className="empty"><div className="empty-mark">↗</div><h3>{title}</h3><p>{children}</p></div>; }
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}><div className="modal-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Fermer" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
export function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}) {return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;}
export function initials(name:string){return name.split(' ').slice(0,2).map(part=>part[0]).join('');}

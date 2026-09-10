import type { Metadata } from 'next';
import './globals.css';
import './exams.css';
import './exam-platform.css';
export const metadata:Metadata={title:'UniExam — Votre espace universitaire',description:'Enseignements, organisation universitaire et assistance pédagogique.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="fr"><body>{children}</body></html>;}

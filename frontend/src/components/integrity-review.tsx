'use client';
import {useState} from 'react';
import {ScanSearch} from 'lucide-react';
import {post} from '../lib/api';
import './integrity-review.css';
type Match={question_title:string;runtime:string;jaccard_percent:number;overlap_percent:number;shared_sequences:number;left:{student_name:string;excerpt:string};right:{student_name:string;excerpt:string}};
type Report={matches:Match[];matching_pairs:number;comparisons:number;ignored_answers:number;truncated_answers:number;copies_analyzed:number;code_answers:number;notice:string;limitations:string;method:{sequence_tokens:number;max_tokens_per_answer:number}};
export function IntegrityReview({u,assessmentId}:{u:string;assessmentId:string}){
  const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function analyze(){setBusy(true);setError('');try{setReport(await post<Report>(`/universities/${u}/assessments/${assessmentId}/integrity`,{}));}catch(e){setError(e instanceof Error?e.message:'Analyse indisponible.');}finally{setBusy(false);}}
  return <section className="integrity-review" aria-label="Comparaison des copies"><div className="integrity-heading"><ScanSearch size={19}/><div><strong>Comparer les copies de code</strong><p>Analyse locale des séquences communes, après retrait du code initial.</p></div><button type="button" disabled={busy} onClick={()=>void analyze()}>{busy?'Analyse en cours…':'Analyser les copies remises'}</button></div>
    <p>Un outil de comparaison ne permet pas d’attribuer un code à une IA. La décision pédagogique reste à l’enseignant.</p>
    {error?<p className="integrity-error" role="alert">{error}</p>:null}
    {report?<><p>{report.copies_analyzed} copie(s) · {report.comparisons} comparaison(s) · {report.matching_pairs} paire(s) avec des séquences communes suffisantes{report.matching_pairs>50?' · 50 premières affichées':''}</p><p className="integrity-notice">{report.notice}</p>
      {!report.matches.length?<p>Aucune paire ne dépasse les seuils de cette méthode. Ce résultat ne garantit pas l’absence de sources externes.</p>:null}
      {report.matches.map((match,index)=><article className="integrity-match" key={index}><div><strong>{match.left.student_name} / {match.right.student_name}</strong><span>{match.question_title} · {match.runtime}</span></div><p><strong>{match.jaccard_percent} %</strong> de similarité Jaccard · {match.overlap_percent} % de recouvrement de la copie la plus courte · {match.shared_sequences} séquences communes de {report.method.sequence_tokens} tokens.</p><details><summary>Voir deux extraits de code commun</summary><div className="integrity-excerpts"><pre><code>{match.left.excerpt}</code></pre><pre><code>{match.right.excerpt}</code></pre></div></details></article>)}
      <details><summary>Méthode et limites</summary><p>Jaccard = séquences communes / ensemble des séquences distinctes. Le recouvrement compare aux séquences de la réponse la plus courte. Commentaires et espaces sont ignorés ; les identifiants et les valeurs sont conservés.</p><p>{report.limitations}</p><p>{report.ignored_answers} réponse(s) trop courte(s) ou composée(s) du squelette ; {report.truncated_answers} réponse(s) limitée(s) aux {report.method.max_tokens_per_answer} premiers tokens.</p></details></>:null}
  </section>;
}

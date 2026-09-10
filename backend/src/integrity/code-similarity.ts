import {createHash} from 'node:crypto';
import {webProjectSchema} from '../../../packages/contracts/src/runtimes';
import {isFrameworkRuntime,parseFrameworkProject} from '../../../packages/contracts/src/projects';

export type CodeSample={submission_id:string;student_id:string;student_name:string;question_id:string;question_title:string;runtime:string;starter_code:string;answer_text:string};
type Token={value:string;offset:number};
type Fingerprint={sample:CodeSample;source:string;hashes:Map<string,number>;truncated:boolean};
export type CodeMatch={question_id:string;question_title:string;runtime:string;left:{submission_id:string;student_name:string;excerpt:string};right:{submission_id:string;student_name:string;excerpt:string};jaccard_percent:number;overlap_percent:number;shared_sequences:number};
const SHINGLE_WIDTH=5,MAX_TOKENS=3500,MIN_SEQUENCES=12,MAX_RESULTS=50;

function source(text:string,runtime:string){
  if(runtime!=='web'&&!isFrameworkRuntime(runtime))return text;
  try{const project=isFrameworkRuntime(runtime)?parseFrameworkProject(text,runtime):webProjectSchema.parse(JSON.parse(text));return Object.entries(project.files).map(([name,code])=>`\n/* ${name} */\n${code}`).join('\n');}catch{return text;}
}
// A deliberately transparent lexical comparison, not a parser or a detector of authorship.
function tokens(text:string,runtime:string):{tokens:Token[];truncated:boolean}{
  const result:Token[]=[];
  const hashComments=['python','php','ruby','bash','symfony','laravel'].includes(runtime);
  const sqlComments=['sql','mysql','oracle_plsql'].includes(runtime),htmlComments=runtime==='web'||isFrameworkRuntime(runtime);
  const slashComments=!['python','ruby','bash'].includes(runtime)&&!sqlComments;
  const pieces=[`"(?:\\\\.|[^"\\\\])*"`,`'(?:\\\\.|[^'\\\\])*'`,'`(?:\\\\.|[^`\\\\])*`'];
  if(htmlComments)pieces.push('<!--[^]*?-->');
  if(slashComments)pieces.push('/\\*[^]*?\\*/','//[^\\n]*');
  if(hashComments)pieces.push('#[^\\n]*');
  if(sqlComments)pieces.push('--[^\\n]*','/\\*[^]*?\\*/');
  pieces.push('[\\p{L}_$][\\p{L}\\p{N}_$]*','[0-9]+(?:\\.[0-9]+)?','[^\\s]');
  const pattern=new RegExp(pieces.join('|'),'gu');
  for(const match of text.matchAll(pattern)){
    const value=match[0];
    if((hashComments&&value.startsWith('#'))||(slashComments&&(value.startsWith('//')||value.startsWith('/*')))||(sqlComments&&(value.startsWith('--')||value.startsWith('/*')))||(htmlComments&&value.startsWith('<!--')))continue;
    if(result.length===MAX_TOKENS)return {tokens:result,truncated:true};
    result.push({value,offset:match.index});
  }
  return {tokens:result,truncated:false};
}
function shingles(input:Token[]){
  const hashes=new Map<string,number>();
  for(let i=0;i<=input.length-SHINGLE_WIDTH;i++){
    const digest=createHash('sha256').update(JSON.stringify(input.slice(i,i+SHINGLE_WIDTH).map(t=>t.value))).digest('hex').slice(0,24);
    if(!hashes.has(digest))hashes.set(digest,input[i].offset);
  }
  return hashes;
}
function fingerprint(sample:CodeSample):Fingerprint{
  const code=source(sample.answer_text,sample.runtime),tokenized=tokens(code,sample.runtime);
  const hashes=shingles(tokenized.tokens),starter=shingles(tokens(source(sample.starter_code,sample.runtime),sample.runtime).tokens);
  for(const hash of starter.keys())hashes.delete(hash);
  return {sample,source:code,hashes,truncated:tokenized.truncated};
}
function excerpt(source:string,offset:number){return source.slice(Math.max(0,offset-35),offset+145).trim();}
export function compareCodeSamples(samples:CodeSample[]){
  const groups=new Map<string,Fingerprint[]>();let ignored=0,truncated=0,comparisons=0;
  for(const sample of samples){const value=fingerprint(sample);if(value.truncated)truncated++;
    if(value.hashes.size<MIN_SEQUENCES){ignored++;continue;}
    const group=groups.get(sample.question_id)??[];group.push(value);groups.set(sample.question_id,group);
  }
  const matches:CodeMatch[]=[];let matchingPairs=0;
  for(const group of groups.values())for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
    const a=group[i],b=group[j];if(a.sample.student_id===b.sample.student_id||a.sample.runtime!==b.sample.runtime)continue;comparisons++;
    let shared=0,first:string|undefined;
    for(const hash of (a.hashes.size<=b.hashes.size?a.hashes:b.hashes).keys())if(a.hashes.has(hash)&&b.hashes.has(hash)){shared++;first??=hash;}
    const union=a.hashes.size+b.hashes.size-shared,jaccard=shared/union,overlap=shared/Math.min(a.hashes.size,b.hashes.size);
    if(shared<MIN_SEQUENCES||(jaccard<.35&&overlap<.65)||!first)continue;
    matchingPairs++;
    matches.push({question_id:a.sample.question_id,question_title:a.sample.question_title,runtime:a.sample.runtime,
      left:{submission_id:a.sample.submission_id,student_name:a.sample.student_name,excerpt:excerpt(a.source,a.hashes.get(first)!)},
      right:{submission_id:b.sample.submission_id,student_name:b.sample.student_name,excerpt:excerpt(b.source,b.hashes.get(first)!)},
      jaccard_percent:Math.round(jaccard*1000)/10,overlap_percent:Math.round(overlap*1000)/10,shared_sequences:shared});
    matches.sort((x,y)=>y.jaccard_percent-x.jaccard_percent||y.shared_sequences-x.shared_sequences);if(matches.length>MAX_RESULTS)matches.pop();
  }
  return {matches,matching_pairs:matchingPairs,comparisons,ignored_answers:ignored,truncated_answers:truncated,
    method:{name:'TOKEN_SHINGLES',sequence_tokens:SHINGLE_WIDTH,starter_excluded:true,max_tokens_per_answer:MAX_TOKENS,minimum_shared_sequences:MIN_SEQUENCES,max_results:MAX_RESULTS}};
}

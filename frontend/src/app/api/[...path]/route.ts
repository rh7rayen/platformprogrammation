import { NextRequest, NextResponse } from 'next/server';
import { readLimitedText, RequestBodyError } from '../../../lib/server-request-body';
const cookieName=process.env.NODE_ENV==='production'?'__Host-uniexam_session':'uniexam_session';
const apiUrl=process.env.API_URL||'http://127.0.0.1:4000';
const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict' as const,path:'/'};
function reject(message:string,status:number) {
  return NextResponse.json({message},{status,headers:{'Cache-Control':'no-store'}});
}
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}) {
  const {path}=await context.params;
  if(!['auth','universities','health'].includes(path[0])) return reject('Route inconnue.',404);
  const mutation=!['GET','HEAD'].includes(request.method);
  if(mutation && request.headers.get('origin')!==new URL(request.url).origin) return reject('Origine non autorisée.',403);
  const headers:Record<string,string>={'Content-Type':'application/json'};
  const token=request.cookies.get(cookieName)?.value;
  if(token) headers.Authorization=`Bearer ${token}`;
  let body:string|undefined;
  try { body=mutation?await readLimitedText(request):undefined; }
  catch(error) { return error instanceof RequestBodyError?reject(error.message,error.status):reject('Demande interrompue.',400); }
  const isLogin=request.method==='POST'&&path.length===2&&path[0]==='auth'&&['login','demo'].includes(path[1]);
  const isLogout=request.method==='POST'&&path.length===2&&path[0]==='auth'&&path[1]==='logout';
  let response:NextResponse;
  try {
    const upstream=await fetch(`${apiUrl}/api/v1/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`,{method:request.method,headers,body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(path.includes('ai')?55000:15000)});
    const data=await upstream.json();
    if(isLogin && upstream.ok) {
      if(typeof data.access_token!=='string'||data.access_token.length<32||data.access_token.length>4096||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw new Error('Invalid session response');
      response=NextResponse.json({authenticated:true});
      response.cookies.set(cookieName,data.access_token,{...cookieOptions,maxAge:Math.min(data.expires_in,3600)});
    } else response=NextResponse.json(data,{status:upstream.status});
    if(upstream.status===401 || isLogout) response.cookies.set(cookieName,'',{...cookieOptions,maxAge:0});
  } catch {
    response=NextResponse.json({message:'Le serveur est indisponible. Vérifiez que l’API UniExam est démarrée.'},{status:503});
    if(isLogout) response.cookies.set(cookieName,'',{...cookieOptions,maxAge:0});
  }
  response.headers.set('Cache-Control','no-store');
  return response;
}
export {proxy as GET,proxy as POST,proxy as PATCH,proxy as PUT,proxy as DELETE};

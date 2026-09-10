export class ApiError extends Error { constructor(message:string,readonly status:number){super(message);} }
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
  const response=await fetch(`/api${path}`,{...options,headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});
  const data=await response.json();
  if(!response.ok) {
    if(response.status===401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data.message||'La demande a échoué.',response.status);
  }
  return data;
}
export const post=<T>(path:string,data:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(data)});

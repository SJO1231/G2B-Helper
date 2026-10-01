import type { GatewayRequest, GatewayResponse } from '../../packages/contracts/src/index';
export async function request<T=any>(command:string,payload:Record<string,unknown>={},requestId=crypto.randomUUID()):Promise<T> {
  const envelope:GatewayRequest={protocolVersion:1,requestId,command,payload};
  let response:GatewayResponse<T>;
  async function dispatch():Promise<GatewayResponse<T>> {
   if(typeof chrome!=='undefined'&&chrome.runtime?.id){
    return chrome.runtime.sendMessage({type:'gateway',request:envelope});
   }else{
    const token=new URL(location.href).searchParams.get('token')??sessionStorage.getItem('pce-token')??'';
    if(token)sessionStorage.setItem('pce-token',token);
    const result=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(envelope)});
    if(!result.ok)throw new Error(`로컬 연결 실패 (${result.status}). 데스크탑 실행 상태를 확인하세요.`);
    return result.json();
   }
  }
  try { response=await dispatch(); }
  catch { response=await dispatch(); } // Same request ID: retry cannot replay a committed write.
  if(response?.error?.code==='NATIVE_CONNECTION')response=await dispatch();
  if(!response)throw new Error('실행부의 응답이 없습니다.');
  if(response.error)throw new Error(typeof response.error==='string'?response.error:`${response.error.message} [${response.error.code}]`);
  return response.result as T;
}

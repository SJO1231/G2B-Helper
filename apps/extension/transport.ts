export const sourceTabId=Number(new URLSearchParams(location.search).get('sourceTabId'))||undefined;
export async function extensionCommand(message:Record<string,unknown>){
  const result=await chrome.runtime.sendMessage({...message,tabId:sourceTabId});
  if(result?.error)throw new Error(typeof result.error==='string'?result.error:result.error.message);
  return result;
}
export const openSurface=(surface:string,context:Record<string,unknown>={})=>extensionCommand({type:'surface.open',surface,...context});

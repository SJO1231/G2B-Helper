/** Serialized into MAIN world. Read controls and declared events without firing them. */
export function inspectPage(){
 const controls:any[]=[],links:any[]=[],warnings:string[]=[];
 const util=(window as any).WebSquare?.util;
 const scalar=(value:any)=>value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
 for(const element of Array.from(document.querySelectorAll<HTMLElement>('[id]'))){
  try{
   const component=util?.getComponentById(element.id);
   if(!component&&!element.matches('input,select,textarea,button,a'))continue;
   const events=Array.from(element.attributes).filter(attribute=>/^on/i.test(attribute.name)||attribute.name.includes('ev:')).map(attribute=>attribute.name);
   controls.push({id:element.id,tag:element.tagName.toLowerCase(),plugin:component?.getPluginName?.()||'',ref:component?.getRef?.()||'',label:element.getAttribute('aria-label')||element.getAttribute('title')||element.textContent?.trim().slice(0,120)||'',value:scalar(component?.getValue?component.getValue():(element as HTMLInputElement).value),events});
  }catch(error){warnings.push(element.id+': '+String(error));}
 }
 for(const element of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))){try{const url=new URL(element.href,location.href);if(['http:','https:'].includes(url.protocol))links.push({label:element.textContent?.trim()||url.href,url:url.href});}catch{}}
 return {url:location.href,title:document.title,controls,links,warnings};
}

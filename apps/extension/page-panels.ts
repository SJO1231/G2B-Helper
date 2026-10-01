/** v4.1-style page windows. Extension frames isolate feature styles and permissions. */
export function installPagePanels(anchor:HTMLElement, root:ShadowRoot){
 const windows=new Map<string,HTMLElement>();let layer=10;
 const style=document.createElement('style');style.textContent=`.pce-window{position:fixed;display:flex;flex-direction:column;background:var(--pce-bg);border:1px solid var(--pce-border);border-radius:10px;box-shadow:0 12px 40px #0008;overflow:hidden;min-width:320px;min-height:180px;resize:none;color:var(--pce-text);font:12px 'Malgun Gothic',sans-serif}.pce-window .window-bar{height:36px;flex:none;display:flex;align-items:center;gap:5px;background:var(--pce-panel);padding:0 8px;cursor:move;touch-action:none}.window-bar strong{flex:1}.window-bar button{background:transparent;border:0;color:var(--pce-text);padding:5px 8px;cursor:pointer}.pce-window iframe{width:100%;height:100%;flex:1;border:0;min-height:0;background:var(--pce-bg)}.pce-window.minimized{min-height:36px;height:36px!important;resize:none}.pce-window.minimized iframe{display:none}.pce-window.sticky-window{background:#fff2b8;border-color:#d8c789}.sticky-window .window-bar{background:#efe0a0;color:#51492b}.sticky-window .window-bar button{color:#51492b}`;root.append(style);
 const titles:Record<string,string>={settings:'설정',aggregate:'Excel 취합',sql:'SQL 조회',backup:'백업 · 복원',db:'DB 브라우저',extract:'임시 추출',notes:'메모 · 일정',launcher:'런처',documents:'문서 생성',explorer:'업무 폴더',dictionary:'사전 관리',collection:'수집 관리',relations:'관계 · 통합 뷰',work:'업무 화면 설정'};
 const focus=(node:HTMLElement)=>{node.style.zIndex=String(++layer);};
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.type==='surface.closed'){windows.get(message.panelId)?.remove();windows.delete(message.panelId);reply({closed:true});return;}
  if(message.type!=='surface.present')return;
  const url=new URL(message.url);if(!url.href.startsWith(chrome.runtime.getURL(''))||!url.pathname.endsWith('/feature.html'))return;
  const key=message.panelId as string;const old=windows.get(key);if(old){old.classList.remove('minimized');focus(old);reply({focused:true});return;}
  const node=document.createElement('div');node.className='pce-window'+(message.surface==='notes'&&url.searchParams.get('mode')==='sticky'?' sticky-window':'');node.dataset.panel=key;if(message.surface==='notes'&&url.searchParams.get('mode')==='sticky')node.style.resize='both';node.setAttribute('role','region');node.setAttribute('aria-label',titles[message.surface]||'PCE');
  const sticky=message.surface==='notes'&&url.searchParams.get('mode')==='sticky';
  const anchorRect=anchor.getBoundingClientRect(),available=Math.max(anchorRect.left-18,innerWidth-anchorRect.right-18);
  const width=Math.min(message.surface==='db'?innerWidth-36:available>=650?available:innerWidth-16,sticky?330:message.surface==='settings'?380:['db','dictionary','collection','extract','aggregate'].includes(message.surface)?1320:900,innerWidth-16),height=Math.min(sticky?350:message.surface==='settings'?220:700,innerHeight-24),rect=anchor.getBoundingClientRect(),offset=windows.size%6*10;
  Object.assign(node.style,{width:width+'px',height:height+'px',left:Math.max(8,Math.min(innerWidth-width-8,rect.left-width-10+offset))+'px',top:Math.max(8,Math.min(innerHeight-height-8,rect.top+offset))+'px'});
  const bar=document.createElement('div');bar.className='window-bar';const title=document.createElement('strong');title.textContent=titles[message.surface]||'PCE';bar.append(title);
  const frame=document.createElement('iframe');frame.src=url.href;frame.title=title.textContent;node.append(bar,frame);root.append(node);windows.set(key,node);focus(node);
  const button=(label:string,text:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=text;b.title=label;b.setAttribute('aria-label',label);b.onclick=event=>{if(event.isTrusted)run();};bar.append(b);};
  button('기능창 접기 · 펼치기','−',()=>node.classList.toggle('minimized'));
  let normal:string|undefined;button('기능창 최대화 · 복원','□',()=>{if(normal){node.style.cssText=normal;normal=undefined;}else{normal=node.style.cssText;Object.assign(node.style,{left:'8px',top:'8px',width:innerWidth-16+'px',height:innerHeight-16+'px'});}node.classList.remove('minimized');focus(node);});
  button('기능창 닫기','×',()=>{void chrome.runtime.sendMessage({type:'surface.requestClose',panelId:key});});
  let drag:{x:number;y:number;left:number;top:number}|undefined;
  bar.onpointerdown=e=>{if(!e.isTrusted||e.button!==0||(e.target as Element).closest('button'))return;const r=node.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};bar.setPointerCapture(e.pointerId);frame.style.pointerEvents='none';focus(node);};
  bar.onpointermove=e=>{if(drag){node.style.left=Math.max(8,Math.min(innerWidth-node.offsetWidth-8,drag.left+e.clientX-drag.x))+'px';node.style.top=Math.max(8,Math.min(innerHeight-40,drag.top+e.clientY-drag.y))+'px';}};
  bar.onpointerup=bar.onpointercancel=()=>{drag=undefined;frame.style.pointerEvents='';};
  node.addEventListener('pointerdown',()=>focus(node));reply({opened:true});
 });
}

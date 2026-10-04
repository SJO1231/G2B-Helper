import { extractCapture } from './extractor';
import type { MvpSettings } from './contracts';
import { setIcon } from './icons';

/** Content adapter: small page control and one nearby feature frame, never a new browser window. */
(() => {
 const id='g2b-helper-mvp-root';if(document.getElementById(id))return;
 const host=document.createElement('div');host.id=id;host.dataset.pceRoot='mvp';document.documentElement.append(host);const shadow=host.attachShadow({mode:'open'});
 const style=document.createElement('style');style.textContent=`:host{all:initial;font:12px 'Malgun Gothic','Segoe UI',sans-serif;color:#26363e}*{box-sizing:border-box}.control{position:fixed;right:16px;top:24px;width:292px;z-index:2147483646;background:var(--sheet,#fff);color:var(--ink,#26363e);border:1px solid var(--line,#d9e3e8);border-radius:6px;box-shadow:0 3px 18px #20394420}.head{display:flex;align-items:center;gap:8px;padding:7px 8px;border-bottom:1px solid var(--line,#d9e3e8);cursor:move;user-select:none}.head b{flex:1}.body{padding:8px;display:grid;gap:6px}button,input,select{font:inherit;color:inherit;background:var(--sheet,#fff);border:1px solid var(--line,#d9e3e8);border-radius:3px;padding:5px 6px;min-width:0}button{cursor:pointer}button:hover{border-color:#20836f;background:var(--soft,#f1f7f5)}button:focus-visible{outline:2px solid #20836f}.row{display:flex;gap:4px}.row>*{flex:1;min-width:0}.row.counts{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)}.row.counts>*{width:100%}.launchers{display:flex;gap:4px;flex-wrap:wrap}.message{font-size:11px;color:var(--muted,#637780);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;min-height:14px}.head button{border:0;background:none;padding:0 3px;font-size:16px;line-height:18px}.circle{position:fixed;width:42px;height:42px;border-radius:50%;background:#18796c;color:#fff;z-index:2147483646;border:1px solid #18796c}.frame-wrap{position:fixed;z-index:2147483645;min-width:min(420px,calc(100vw - 16px));min-height:min(340px,calc(100vh - 16px));max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);background:var(--sheet,#fff);border:1px solid var(--line,#d9e3e8);border-radius:6px;box-shadow:0 5px 24px #20394422;overflow:hidden;resize:both}.frame-wrap.launcher{min-width:min(300px,calc(100vw - 16px));min-height:min(200px,calc(100vh - 16px))}.frame-wrap iframe{width:100%;height:100%;border:0;display:block}[hidden]{display:none!important}`;shadow.append(style);
 const control=document.createElement('section');control.className='control';const head=document.createElement('header');head.className='head';const title=document.createElement('b');title.textContent='G2B Helper';const body=document.createElement('div');body.className='body';const message=document.createElement('div');message.className='message';message.setAttribute('role','status');control.append(head,body);shadow.append(control);
 let panel:HTMLDivElement|undefined, frame:HTMLIFrameElement|undefined,sourceTabId:number|undefined, panelObserver:ResizeObserver|undefined;
 let settings:Partial<MvpSettings>={},openRevision=0;
 let popupDrag:{screenX:number;screenY:number;left:number;top:number}|undefined;
 let shortcuts:Record<string,string>={collect:'Alt+Shift+S',document:'Alt+Shift+D'};
 style.textContent+=`.launchers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}.launchers>button{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.head{background:var(--soft,#edf5f2)}.head b{color:var(--ink,#26363e)}`;
 function notice(value:unknown){const text=String(value??'').replace(/\s+/g,' ').trim();message.title=text;const brief=text.startsWith('현재 화면은 수집할 수 없습니다.')?'수집 불가 · 추출을 사용하세요.':text.replace('SQLite Gateway 연결 필요','DB 연결 필요');message.textContent=brief.length>46?brief.slice(0,43)+'…':brief;}
 function button(text:string,action:()=>unknown,label?:string){const b=document.createElement('button');b.textContent=text;b.type='button';if(label){b.title=label;b.setAttribute('aria-label',label);}b.onclick=()=>Promise.resolve().then(action).catch(e=>notice(e.message||e));return b;}
 function iconButton(kind:'collapse'|'close'|'add',action:()=>unknown,label:string){const b=button('',action,label);setIcon(b,kind,label);return b;}
 function row(...nodes:HTMLElement[]){const r=document.createElement('div');r.className='row';r.append(...nodes);body.append(r);return r;}
 function place(node:HTMLElement,left:number,top:number){node.style.left=Math.max(0,Math.min(Math.max(0,innerWidth-node.offsetWidth),left))+'px';node.style.top=Math.max(0,Math.min(Math.max(0,innerHeight-node.offsetHeight),top))+'px';node.style.right='auto';}
 let controlPosition={left:0,top:0};
 const circle=button('G2B',()=>{circle.hidden=true;control.hidden=false;place(control,controlPosition.left,controlPosition.top);},'위젯 펼치기');circle.className='circle';circle.hidden=true;shadow.append(circle);
 function closePanel(){panelObserver?.disconnect();panelObserver=undefined;panel?.remove();panel=undefined;frame=undefined;popupDrag=undefined;}
 const collapse=iconButton('collapse',()=>{const r=control.getBoundingClientRect(),anchor=collapse.getBoundingClientRect();controlPosition={left:r.left,top:r.top};control.hidden=true;circle.hidden=false;place(circle,anchor.left+anchor.width/2-21,anchor.top+anchor.height/2-21);},'위젯 접기');
 head.append(title,collapse,iconButton('close',()=>{openRevision++;closePanel();host.remove();},'위젯 닫기'));
 style.textContent+=`.head{height:34px;padding:5px 8px}.head .icon-button{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:3px}.row.counts select,.row.counts input{text-align:center;text-align-last:center;font-variant-numeric:tabular-nums}`;
 async function request(kind:string,payload:Record<string,unknown>={}){const result=await chrome.runtime.sendMessage({kind,...payload,tabId:sourceTabId});if(result?.error)throw new Error(typeof result.error==='string'?result.error:result.error.message);return result?.result;}
 async function readSettings(){const response=await request('mvp.rpc',{envelope:{protocolVersion:1,requestId:crypto.randomUUID(),command:'mvp.settings.read',payload:{}}});applySettings(response?.settings);}
 function clampPanel(){if(!panel)return;const r=panel.getBoundingClientRect();panel.style.left=Math.max(8,Math.min(r.left,Math.max(8,innerWidth-r.width-8)))+'px';panel.style.top=Math.max(8,Math.min(r.top,Math.max(8,innerHeight-r.height-8)))+'px';}
 async function open(mode:string){
  const revision=++openRevision;
  if(sourceTabId===undefined)sourceTabId=(await request('mvp.context')).tabId;
  if(mode==='collect'){
   await readSettings();
   const result=extractCapture(await request('mvp.capture'),undefined,settings.screenRules);
   if(revision!==openRevision||!host.isConnected)return;
   if(!result.observations.length){notice('현재 화면은 수집할 수 없습니다. '+(result.warnings.join(' · ')||'등록 화면과 업무키를 확인하세요.'));return;}
  }
  if(revision!==openRevision||!host.isConnected)return;
  closePanel();notice('');panel=document.createElement('div');panel.className='frame-wrap'+(mode==='launcher'?' launcher':'');
  const r=control.hidden?circle.getBoundingClientRect():control.getBoundingClientRect();const width=Math.min(mode==='launcher'?470:1060,innerWidth-24),height=Math.min(mode==='launcher'?260:760,innerHeight-24);panel.style.width=Math.max(0,width)+'px';panel.style.height=Math.max(0,height)+'px';panel.style.left=Math.max(8,Math.min(r.left-width-10,innerWidth-width-8))+'px';panel.style.top=Math.max(8,Math.min(r.top,innerHeight-height-8))+'px';
  frame=document.createElement('iframe');frame.title='G2B Helper '+mode;frame.src=chrome.runtime.getURL(`main.html?mode=${encodeURIComponent(mode)}&sourceTabId=${sourceTabId}`);panel.append(frame);shadow.append(panel);
  panelObserver=new ResizeObserver(clampPanel);panelObserver.observe(panel);clampPanel();
 }
 async function work(kind:string,extra:Record<string,unknown>={}){notice('');const result=await request('mvp.work',{request:{kind,...extra}});notice(result?.message||'');if(result?.status==='needsSelection')await open('extract');}
 row(button('−1년',()=>work('yearShift',{years:-1,searchAfter:false})),button('+1년',()=>work('yearShift',{years:1,searchAfter:false})),button('조회',()=>work('search')),button('엑셀',()=>work('excel')));
 const list=document.createElement('select');list.setAttribute('aria-label','조회건수 목록');for(const value of ['10','50','100','500','1000'])list.add(new Option(value,value));const count=document.createElement('input');count.type='number';count.min='1';count.max='100000';count.value='10';count.setAttribute('aria-label','조회건수 직접입력');list.onchange=()=>count.value=list.value;
 row(list,count,button('적용',()=>work('setRowCount',{rowCount:Number(count.value)}))).classList.add('counts');
 row(button('수집',()=>open('collect')),button('추출',()=>open('extract')),button('DB',()=>open('db')),button('문서',()=>open('document')));
 const launchers=document.createElement('div');launchers.className='launchers';body.append(launchers,message);
 function renderLaunchers(){launchers.replaceChildren();for(const launcher of settings.launchers||[])launchers.append(button(launcher.label,()=>request('mvp.launch',{script:launcher.script}),launcher.label));launchers.append(iconButton('add',()=>open('launcher'),'런처 추가'));}
 async function hydrate(){try{await readSettings();}catch{notice('SQLite Gateway 연결 필요');}}
 function applySettings(next:Partial<MvpSettings>|undefined){if(!next)return;const full=!!next.theme&&!!next.dictionary&&Array.isArray(next.launchers);settings=full?next:{...settings,...next};if(full||next.shortcuts)shortcuts={collect:'Alt+Shift+S',document:'Alt+Shift+D',...settings.shortcuts};const dark=settings.theme==='dark';for(const[key,value]of Object.entries(dark?{'--sheet':'#20282d','--ink':'#e7edef','--line':'#39464d','--soft':'#293b3c','--muted':'#a8b6be'}:{'--sheet':'#fff','--ink':'#26363e','--line':'#d9e3e8','--soft':'#f1f7f5','--muted':'#637780'}))host.style.setProperty(key,value);renderLaunchers();}
 window.addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.origin!==new URL(chrome.runtime.getURL('/')).origin)return;
  if(event.data?.kind==='mvp.close'){openRevision++;closePanel();void hydrate();}
  if(event.data?.kind==='mvp.settings')applySettings(event.data.settings);
  if(event.data?.kind==='mvp.notice')notice(event.data.message);
  if(event.data?.kind==='mvp.drag'&&panel){
   const {phase,screenX,screenY}=event.data;if(!Number.isFinite(screenX)||!Number.isFinite(screenY))return;
   if(phase==='start'){const r=panel.getBoundingClientRect();popupDrag={screenX,screenY,left:r.left,top:r.top};}
   else if((phase==='move'||phase==='end')&&popupDrag){panel.style.left=popupDrag.left+screenX-popupDrag.screenX+'px';panel.style.top=popupDrag.top+screenY-popupDrag.screenY+'px';clampPanel();if(phase==='end')popupDrag=undefined;}
  }
 });
 chrome.runtime.onMessage.addListener(payload=>{if(payload?.kind==='mvp.open'){void open(payload.mode).catch(e=>notice(e.message||e));}});
 document.addEventListener('keydown',event=>{if(!event.isTrusted||event.repeat)return;if(event.key==='Escape'&&panel&&document.activeElement!==frame){openRevision++;closePanel();return;}const combination=[event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.metaKey?'Meta':'',event.key.toUpperCase()].filter(Boolean).join('+');const action=Object.entries(shortcuts).find(([,key])=>key.toLowerCase()===combination.toLowerCase())?.[0];if(action){event.preventDefault();void open(action).catch(e=>notice(e.message||e));}});
 head.addEventListener('pointerdown',event=>{if((event.target as HTMLElement).closest('button'))return;event.preventDefault();const r=control.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;head.setPointerCapture(event.pointerId);const move=(e:PointerEvent)=>place(control,e.clientX-x,e.clientY-y);const up=()=>{head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);head.removeEventListener('pointercancel',up);};head.addEventListener('pointermove',move);head.addEventListener('pointerup',up,{once:true});head.addEventListener('pointercancel',up,{once:true});});
 window.addEventListener('resize',()=>{clampPanel();const visible=control.hidden?circle:control;const r=visible.getBoundingClientRect();place(visible,r.left,r.top);});
 renderLaunchers();void hydrate();
})();

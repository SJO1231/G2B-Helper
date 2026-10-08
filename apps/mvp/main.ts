import './style.css';
import { renderGrid } from './grid';
import { collectionScreen, defaultScreenRules, extractCapture, extractionViews, loadJson } from './extractor';
import { rpc, captureCurrentPage, runLauncher } from './bridge';
import { RecordView } from './record-view';
import { collectorBridge, documentItems, screenDocumentItems } from './integrations';
import { childRowCount, documentCandidates, generationItem, planFields } from './document-fields';
import { extractionSources, recordSources, type OutputSource } from './document-sources';
import type { DocumentItem, DocumentProfile, DocumentRequest, DocumentResult } from './contracts';
import { columnTypeLabels, type MvpColumnType, type CollectionDecision, type CollectionPreview, type ExtractionResult, type ExtractionView, type GridRendererHandle, type GridViewState, type JsonRow, type MvpSettings, type ProcurementObservation, type ProcurementRecord, type ProcurementStage } from './contracts';
import { dateColumnKeys, dateParts, rawText } from './grid-model';
import { setIcon } from './icons';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'extract';
const tabId = Number(params.get('sourceTabId')) || undefined;
const native = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const stageLabels:Record<ProcurementStage,string> = {receipt:'접수',bid:'공고',contract:'계약'};
const defaultColumnTypes:NonNullable<MvpSettings['columnTypes']>={ctrtAmt:'money',ctrtDmndAmt:'money',dlvgdsTermYmd:'date',종결금액:'money',미종결금액:'money',선금보증금액:'money',지정일:'date',선금보증기한:'date'};
let settings:MvpSettings = {theme:'light',extractionMode:'tables',hideEmptyColumns:true,hideUnmappedColumns:false,dictionary:{keys:{ctrtNo:'계약번호',ctrtChgOrd:'변경차수',ctrtAmt:'계약금액',dlvgdsTermYmd:'납품기한',ctrtDmndRcptNo:'접수번호',ctrtDmndRcptOrd:'차수'},values:{}},launchers:[],shortcuts:{collect:'Alt+Shift+S',document:'Alt+Shift+D'},columnTypes:{종결금액:'money',미종결금액:'money',선금보증금액:'money',지정일:'date',선금보증기한:'date'}};
let settingsVersion=1, extraction:ExtractionResult|undefined, handle:GridRendererHandle|undefined;
let records:ProcurementRecord[]=[], stage:ProcurementStage='receipt', activeView:ExtractionView|undefined, dirty=false, userVisible=true, isDb=mode==='db';
let recordsRevision=0;
let recordView:RecordView|undefined, userColumnDraft:string[]=[];
// Data opened from a file is view only: it is never collected or used for documents (user, 2026-10-09, #42).
let extractionFromFile=false;
let settingsQueue:Promise<void>=Promise.resolve();
let confirmedSettings=structuredClone(settings),settingsRevision=0,viewKey='';
const viewStates=new Map<string,GridViewState>();
try{const saved=JSON.parse(sessionStorage.getItem('mvp.grid.views')||'[]');if(Array.isArray(saved))for(const [key,value]of saved){if(typeof key==='string'&&value&&typeof value.search==='string'&&['and','or'].includes(value.combine)&&Array.isArray(value.columns)&&value.columns.every((c:any)=>typeof c.key==='string'&&Number.isFinite(c.width)&&c.width>=85&&c.width<=1200&&typeof c.visible==='boolean')&&Array.isArray(value.sorters)&&value.sorters.every((s:any)=>typeof s.key==='string'&&['asc','desc'].includes(s.dir))&&Array.isArray(value.filters)&&value.filters.every((f:any)=>Array.isArray(f)&&typeof f[0]==='string'&&f[1]&&(['values'].includes(f[1].mode)?Array.isArray(f[1].values)&&f[1].values.every((v:any)=>typeof v==='string'):['exact','includes','exclude'].includes(f[1].mode)&&Array.isArray(f[1].terms)&&f[1].terms.every((v:any)=>typeof v==='string'))))viewStates.set(key,value);}}catch{/* Unavailable/corrupt session preferences use the default view. */}
function rememberView(){if(handle&&viewKey){viewStates.set(viewKey,handle.getViewState());try{sessionStorage.setItem('mvp.grid.views',JSON.stringify([...viewStates]));}catch{/* The in-memory view still survives tab switches. */}}}
const demoStore=new Map<ProcurementStage,ProcurementRecord[]>(),demoTrash=new Map<ProcurementStage,ProcurementRecord[]>();
const root=document.querySelector<HTMLElement>('#app')!;
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function button(label:string, action:()=>unknown){const b=node('button',label);b.type='button';b.onclick=()=>{Promise.resolve().then(action).catch(fail);};return b;}
function iconButton(kind:Parameters<typeof setIcon>[1],label:string,action:()=>unknown){const b=button(label,action);setIcon(b,kind,label);return b;}
function input(label:string, type='text'){const n=node('input');n.type=type;n.setAttribute('aria-label',label);return n;}
function select(label:string, choices:[string,string][], selected?:string){const n=node('select');n.setAttribute('aria-label',label);for(const [v,t]of choices){const o=node('option',t);o.value=v;n.append(o);}if(selected)n.value=selected;return n;}
const shell=node('section',undefined,'shell'), title=node('header',undefined,'titlebar'), toolbar=node('div',undefined,'toolbar actionbar'), filters=node('div',undefined,'date-controls'), tabs=node('nav',undefined,'tabs'), area=node('div',undefined,'grid-area'), status=node('div',undefined,'status');
const heading=node('strong',mode==='db'?'DB':mode==='collect'?'수집':mode==='document'?'문서 연결':mode==='launcher'?'런처':'추출');
function message(text:string,error=false){const detail=text.replace(/\s*\n\s*/g,' ');status.title=detail;status.textContent=/top URL|출처|origin/i.test(detail)?'출처 미확인 · 추출만 가능합니다.':detail.length>64?detail.slice(0,61)+'…':detail;status.classList.toggle('error',error);}
function fail(error:unknown){message(error instanceof Error?error.message:String(error),true);}
function close(){rememberView();if(window.parent!==window){window.parent.postMessage({kind:'mvp.close'},'*');}else window.close();}
function sourceKey(key:string){return [...(recordView?.userNames||[])].find(([,alias])=>alias===key)?.[0]||key;}
function gridSettings(){const value=structuredClone(settings);if(isDb&&recordView)for(const[key,alias]of recordView.userNames){if(alias===key)continue;if(value.columnTypes?.[key])(value.columnTypes??={})[alias]=value.columnTypes[key];if(value.columnFormats&&Object.hasOwn(value.columnFormats,key))value.columnFormats[alias]=value.columnFormats[key];if(Object.hasOwn(value.dictionary.keys,key))value.dictionary.keys[alias]=value.dictionary.keys[key];}return value;}
function theme(){document.documentElement.dataset.theme=settings.theme;handle?.setSettings(gridSettings());if(handle){refreshDateChoices();if(!isDb)applyDates();}window.parent.postMessage({kind:'mvp.settings',settings:{theme:settings.theme,shortcuts:settings.shortcuts,launchers:settings.launchers,screenRules:settings.screenRules}},'*');}
const settingsButton=iconButton('settings','설정',()=>showSettings());title.append(heading,node('span',native?'':'샘플','demo-mark'),node('span',undefined,'spacer'),settingsButton,iconButton('close','닫기',close));
let dragPointer:number|undefined;
title.addEventListener('pointerdown',e=>{if(e.button!==0||(e.target as Element).closest('button,input,select'))return;dragPointer=e.pointerId;title.setPointerCapture(e.pointerId);window.parent.postMessage({kind:'mvp.drag',phase:'start',screenX:e.screenX,screenY:e.screenY},'*');});
title.addEventListener('pointermove',e=>{if(dragPointer===e.pointerId)window.parent.postMessage({kind:'mvp.drag',phase:'move',screenX:e.screenX,screenY:e.screenY},'*');});
for(const event of ['pointerup','pointercancel']as const)title.addEventListener(event,e=>{if(dragPointer!==e.pointerId)return;dragPointer=undefined;window.parent.postMessage({kind:'mvp.drag',phase:'end',screenX:e.screenX,screenY:e.screenY},'*');});
shell.append(title,toolbar,tabs,area,status);root.append(shell);
function download(value:string,name:string,type='application/json'){const url=URL.createObjectURL(new Blob([value],{type}));const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function dialog(label:string){const d=node('dialog',undefined,'dialog');const head=node('header',undefined,'titlebar');head.append(node('strong',label),node('span',undefined,'spacer'),iconButton('close','닫기',()=>d.close()));const body=node('div',undefined,'dialog-body');d.append(head,body);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return{d,head,body};}
function rawDialog(value:unknown){const {body}=dialog('원본 JSON');const text=typeof value==='string'?value:JSON.stringify(value,null,2);body.append(button('JSON 저장',()=>download(text,'g2b-raw.json')),node('pre',text,'raw-view'));}
// A detail table opens in a modal, so it carries its own '필터 해제' (#28).
function nested(label:string, rows:JsonRow[]){const {d,body}=dialog(label);const host=node('div',undefined,'grid-area');const reset=button('필터 해제',()=>grid.clearColumnFilters());reset.title='머리글에서 설정한 열 필터만 해제합니다.';body.append(reset,host);const grid=renderGrid(host,{label,rows,settings,onNested:(_row,key,nestedRows)=>nestedView(key,nestedRows)});d.addEventListener('close',()=>grid.destroy());}
function nestedView(key:string,rows:JsonRow[]){nested(key,rows);}
function saveSettings(){const snapshot=structuredClone(settings),revision=++settingsRevision;const operation=settingsQueue.catch(()=>{}).then(async()=>{try{if(native){const saved=await rpc<{settings:MvpSettings;storeVersion:number}>('mvp.settings.save',{settings:snapshot,storeVersion:settingsVersion});settingsVersion=saved.storeVersion;confirmedSettings=structuredClone(saved.settings);}else confirmedSettings=structuredClone(snapshot);if(revision===settingsRevision){settings=structuredClone(confirmedSettings);theme();}}catch(error){if(revision===settingsRevision){settings=structuredClone(confirmedSettings);theme();}throw error;}});settingsQueue=operation;return operation;}
function autosave(){theme();void saveSettings().catch(fail);}
const search=input('검색');search.className='search';search.placeholder='검색';search.oninput=()=>handle?.setSearch(search.value);
// On a collection target screen the extraction's '저장' is collection (user, 2026-10-09, #42).
const save=button('저장',()=>isDb?saveRows():collect());save.disabled=true;
const importFile=input('JSON 열기','file');importFile.accept='.json,.txt';importFile.hidden=true;importFile.onchange=async()=>{const file=importFile.files?.[0];if(file){if(dirty&&isDb&&!confirm('저장하지 않은 입력을 닫을까요?'))return;extraction=loadJson(await file.text());extractionFromFile=true;showExtraction();}importFile.value='';};
const hiddenUser=button('사용자 열 숨김',()=>{userVisible=!userVisible;handle?.setUserColumnsVisible(userVisible);hiddenUser.classList.toggle('active',!userVisible);hiddenUser.setAttribute('aria-pressed',String(!userVisible));});hiddenUser.setAttribute('aria-pressed','false');hiddenUser.title='사용자 열 표시 여부를 전환합니다.';
const finishSelected=button('종결',()=>handle?.toggleSelectedBoolean(recordView?.completionKey||'종결'));finishSelected.hidden=true;
finishSelected.title='선택한 계약 행의 종결 체크를 반전합니다. 변경 후 저장하세요.';
// '열 필터 해제' is named '필터 해제' and sits beside the search (user, #28); the search term is kept.
const resetFilters=button('필터 해제',()=>handle?.clearColumnFilters());resetFilters.title='머리글에서 설정한 열 필터만 해제합니다. 전체 검색어는 유지합니다.';
const tabList=node('div',undefined,'tab-list'),tabActions=node('div',undefined,'tab-actions');tabActions.append(finishSelected,hiddenUser,resetFilters,search);tabs.append(tabList,tabActions);
const exports=node('div',undefined,'export-actions');exports.append(button('원본 JSON',()=>rawDialog(isDb?records.map(r=>({recordId:r.recordId,rawJson:r.rawJson})):extraction?.raw||{})),button('JSON',()=>download(JSON.stringify(exportJson(),null,2),'g2b-tables.json')),button('CSV',()=>handle?.exportCsv('g2b-table.csv')),button('Excel',()=>handle?.exportExcel('g2b-table.xlsx')),save,importFile);toolbar.append(filters,exports);
const generateButton=button('생성',()=>generateDocuments());exports.insertBefore(generateButton,save);
function exportJson(){if(isDb)return handle?.rows()||[];if(!extraction)return{};const tables=Object.fromEntries(extractionViews(extraction,'tables').map(v=>[v.key,v.rows]));if(settings.extractionMode==='all'){const points=extractionViews(extraction,'all').filter(v=>!Object.hasOwn(tables,v.key));return{pointInfo:points.length===1?points[0].rows[0]||{}:Object.fromEntries(points.map(v=>[v.key,v.rows[0]||{}])),tables};}return{tables};}
const start=input('시작일'),end=input('종료일');start.className=end.className='date-field';start.placeholder=end.placeholder='YYYY.MM.DD';
const today=new Date();end.value=dateText(today);const initial=new Date(today);initial.setMonth(initial.getMonth()-3);start.value=dateText(initial);
const dateKey=select('날짜 기준',[['','전체']]);const completion=select('종결 필터',[['all','전체'],['open','미종결'],['closed','종결']]);
function dateText(d:Date){return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;}
function parseDate(value:unknown){const parts=dateParts(String(value??'').split(/[T\s]/)[0]);if(!parts)return;const d=new Date(0);d.setFullYear(+parts[0],+parts[1]-1,+parts[2]);d.setHours(0,0,0,0);return d;}
function shiftYears(amount:number){if(dirty){message('먼저 입력을 저장하세요.');return;}const d=parseDate(start.value);if(!d)throw new Error('날짜를 YYYY.MM.DD로 입력하세요.');const year=d.getFullYear()+amount;start.value=`${year}.01.01`;end.value=`${year}.12.31`;applyDates();}
filters.append(start,node('span','~'),end,button('−1년',()=>shiftYears(-1)),button('+1년',()=>shiftYears(1)),dateKey,completion);
for(const control of[start,end,dateKey,completion])control.onchange=()=>{if(dirty){message('먼저 입력을 저장하세요.');return;}if((control===start||control===end)&&(!parseDate(start.value)||!parseDate(end.value))){message('날짜를 YYYY.MM.DD로 입력하세요.',true);return;}applyDates();};
function dateChoices(rows:JsonRow[]){const current=dateKey.value,configured=gridSettings();dateKey.replaceChildren(new Option('전체',''));const keys=dateColumnKeys(rows,configured);for(const key of keys)dateKey.append(new Option(configured.dictionary.keys[key]||key,key));dateKey.value=keys.includes(current)?current:'';}
function refreshDateChoices(){dateChoices(isDb?[...records.map(r=>r.fields),Object.fromEntries([...(recordView?.userNames.values()||[])].map(key=>[key,undefined]))]:handle?.rows()||activeView?.rows||[]);}
function applyDates(){if(isDb){showRecords();return;}const begin=parseDate(start.value),finish=parseDate(end.value);if(dateKey.value&&(!begin||!finish||begin>finish)){message('날짜 구간을 확인하세요.',true);return;}const key=dateKey.value;handle?.setRowFilter(key?row=>{const date=parseDate(row[key]);return !!date&&date>=begin!&&date<=finish!;}:undefined);}
function destroyGrid(){rememberView();handle?.destroy();handle=undefined;viewKey='';area.replaceChildren();}
function showGrid(view:ExtractionView, options:{userKeys?:string[];readonlyKeys?:string[]}={}){
 destroyGrid();activeView=view;dirty=false;save.disabled=true;save.hidden=false;viewKey=(isDb?'db:':'extract:')+view.key;const viewState=viewStates.get(viewKey);search.value=viewState?.search||'';userVisible=viewState?.userColumnsVisible!==false;hiddenUser.classList.toggle('active',!userVisible);hiddenUser.setAttribute('aria-pressed',String(!userVisible));
 handle=renderGrid(area,{label:view.label,rows:view.rows,viewState,settings:gridSettings(),userColumnKeys:options.userKeys,itemColumnKeys:isDb&&recordView?[...new Set(records.flatMap(r=>r.children.filter(c=>c.kind==='items').map(c=>recordView!.childNames.get(c.key)!).filter(Boolean)))]:undefined,readOnlyColumnKeys:options.readonlyKeys,readOnly:!isDb,allowRowDelete:isDb,onNotice:text=>message(text,true),
  // The extraction table is view only (user, 2026-10-09, #42); in the DB only user columns are edited.
  onRowsChanged:()=>{if(!isDb)return;dirty=true;save.disabled=!native;if(stage==='contract'&&recordView)handle?.updateDerivedValues(row=>recordView!.derive(row));},onUserColumnsChanged:(keys)=>{if(!isDb)return;userColumnDraft=recordView!.definitionNames(keys);dirty=true;save.disabled=!native;},onColumnRename:(key,label)=>{settings.dictionary.keys={...settings.dictionary.keys,[isDb?sourceKey(key):key]:label};autosave();},onColumnType:(key,type)=>{settings.columnTypes={...settings.columnTypes,[isDb?sourceKey(key):key]:type};autosave();},onColumnFormat:(key,format)=>{settings.columnFormats={...settings.columnFormats,[isDb?sourceKey(key):key]:format};autosave();},onValueDictionary:(key,value,selection)=>valueDictionary((selection||[{key,value}]).map(entry=>({...entry,key:isDb?sourceKey(entry.key):entry.key}))),...(isDb?{onDeleteRows:(_rows:JsonRow[],indices:number[])=>{void trashRows(indices).catch(fail);}}:{}),onNested:(_row,key,rows)=>nestedView(key,rows),onSettings:propertySettings,tableSettings:!isDb});
 if(!userVisible)handle.setUserColumnsVisible(false);
}
// The 속성 panel changes the same settings as the settings window and saves them at once (user, #28).
function propertySettings(changes:Partial<Pick<MvpSettings,'hideEmptyColumns'|'hideUnmappedColumns'|'hideEmptyTables'|'extractionMode'>>){Object.assign(settings,changes);if('hideEmptyTables'in changes||'extractionMode'in changes){void saveSettings().catch(fail);showExtraction();}else autosave();}
function showExtraction(){if(!extraction)return;isDb=false;recordView=undefined;finishSelected.hidden=completion.hidden=true;filters.hidden=false;heading.textContent='추출';tabList.replaceChildren();const views=extractionViews(extraction,settings.extractionMode).filter(v=>!settings.hideEmptyTables||v.rows.length>0);const show=(view:ExtractionView)=>{dateChoices(view.rows);showGrid(view);collectable();applyDates();};for(const view of views){const b=button(view.label,()=>{show(view);for(const tab of tabList.children)tab.classList.toggle('active',tab===b);});tabList.append(b);}if(views[0]){show(views[0]);tabList.firstElementChild?.classList.add('active');}else{dateChoices([]);destroyGrid();save.hidden=false;collectable();area.append(node('p','표가 없습니다.','empty'));}message(extraction.warnings.join(' · '));}
// Collection needs a read business record of a collection target; a file is view only.
function collectable(){const ready=native&&!extractionFromFile&&!!extraction?.observations.length;save.disabled=!ready;save.title=ready?'이 화면의 업무 자료를 DB에 저장(수집)합니다.':extractionFromFile?'파일로 연 자료는 보기 전용입니다.':'수집 대상 화면의 업무 자료가 아닙니다.';}
function recordRow(record:ProcurementRecord){return recordView!.toRow(record);}
function showRecords(){if(dirty){message('입력을 저장한 뒤 필터를 변경하세요.');return;}isDb=true;completion.hidden=finishSelected.hidden=stage!=='contract';const begin=parseDate(start.value),finish=parseDate(end.value);if(dateKey.value&&(!begin||!finish||begin>finish)){message('날짜 구간을 확인하세요.',true);return;}
 const filtered=records.filter(r=>{if(stage==='contract'&&completion.value!=='all'&&Boolean(r.userValues['종결'])!==(completion.value==='closed'))return false;if(dateKey.value){const source=sourceKey(dateKey.value),d=parseDate(recordView?.userNames.get(source)===dateKey.value?r.userValues[source]:r.fields[dateKey.value]);return !!d&&d>=begin!&&d<=finish!;}return true;});
 showGrid({key:stage,label:stageLabels[stage],stage,rows:filtered.map(recordRow)},{userKeys:recordView!.userKeys,readonlyKeys:recordView!.readonlyKeys});
 area.dataset.recordIds=JSON.stringify(filtered.map(r=>r.recordId));message('');
}
async function loadRecords(next:ProcurementStage=stage){if(dirty&&!confirm('저장하지 않은 입력을 닫을까요?'))return;const revision=++recordsRevision;area.inert=true;area.setAttribute('aria-busy','true');save.disabled=true;message('불러오는 중…');try{const loaded=native?await rpc<ProcurementRecord[]>('mvp.records',{stage:next}):demoStore.get(next)||demoRecords(next);if(revision!==recordsRevision)return;stage=next;records=loaded;if(!native)demoStore.set(stage,records);dirty=false;isDb=true;heading.textContent='DB';filters.hidden=false;
 recordView=new RecordView(records,stage,settings);userColumnDraft=recordView.definitionNames(recordView.userKeys);
 refreshDateChoices();
 tabList.replaceChildren();for(const [key,label]of Object.entries(stageLabels)){const b=button(label,()=>loadRecords(key as ProcurementStage));b.classList.toggle('active',key===stage);tabList.append(b);}showRecords();}catch(error){if(revision===recordsRevision)throw error;}finally{if(revision===recordsRevision){area.inert=false;area.setAttribute('aria-busy','false');save.disabled=!dirty||!native;}}
}
async function saveRows(){if(!isDb||!native)return;await settingsQueue;const ids=JSON.parse(area.dataset.recordIds||'[]') as string[];const rows=handle?.rows()||[];if(rows.length!==ids.length)throw new Error('업무 행 추가는 현재 지원하지 않습니다. 입력을 유지합니다.');
 // Only user columns are sent: source values are read only (user, 2026-10-09, #42).
 const changes=rows.map((row,index)=>{const{recordId,storeVersion,userValues}=recordView!.toEdit(records.find(r=>r.recordId===ids[index])!,row);return{recordId,storeVersion,userValues};});
 await rpc('mvp.edit',{records:changes,userColumns:{stage,keys:userColumnDraft,settingsStoreVersion:settingsVersion}});(settings.userColumns??={})[stage]=userColumnDraft;(confirmedSettings.userColumns??={})[stage]=structuredClone(userColumnDraft);settingsVersion++;dirty=false;await loadRecords();message('저장됨');
}
async function collect(){if(!extraction)extraction=extractCapture(await captureCurrentPage(tabId),undefined,settings.screenRules);if(!extraction.observations.length){const text=extraction.warnings.join(' · ')||'등록 화면과 업무키를 확인하세요.';if(window.parent!==window){window.parent.postMessage({kind:'mvp.notice',message:text,error:true},'*');close();return;}message(text,true);return;}
 let preview=await rpc<CollectionPreview>('mvp.preview',{observations:extraction.observations});
 const choices:CollectionDecision[]=[];
 if(preview.conflicts.length){const {d,body}=dialog('값 변경');const checks=new Map<string,HTMLInputElement>();for(const conflict of preview.conflicts){const line=node('div',undefined,'diff');const check=input('신규값 반영','checkbox');checks.set(conflict.recordId+'\0'+conflict.field,check);line.append(check,node('span',settings.dictionary.keys[conflict.field]||conflict.field),node('pre',JSON.stringify(conflict.previous)),node('pre',JSON.stringify(conflict.incoming)));body.append(line);}await new Promise<void>(resolve=>{body.append(button('반영',()=>{for(const c of preview.conflicts)choices.push({recordId:c.recordId,field:c.field,useIncoming:checks.get(c.recordId+'\0'+c.field)!.checked});d.returnValue='apply';d.close();resolve();}));d.addEventListener('close',()=>resolve(),{once:true});});if(d.returnValue!=='apply')return;}
 await rpc('mvp.apply',{observations:preview.observations,token:preview.token,decisions:choices});await collectorBridge.sendCollectedData(preview.observations);stage=preview.observations[0].stage;location.search=`mode=db&sourceTabId=${tabId||''}&stage=${stage}${preview.items.some(item=>item.carriedFrom)?'&notice=carried':''}`;
}
async function trashRows(indices:number[]){if(dirty){message('입력을 저장한 뒤 휴지통으로 이동하세요.');return;}const ids=JSON.parse(area.dataset.recordIds||'[]')as string[];const selected=[...new Set(indices)].map(index=>records.find(r=>r.recordId===ids[index])).filter((r):r is ProcurementRecord=>!!r);if(!selected.length)return;if(native)await rpc('mvp.trash',{records:selected.map(r=>({recordId:r.recordId,storeVersion:r.storeVersion}))});else{demoTrash.set(stage,[...(demoTrash.get(stage)||[]),...selected.map(r=>({...r,storeVersion:r.storeVersion+1}))]);demoStore.set(stage,records.filter(r=>!selected.some(s=>s.recordId===r.recordId)));}await loadRecords();message(`${selected.length}개 행을 휴지통으로 이동했습니다.`);}
async function showTrash(){if(dirty){message('입력을 저장한 뒤 휴지통을 여세요.');return;}const trashed=native?await rpc<ProcurementRecord[]>('mvp.records',{stage,trashed:true}):demoTrash.get(stage)||[];const{d,body}=dialog(stageLabels[stage]+' 휴지통');body.classList.add('trash-list');if(!trashed.length){body.append(node('p','휴지통이 비어 있습니다.','empty'));return;}for(const record of trashed){const line=node('div',undefined,'trash-row'),label=node('span',record.identity.join(' · '));label.title=label.textContent||'';line.append(label,button('복원',async()=>{if(native)await rpc('mvp.restore',{records:[{recordId:record.recordId,storeVersion:record.storeVersion}]});else{demoTrash.set(stage,(demoTrash.get(stage)||[]).filter(r=>r.recordId!==record.recordId));demoStore.set(stage,[...(demoStore.get(stage)||[]),{...record,storeVersion:record.storeVersion+1}]);}d.close();await loadRecords();message('행을 복원했습니다.');}));body.append(line);}}
function setDictionaryValue(key:string,value:string,label:string){const values=settings.dictionary.values;settings.dictionary.values={...values,[key]:{...(Object.hasOwn(values,key)?values[key]:{}),[value]:label}};}
function valueDictionary(selection:{key:string;value:unknown}[]){const{d,body}=dialog('값 사전 추가');const entries=[...new Map(selection.map(entry=>[JSON.stringify([entry.key,rawText(entry.value)]),entry])).values()];const edits=entries.map(({key,value})=>{const code=input('원값'),label=input('표시값');code.value=rawText(value);label.value=Object.hasOwn(settings.dictionary.values,key)&&Object.hasOwn(settings.dictionary.values[key],code.value)?settings.dictionary.values[key][code.value]:'';const name=node('span',settings.dictionary.keys[key]||key||'(빈 키)');name.append(node('small',key||'(빈 키)'));const line=node('div',undefined,'value-editor');line.append(name,code,label);body.append(line);return{key,code,label};});const actions=node('div',undefined,'dialog-actions');actions.append(iconButton('save','저장',async()=>{for(const edit of edits)setDictionaryValue(edit.key,edit.code.value,edit.label.value);await saveSettings();d.close();}));body.append(actions);edits[0]?.label.focus();}
function dictionary(body:HTMLElement,kind:'keys'|'values'){
 const table=node('table',undefined,'dictionary-grid '+kind),header=node('tr');for(const text of kind==='keys'?['원본 키','표시명','유형','']:['원본 키','원값','표시값',''])header.append(node('th',text));table.append(header);
 const entries=kind==='keys'?[...new Set([...Object.keys(settings.dictionary.keys),...Object.keys(settings.columnTypes||{})])].map(key=>[key,'',settings.dictionary.keys[key]||'']):Object.entries(settings.dictionary.values).flatMap(([key,values])=>Object.entries(values).map(([value,label])=>[key,value,label]));
 for(const[key,value,label]of entries){const row=node('tr'),edit=input('표시명');edit.value=label;edit.onchange=()=>{if(kind==='keys')settings.dictionary.keys={...settings.dictionary.keys,[key]:edit.value};else setDictionaryValue(key,value,edit.value);};for(const text of kind==='keys'?[key]:[key,value])row.append(node('td',text));const cell=node('td');cell.append(edit);row.append(cell);if(kind==='keys'){const typeCell=node('td'),type=select('유형 '+key,Object.entries(columnTypeLabels),settings.columnTypes?.[key]||'text');type.onchange=()=>{settings.columnTypes={...settings.columnTypes,[key]:type.value as MvpColumnType};};typeCell.append(type);row.append(typeCell);}const remove=node('td');remove.append(button('삭제',()=>{if(kind==='keys'){delete settings.dictionary.keys[key];delete settings.columnTypes?.[key];delete settings.columnFormats?.[key];}else delete settings.dictionary.values[key][value];row.remove();}));row.append(remove);table.append(row);}
 const row=node('tr',undefined,'dictionary-add'),key=input('원본 키'),value=input('원값'),label=input(kind==='keys'?'표시명':'표시값');const cell=(child:HTMLElement)=>{const td=node('td');td.append(child);row.append(td);};cell(key);if(kind==='values')cell(value);cell(label);let type:HTMLSelectElement|undefined;if(kind==='keys'){type=select('새 열 유형',Object.entries(columnTypeLabels));cell(type);}cell(button('추가',()=>{if(!key.value.trim())throw new Error('원본 키를 입력하세요.');if(kind==='keys'){settings.dictionary.keys={...settings.dictionary.keys,[key.value]:label.value};settings.columnTypes={...settings.columnTypes,[key.value]:type!.value as MvpColumnType};}else setDictionaryValue(key.value,value.value,label.value);body.replaceChildren();dictionary(body,kind);}));table.append(row);body.append(table);
}
function screenRulesEditor(content:HTMLElement){
 const defaultCheck=input('기본 수집 화면 사용','checkbox');defaultCheck.checked=settings.screenRules===undefined;const label=node('label');label.append(defaultCheck,'기본 수집 화면 사용');content.append(label);const list=node('div',undefined,'screen-rules');content.append(list);
 const render=()=>{list.replaceChildren();const defaults=settings.screenRules===undefined,rules=defaults?structuredClone(defaultScreenRules):settings.screenRules!;const table=node('table',undefined,'dictionary-grid screen-grid'),head=node('tr');for(const text of['업무','URL','areaCd','depth1','depth2','depth3',''])head.append(node('th',text));table.append(head);for(const rule of rules){const row=node('tr'),stageField=select('수집 업무',Object.entries(stageLabels)as[string,string][],rule.stage);stageField.disabled=defaults;stageField.onchange=()=>rule.stage=stageField.value as ProcurementStage;const td=node('td');td.append(stageField);row.append(td);for(const key of['urlPattern','areaCd','depth1','depth2','depth3']as const){const field=input(key==='urlPattern'?'수집 URL':key);field.value=rule[key]||'';field.disabled=defaults;field.oninput=()=>rule[key]=field.value;const cell=node('td');cell.append(field);row.append(cell);}const remove=node('td'),b=button('삭제',()=>{settings.screenRules=rules.filter(r=>r.id!==rule.id);render();});b.disabled=defaults;remove.append(b);row.append(remove);table.append(row);}list.append(table);const add=button('조건 추가',()=>{(settings.screenRules??=[]).push({id:crypto.randomUUID(),stage:'receipt',urlPattern:'https://www.g2b.go.kr/*',areaCd:'',depth1:'',depth2:'',depth3:''});render();});add.disabled=defaults;list.append(add,node('p',defaults?'기본 등록 화면과 원천 업무키를 확인합니다.':'URL의 *는 임의 문자열, 비어 있는 depth3는 모든 값에 일치합니다.','demo-mark'));};
 defaultCheck.onchange=()=>{if(defaultCheck.checked)delete settings.screenRules;else settings.screenRules=structuredClone(defaultScreenRules);render();};render();
}
function generalSettings(content:HTMLElement,d:HTMLDialogElement){
 const themeSelect=select('테마',[['light','화이트'],['dark','블랙']],settings.theme);themeSelect.onchange=()=>{settings.theme=themeSelect.value as 'light'|'dark';theme();};const extractionMode=select('추출 범위',[['tables','테이블만'],['all','전체']],settings.extractionMode);extractionMode.onchange=()=>settings.extractionMode=extractionMode.value as 'tables'|'all';content.append(node('div','테마','settings-line'),themeSelect,node('div','추출','settings-line'),extractionMode);
 for(const [key,label]of [['hideEmptyColumns','빈 열 숨김'],['hideUnmappedColumns','사전 미등록 열 숨김'],['hideEmptyTables','빈 테이블 숨김']]as const){const check=input(label,'checkbox');check.checked=!!settings[key];check.onchange=()=>{settings[key]=check.checked;theme();};const l=node('label');l.append(check,label);content.append(node('div',undefined,'settings-line').appendChild(l));}
 const trash=button('휴지통',()=>{d.close();return showTrash();});trash.disabled=!isDb;trash.title=isDb?'현재 업무의 삭제된 행을 복원합니다.':'DB 화면에서 사용할 수 있습니다.';content.append(node('div','데이터','settings-line'),trash);
}
function showSettings(){const original=structuredClone(settings);const {d,head,body}=dialog('설정'), navigation=node('nav',undefined,'tabs'), content=node('div',undefined,'settings-content');d.classList.add('settings-dialog');body.append(navigation,content);
 const views:{label:string;render:()=>void}[]=[{label:'일반',render:()=>generalSettings(content,d)},{label:'키 사전',render:()=>dictionary(content,'keys')},{label:'값 사전',render:()=>dictionary(content,'values')},{label:'수집 화면',render:()=>screenRulesEditor(content)},{label:'단축키',render:()=>{for(const [action,label]of [['collect','수집'],['extract','추출'],['db','DB'],['document','문서 연결'],['launcher','런처']]){const line=node('div',undefined,'shortcut-line'),field=input(label);field.value=settings.shortcuts?.[action as keyof NonNullable<MvpSettings['shortcuts']>]||'';field.readOnly=true;field.placeholder='여기서 키를 누르세요';field.onkeydown=e=>{if(e.key==='Tab')return;e.preventDefault();if(e.key==='Escape')return;if(e.key==='Backspace'||e.key==='Delete')field.value='';else if(!['Alt','Shift','Control','Meta'].includes(e.key))field.value=[e.ctrlKey?'Ctrl':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.metaKey?'Meta':'',e.key.toUpperCase()].filter(Boolean).join('+');(settings.shortcuts??={})[action as keyof NonNullable<MvpSettings['shortcuts']>]=field.value;};line.append(node('span',label),field);content.append(line);}content.append(node('p','브라우저 전체 단축키: 확장 프로그램 → 단축키','demo-mark'));}}];
 views.push({label:'문서 연결',render:()=>{void documentSettings(content).catch(error=>{if(content.isConnected)content.append(node('p',String(error instanceof Error?error.message:error)));});}});
 let current=views[0];for(const view of views)navigation.append(button(view.label,()=>{current=view;content.replaceChildren();view.render();}));current.render();let accepted=false;head.insertBefore(iconButton('save','저장',async()=>{try{await saveSettings();}catch(error){content.replaceChildren();current.render();throw error;}accepted=true;d.close();if(extraction&&mode!=='db')showExtraction();}),head.lastElementChild);d.addEventListener('close',()=>{if(!accepted){settings=original;theme();}});
}
function showLauncher(){
 destroyGrid();settingsButton.hidden=toolbar.hidden=filters.hidden=tabs.hidden=true;shell.classList.add('launcher-shell');heading.textContent='런처 추가';const label=input('버튼 이름'),script=node('textarea');label.placeholder='버튼 이름';script.placeholder='JavaScript';script.setAttribute('aria-label','JavaScript');const editor=node('div',undefined,'launcher-editor');
 const add=button('저장',async()=>{if(add.disabled)return;if(!label.value.trim()||!script.value.trim())throw new Error('이름과 스크립트를 입력하세요.');const launcher={id:crypto.randomUUID(),label:label.value.trim(),script:script.value};add.disabled=true;settings.launchers=[...settings.launchers,launcher];try{await saveSettings();label.value=script.value='';message('버튼 추가됨');}catch(error){settings.launchers=settings.launchers.filter(item=>item.id!==launcher.id);theme();throw error;}finally{add.disabled=false;}});add.classList.add('primary');editor.append(label,script,add);area.append(editor);
}
async function availableDocumentProfiles(){
 if(!native)throw new Error('문서 생성은 확장 프로그램과 Studio lite 연결이 필요합니다.');
 return(await rpc<{profiles:DocumentProfile[]}>('mvp.document.profiles')).profiles;
}
async function documentSettings(content:HTMLElement){
 const block=node('div');content.append(block);block.append(node('p','Studio lite에서 저장한 서식을 업무에 연결합니다. 서식과 저장 폴더는 Studio lite의 Helper 연결에서 관리합니다.'));
 let profiles:DocumentProfile[];
 try{profiles=await availableDocumentProfiles();}catch(error){if(block.isConnected)block.append(node('p',error instanceof Error?error.message:String(error)));return;}
 if(!block.isConnected)return;
 for(const [key,label]of Object.entries(stageLabels)){
  const current=settings.documentProfiles?.[key as ProcurementStage]||'';
  const choices:[string,string][]=[['','연결 안 함'],...profiles.map(p=>[p.id,p.label]as[string,string])];
  if(current&&!profiles.some(p=>p.id===current))choices.push([current,'연결된 서식을 찾을 수 없음']);
  const field=select(label+' 생성 서식',choices,current);field.onchange=()=>{const next={...settings.documentProfiles};if(field.value)next[key as ProcurementStage]=field.value;else delete next[key as ProcurementStage];settings.documentProfiles=next;};
  block.append(node('label',label),field);
  // Field links saved from the generation dialog: template field name -> Helper source key (#21).
  const links=current?settings.documentLinks?.[key as ProcurementStage]?.[current]||{}:{};
  if(Object.keys(links).length){
   const list=node('div',undefined,'document-links'),count=node('small',`서식 필드 연결 ${Object.keys(links).length}개`);list.append(count);
   for(const [name,source]of Object.entries(links)){
    const line=node('div');
    line.append(node('span',`${name} ← ${settings.dictionary.keys[source]?settings.dictionary.keys[source]+' · ':''}${source}`),button('연결 지우기',()=>{const stageLinks={...settings.documentLinks?.[key as ProcurementStage]},next={...stageLinks[current]};delete next[name];stageLinks[current]=next;settings.documentLinks={...settings.documentLinks,[key]:stageLinks};line.remove();count.textContent=`서식 필드 연결 ${Object.keys(next).length}개`;}));
    list.append(line);
   }
   block.append(list);
  }
 }
 if(!profiles.length)block.append(node('p','Studio lite에서 먼저 Helper 연결 서식을 등록하세요.'));
}
let unconfirmedDocumentRequest:{requestId:string;payload:DocumentRequest}|undefined;
async function generateDocuments(entry?:{items:DocumentItem[];sourceKind:'screen'|'db';observations?:ProcurementObservation[]}){
 if(generateButton.disabled)return;
 // DB output uses the stored values only (user, 2026-10-08, #24).
 // Unsaved table edits are saved first and the stored values are used (user, 2026-10-08, #34); a failed save stops here.
 if(isDb&&dirty&&!unconfirmedDocumentRequest&&!entry){
  const ids=JSON.parse(area.dataset.recordIds||'[]') as string[],chosen=(handle?.getSelectedRows()||[]).map(row=>ids[row.sourceIndex]).filter((id):id is string=>!!id);
  if(!chosen.length)throw new Error('생성할 행의 셀을 선택하세요.');
  generateButton.disabled=true;try{await saveRows();}finally{generateButton.disabled=false;}
  const stored=chosen.map(id=>records.find(record=>record.recordId===id)).filter((record):record is ProcurementRecord=>!!record);
  if(stored.length!==chosen.length)throw new Error('저장한 자료를 다시 찾지 못했습니다. 다시 선택하세요.');
  return generateDocuments({sourceKind:'db',items:documentItems(stored.map((record,sourceIndex)=>({sourceIndex,row:recordView!.toRow(record)})),{kind:'db',records:stored,recordIds:stored.map(record=>record.recordId),view:recordView!})});
 }
 const resume=unconfirmedDocumentRequest;
 const explicit=structuredClone(resume?.payload.items||entry?.items);
 const selected=explicit?explicit.map((item,sourceIndex)=>({sourceIndex,row:item.fields})):structuredClone(handle?.getSelectedRows()||[]);if(!selected.length)throw new Error('생성할 행의 셀을 선택하세요.');
 // G2B screen rows: a collection target is collected first; any other screen or file data is not output (user, 2026-10-09, #42).
 const sources:OutputSource[]|undefined=resume?undefined:entry?.observations?structuredClone(entry.observations).map(observation=>({kind:'record' as const,observation})):!isDb&&activeView&&extraction?extractionSources(selected,activeView,extraction.observations,extractionFromFile?'file':collectionScreen(activeView.source,settings.screenRules)?'collection':'other'):undefined;
 let kind=resume?.payload.sourceKind||entry?.sourceKind||(isDb?'db':'screen');
 const selectedStage=explicit?.[0]?.stage||(isDb?stage:sources?.flatMap(source=>source.kind==='record'?[source.observation.stage]:[])[0]||activeView?.stage);
 if(explicit&&explicit.some(item=>item.stage!==selectedStage))throw new Error('같은 업무의 자료를 선택하세요.');
 if(!explicit&&!activeView)throw new Error('생성할 표를 확인하세요.');
 const context=isDb?{kind:'db' as const,records:structuredClone(records),recordIds:JSON.parse(area.dataset.recordIds||'[]') as string[],view:recordView!}:{kind:'screen' as const,view:structuredClone(activeView!)};
 // Capture edited DB values before profile loading or any other asynchronous work.
 const fixedItems=explicit||(context.kind==='db'?documentItems(selected,context):selectedStage?documentItems(selected,{...context,stage:selectedStage}):undefined);
 generateButton.disabled=true;
 const {d,body}=dialog('문서 생성');d.classList.add('document-dialog');d.addEventListener('close',()=>{generateButton.disabled=false;});
 let busy=false;const closeButton=d.querySelector<HTMLButtonElement>('.titlebar button')!;
 d.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 const summary=node('p'),detail=node('div',undefined,'document-candidates'),choices:HTMLInputElement[]=[],descriptions:string[]=[];
 const stageField=select('생성 업무',[['','업무 선택'],...Object.entries(stageLabels)]as[string,string][],selectedStage);stageField.disabled=!!selectedStage;
 for(const [index,entry]of selected.entries()){
  const choice=input(`자료 ${index+1} 선택`,'checkbox');choice.checked=selected.length<=100;choice.disabled=!!resume;choices.push(choice);
  const item=fixedItems?.[index],identity=item?.identity||[];
  const values=Object.values(entry.row).filter(v=>(typeof v==='string'||typeof v==='number'||typeof v==='boolean')&&!identity.includes(String(v))).slice(0,3);
  const description=[...(item?[stageLabels[item.stage],identity.join(' / ')]:[]),...values.map(String)].join(' · ');
  descriptions.push(description.slice(0,240)||`자료 ${index+1}`);
  const label=node('label'),text=node('span',descriptions[index]);text.title=description;label.append(choice,text);detail.append(label);
 }
 let profileReady=!!resume;
 const refreshSelection=()=>{const count=choices.filter(c=>c.checked).length;summary.textContent=`${kind==='db'?'DB':'현재 화면'} 자료 ${selected.length}건 · 선택 ${count}건`;run.disabled=!profileReady||count===0||count>100;};
 const connection=node('div'),resultArea=node('div'),childNote=node('p'),storeNote=node('p');
 let pending=resume,names:string[]=[],chosenItems:DocumentItem[]=[],profileId='',chosenStage='' as ProcurementStage|'';
 // Kept for this dialog: saved files, empty values the user accepted, template names left blank this time.
 const saved:string[]=[],acceptedEmpty=new Set<string>(),blank=new Set<string>();
 const start=()=>{run.disabled=true;busy=true;closeButton.disabled=true;stageField.disabled=true;choices.forEach(choice=>choice.disabled=true);};
 const finish=()=>{busy=false;closeButton.disabled=false;};
 const again=(label:string)=>{run.textContent=label;run.disabled=false;};
 // Successful items leave the round; only the rest are sent again, so no file is made twice.
 const settle=(result:DocumentResult,sent:DocumentItem[])=>{
  for(const item of result.results)if(item.status==='success'&&item.path)saved.push(item.path);
  const failed=result.results.filter(item=>item.status!=='success');
  chosenItems=failed.map(item=>sent[item.itemIndex]).filter(Boolean);
  return failed;
 };
 const show=(failed:DocumentResult['results'],sent:DocumentItem[])=>{
  resultArea.replaceChildren(node('p',failed.length?`${saved.length}건 저장 · ${failed.length}건 확인 필요`:`${saved.length}건 저장 완료`));
  for(const path of saved)resultArea.append(node('p',path));
  for(const item of failed)resultArea.append(node('p',`${sent[item.itemIndex]?.identity.join(' / ')||'자료 '+(item.itemIndex+1)}: ${item.message||'생성하지 못했습니다.'}${item.missingFields?.length?` (${item.missingFields.join(', ')})`:''}`));
  if(failed.length)again('다시 확인');else{run.textContent='완료';message(`${saved.length}건 문서 저장 완료`);}
 };
 // One fixed request: a lost reply keeps it for a same-ID retry; any returned reply ends it.
 const send=async(request:{requestId:string;payload:DocumentRequest}):Promise<DocumentResult|undefined>=>{
  pending=request;unconfirmedDocumentRequest=request;resultArea.replaceChildren(node('p','생성 중…'));
  try{const result=await rpc<DocumentResult>('mvp.document.generate',request.payload as unknown as Record<string,unknown>,request.requestId);unconfirmedDocumentRequest=pending=undefined;return result;}
  catch(error){resultArea.replaceChildren(node('p',error instanceof Error?error.message:String(error)));again('같은 요청 다시 시도');return undefined;}
 };
 const labels=()=>settings.dictionary.keys;
 const savedLinks=():Record<string,string>=>chosenStage?settings.documentLinks?.[chosenStage]?.[profileId]||{}:{};
 const saveLinks=async(add:Record<string,string>)=>{
  if(!chosenStage||!Object.keys(add).length)return;
  const stageLinks=settings.documentLinks?.[chosenStage]||{};
  settings.documentLinks={...settings.documentLinks,[chosenStage]:{...stageLinks,[profileId]:{...stageLinks[profileId],...add}}};await saveSettings();
 };
 const plans=()=>chosenItems.map(item=>planFields(names,item,labels(),savedLinks()));
 const generate=async()=>{
  let drop:string[]=[];
  for(let attempt=0;attempt<2;attempt++){
   const planned=plans(),sent=chosenItems,acceptEmpty=planned.every(plan=>plan.empty.every(name=>acceptedEmpty.has(name)));
   const result=await send({requestId:crypto.randomUUID(),payload:{profileId,sourceKind:kind,items:sent.map((item,index)=>generationItem(item,planned[index],{acceptEmpty,blank:[...blank],drop}))}});
   if(!result)return;
   const failed=settle(result,sent);
   const collisions=[...new Set(failed.filter(r=>r.code==='FIELD_COLLISION').flatMap(r=>r.conflicts||[]))];
   // A Helper key named like a Column-mapped template field: send the failed items without it once.
   if(attempt===0&&collisions.length&&!collisions.some(name=>names.includes(name))){drop=collisions;continue;}
   const missing=[...new Set(failed.filter(r=>r.code==='MISSING_FIELDS'||r.code==='MISSING_CONDITION_FIELDS').flatMap(r=>r.missingFields||[]))].filter(name=>!names.includes(name));
   if(missing.length){names=[...names,...missing];await review();return;}
   show(failed,sent);return;
  }
 };
 const blankChoice=' blank';
 // Asks only what is still open; with nothing left it generates.
 const review=async():Promise<void>=>{
  const planned=plans();
  // A template name matched by one display label records its source key quietly (user, 2026-10-07).
  await saveLinks(Object.fromEntries(planned.flatMap(plan=>Object.entries(plan.learned)).filter(([name])=>!Object.hasOwn(savedLinks(),name))));
  const unmatched=[...new Set(planned.flatMap(plan=>plan.unmatched))].filter(name=>!blank.has(name)),emptyCount=new Map<string,number>();
  for(const plan of planned)for(const name of plan.empty)if(!acceptedEmpty.has(name))emptyCount.set(name,(emptyCount.get(name)||0)+1);
  if(!unmatched.length&&!emptyCount.size){await generate();return;}
  const box=node('div',undefined,'document-review'),picks=new Map<string,HTMLSelectElement>();
  if(unmatched.length){
   box.append(node('p','서식에서 맞는 값을 찾지 못한 항목입니다. 원천 키를 고르면 이 업무·서식에 저장해 다음부터 자동으로 넣습니다.'));
   const keys=[...new Set(chosenItems.flatMap(item=>[...documentCandidates(item).keys()]))];
   const options:[string,string][]=[['','원천 키 선택'],[blankChoice,'이번에는 빈 값으로 둠'],...keys.map(key=>[key,labels()[key]?`${labels()[key]} · ${key}`:key]as[string,string])];
   for(const name of unmatched){const pick=select(name+' 연결',options),line=node('label',undefined,'document-link');picks.set(name,pick);line.append(node('span',name),pick);box.append(line);}
  }
  let acceptEmpty:HTMLInputElement|undefined;
  if(emptyCount.size){
   box.append(node('p','이번 자료에서 값이 비어 있는 항목: '+[...emptyCount].map(([name,count])=>chosenItems.length>1?`${name}(${count}건)`:name).join(', ')));
   acceptEmpty=input('빈 값으로 넣고 생성','checkbox');const line=node('label');line.append(acceptEmpty,'빈 값으로 넣고 생성');box.append(line);
  }
  box.append(button(unmatched.length?'연결 저장 후 생성':'생성 계속',async()=>{
   if(busy)return;
   const chosen=[...picks].map(([name,pick])=>[name,pick.value]as const);
   if(chosen.some(([,value])=>!value))throw new Error('맞지 않는 항목마다 원천 키를 고르거나 빈 값으로 두기를 고르세요.');
   if(acceptEmpty&&!acceptEmpty.checked)throw new Error('빈 값으로 넣을지 확인하세요.');
   start();
   try{
    await saveLinks(Object.fromEntries(chosen.filter(([,value])=>value!==blankChoice)));
    for(const [name,value]of chosen)if(value===blankChoice)blank.add(name);
    if(acceptEmpty)for(const name of emptyCount.keys())acceptedEmpty.add(name);
    await review();
   }finally{finish();}
  }));
  resultArea.replaceChildren(box);
 };
 const fieldLabel=(field:string)=>{try{const path=JSON.parse(field);if(Array.isArray(path))return`하위 표 ${path[1]} ${Number(path[2])+1}행 ${labels()[path[3]]||path[3]}`;}catch{/* A plain source key. */}return labels()[field]||field;};
 // G2B screen output (user, 2026-10-09, #42): documents are made from collected DB records only. The selected records
 // are collected first with the screen values applied, then generated from the stored values.
 const prepare=async(picked:number[]):Promise<{items:DocumentItem[];kind:'db'}>=>{
  const chosen=picked.map(index=>sources![index]);
  for(const source of chosen)if(source.kind==='blocked')throw new Error(source.reason);
  const observations=recordSources(chosen);
  const preview=await rpc<CollectionPreview>('mvp.preview',{observations});
  await rpc('mvp.apply',{observations,token:preview.token,decisions:preview.conflicts.map(conflict=>({recordId:conflict.recordId,field:conflict.field,useIncoming:true}))});
  await collectorBridge.sendCollectedData(observations);
  const changed=[...new Set(preview.conflicts.map(conflict=>fieldLabel(conflict.field)))];
  storeNote.textContent=`DB에 ${observations.length}건 수집했습니다.`+(changed.length?` 화면 값으로 바뀐 칸: ${changed.join(', ')}.`:'')+(preview.items.some(item=>item.carriedFrom)?' 이전 차수의 사용자 열 값을 가져왔습니다.':'');
  const recordStage=observations[0].stage,stored=await rpc<ProcurementRecord[]>('mvp.records',{stage:recordStage});
  const chosenRecords=preview.items.map(item=>stored.find(record=>record.recordId===item.recordId));
  if(chosenRecords.some(record=>!record))throw new Error('저장한 자료를 DB에서 찾지 못했습니다. 다시 생성하세요.');
  const found=chosenRecords as ProcurementRecord[],view=new RecordView(stored,recordStage,settings);
  return{kind:'db',items:documentItems(found.map((record,sourceIndex)=>({sourceIndex,row:view.toRow(record)})),{kind:'db',records:found,recordIds:found.map(record=>record.recordId),view})};
 };
 const run=button('생성',async()=>{
  if(run.disabled||busy)return;
  start();
  try{
   if(pending){const sent=chosenItems.length?chosenItems:pending.payload.items,result=await send(pending);if(result)show(settle(result,sent),sent);return;}
   chosenStage=stageField.value as ProcurementStage;profileId=settings.documentProfiles?.[chosenStage]||'';if(!profileId)throw new Error('업무에 연결할 서식을 선택하세요.');
   if(!chosenItems.length&&!saved.length){
    const picked=choices.flatMap((choice,index)=>choice.checked?[index]:[]);
    if(!picked.length||picked.length>100)throw new Error('생성할 자료를 1~100건 선택하세요.');
    if(sources){const prepared=await prepare(picked);chosenItems=prepared.items;kind=prepared.kind;}
    else{const items=fixedItems||documentItems(selected,context.kind==='db'?context:{...context,stage:chosenStage});chosenItems=items.filter((_,index)=>choices[index].checked);}
   }
   if(!chosenItems.length||chosenItems.length>100)throw new Error('생성할 자료를 1~100건 선택하세요.');
   const childRows=chosenItems.reduce((count,item)=>count+childRowCount(item),0);
   childNote.textContent=childRows?`하위 표 ${childRows}행은 이번 서식에 넣지 않습니다.`:'';
   resultArea.replaceChildren(node('p','서식 항목을 확인하는 중…'));
   // Studio's 1st edition has no field-list endpoint: an item without data makes it list every value the template needs.
   const probe=await rpc<DocumentResult>('mvp.document.generate',{profileId,sourceKind:kind,items:[{...chosenItems[0],fields:{},userValues:{},children:[]}]});
   const first=probe.results[0];
   if(probe.status==='success'){if(first?.path)saved.push(first.path);chosenItems=[];resultArea.replaceChildren(node('p','서식에 채울 항목이 없어 1개 파일로 저장했습니다.'),node('p',first?.path||''));run.textContent='완료';message('문서 저장 완료');return;}
   if(!['MISSING_FIELDS','MISSING_CONDITION_FIELDS'].includes(first?.code||'')||!first?.missingFields?.length){resultArea.replaceChildren(node('p',first?.message||'서식 항목을 확인하지 못했습니다.'));again('다시 확인');return;}
   names=first.missingFields;await review();
  }catch(error){
   resultArea.replaceChildren(node('p',error instanceof Error?error.message:String(error)));again(pending?'같은 요청 다시 시도':'다시 확인');
   // Nothing chosen yet (for example a blocked row): the selection can be changed again.
   if(!pending&&!chosenItems.length&&!saved.length){choices.forEach(choice=>choice.disabled=false);stageField.disabled=!!selectedStage;}
  }
  finally{finish();}
 });
 const connect=async()=>{
  connection.replaceChildren();profileReady=false;refreshSelection();const chosenStage=stageField.value as ProcurementStage;if(!chosenStage)return;
  if(!native)throw new Error('문서 생성은 확장 프로그램에서 사용할 수 있습니다.');
  const generationKey=chosenStage,profiles=await availableDocumentProfiles();if(!d.open||stageField.value!==generationKey)return;
  const current=settings.documentProfiles?.[chosenStage],profile=profiles.find(p=>p.id===current);
  if(profile){connection.append(node('p','서식: '+profile.label));profileReady=true;resultArea.replaceChildren();refreshSelection();return;}
  connection.append(node('p','이 업무에 사용할 서식을 한 번 연결하세요.'));
  const choice=select('연결할 서식',[['','서식 선택'],...profiles.map(p=>[p.id,p.label]as[string,string])]);
  connection.append(choice,button('서식 연결 저장',async()=>{if(!choice.value)throw new Error('서식을 선택하세요.');settings.documentProfiles={...settings.documentProfiles,[chosenStage]:choice.value};await saveSettings();await connect();}));
  if(!profiles.length)connection.append(node('p','Studio lite의 Helper 연결에서 서식을 먼저 등록하세요.'));
 };
 const connectFailure=(error:unknown)=>{resultArea.replaceChildren(node('p',error instanceof Error?error.message:String(error)),button('연결 다시 확인',()=>connect().catch(connectFailure)));};
 stageField.onchange=()=>{void connect().catch(connectFailure);};
 choices.forEach(choice=>choice.onchange=refreshSelection);
 body.append(summary,detail);if(selected.length>100)body.append(node('p','한 번에 100건까지 선택하세요.'));
 body.append(stageField,connection,run,storeNote,childNote,resultArea);refreshSelection();
 if(resume){connection.append(node('p','이전 요청의 저장 결과를 확인하지 못했습니다. 새 자료를 보내기 전에 같은 요청의 결과를 확인합니다.'));stageField.disabled=true;run.textContent='같은 요청 다시 시도';}
 else await connect().catch(connectFailure);
}
async function documentDb(reason:string){
 toolbar.hidden=tabs.hidden=false;heading.textContent='DB';
 const stages=new Set(extraction?.views.map(view=>view.stage).filter(Boolean));const suggested=stages.size===1?[...stages][0]!:stage;
 try{await loadRecords(suggested);message(reason);}
 catch(error){destroyGrid();area.append(node('p',reason,'empty'),node('p',error instanceof Error?error.message:String(error),'empty'),button('DB 다시 불러오기',()=>documentDb(reason)));message('DB를 불러오지 못했습니다.',true);}
}
async function documentBridge(){
 const observations=extraction?.observations||[],items=screenDocumentItems(observations);
 if(!items.length){await documentDb(extraction?.warnings.length?'현재 화면의 업무 자료를 확인할 수 없습니다. DB에서 자료를 선택하세요.':'현재 화면에 연결된 자료가 없습니다. DB에서 자료를 선택하세요.');return;}
 isDb=false;heading.textContent='문서 생성';toolbar.hidden=tabs.hidden=true;destroyGrid();
 const start=node('div',undefined,'document-start');start.append(node('p',`현재 화면에서 ${items.length}건을 읽었습니다.`),button('자료 다시 선택',()=>generateDocuments({items,sourceKind:'screen',observations})),button('DB에서 선택',()=>documentDb('DB에서 자료를 선택하고 생성 버튼을 누르세요.')));area.append(start);message('');
 await generateDocuments({items,sourceKind:'screen',observations});
}
function demoRecords(type:ProcurementStage):ProcurementRecord[]{const identityKeys={receipt:['ctrtDmndRcptNo','ctrtDmndRcptOrd'],bid:['bidPbancNo','bidPbancOrd'],contract:['ctrtNo','ctrtChgOrd']}[type];return Array.from({length:24},(_,i)=>({stage:type,identity:[`SAMPLE-${String(i+1).padStart(3,'0')}`,'01'],recordId:'sample-'+i,storeVersion:1,fields:{[identityKeys[0]]:`SAMPLE-${String(i+1).padStart(3,'0')}`,[identityKeys[1]]:'01',사업명:'회의실 물품 구매 '+(i+1),수량:i===0?0:i,완료:false,ctrtAmt:'35608652.5',ctrtDt:dateText(today).replaceAll('.',''),dlvgdsTermYmd:'20261027',빈열:'',비고:{검토:['규격','수량']}},children:[{key:'items',label:'물품',kind:'items',rows:[{품명:'복합기',수량:1,단가:'35608652.5'}]}],source:{url:'https://www.g2b.go.kr/',areaCd:'14',depth1:'01570',depth2:'01571',framePath:'top'},rawJson:'{"sample":true}',capturedAt:'2026-10-01T00:00:00Z',userValues:type==='contract'?{종결:i===2,지정일:'20261101',종결금액:'1000',선금보증기한:'',선금보증금액:''}:{담당:'예시'}}));}
async function boot(){if(native){try{const response=await rpc<{settings:MvpSettings;storeVersion:number}>('mvp.settings.read',{});settings=response.settings;settingsVersion=response.storeVersion;}catch(error){fail(error);}}settings.columnTypes={...defaultColumnTypes,...settings.columnTypes};confirmedSettings=structuredClone(settings);theme();
 if(mode==='db'){stage=(params.get('stage')||'receipt') as ProcurementStage;if(!Object.hasOwn(stageLabels,stage))stage='receipt';await loadRecords(stage);if(params.get('notice')==='carried'){message('이전 차수의 사용자 열 값을 가져왔습니다.');const next=new URLSearchParams(location.search);next.delete('notice');history.replaceState(null,'',location.pathname+'?'+next);}}
 else if(mode==='launcher')showLauncher();else if(mode==='settings')showSettings();else{const contractDemo=demoRecords('contract'),demoView=new RecordView(contractDemo,'contract',settings);
  try{extraction=native?extractCapture(await captureCurrentPage(tabId),undefined,settings.screenRules):extractCapture({pointInfo:{areaCd:'14',depth1:'01570',depth2:'01571',depth3:'01579'},tables:{접수목록:demoRecords('receipt').map(r=>r.fields),계약목록:contractDemo.map(r=>demoView.toRow(r)),빈표:[]}},undefined,settings.screenRules);}
  catch(error){if(mode!=='document')throw error;await documentDb('현재 화면을 읽지 못했습니다. DB에서 자료를 선택하세요.');status.title+=' '+(error instanceof Error?error.message:String(error));return;}
  if(mode==='collect')await collect();else if(mode==='document')await documentBridge();else showExtraction();}}
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('dialog[open]')){event.preventDefault();close();}});
window.addEventListener('beforeunload',event=>{rememberView();if(dirty){event.preventDefault();event.returnValue='';}});
void boot().catch(fail);

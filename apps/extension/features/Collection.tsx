import {useEffect,useMemo,useState} from 'react';
import {request} from '../../../plugins/core/gateway';
import {DataGrid,type Column,type RecordRow} from '../../ui/Grid';
import {CapturePanel} from '../../ui/features/CapturePanel';
import {SettingsPanel} from '../../ui/features/SettingsPanel';
import {download,exportSheet} from '../../../plugins/files/index';
import {extensionCommand} from '../transport';
import './capture-tools.css';

type CollectionTab='raw'|'events'|'rules'|'screens'|'controls'|'links';
const tabs:{key:CollectionTab;label:string}[]=[{key:'raw',label:'수집 원본'},{key:'events',label:'이벤트'},{key:'rules',label:'수집 규칙'},{key:'screens',label:'화면'},{key:'controls',label:'컨트롤'},{key:'links',label:'직링크'}];
const object=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value);
const columnsFor=(rows:RecordRow[]):Column[]=>[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(field=>!field.startsWith('__')).map(field=>({field,label:({time:'시각',capturedAt:'수집 시각',action:'동작',detail:'상세',framePath:'frame',frameId:'frame ID',url:'URL',title:'화면 이름',dataset:'Dataset',rowCount:'행 수',pointInfo:'화면 값',fieldSources:'원천 필드',warnings:'읽기 경고',sourceId:'대상 표',sourceLabel:'표 이름',screenFilter:'화면 조건',urlFilter:'URL 조건',identityFields:'업무키',enabled:'사용',id:'ID',tag:'요소',plugin:'WebSquare 종류',ref:'원천 ref',label:'표시 이름',value:'값',events:'이벤트 속성',origin:'출처',controls:'컨트롤 수',links:'링크 수'} as Record<string,string>)[field]||field,kind:rows.some(row=>row[field]!==null&&typeof row[field]==='object')?'json':'text'}));
export function capturedFrameRows(capture:any):RecordRow[]{
 const payload=capture?.payload;if(!object(payload))return [];
 const frames=Array.isArray(payload.frames)&&payload.frames.length?payload.frames:[{framePath:'원본',url:capture.origin||payload.url||'',pointInfo:payload.pointInfo,tables:payload.tables,warnings:payload.warnings}];
 return frames.map((frame:any,index:number)=>({__rowId:'frame-'+index,framePath:frame.framePath,url:frame.url||'',pointInfo:frame.pointInfo||{},datasets:Object.keys(frame.tables||{}),rowCount:Object.values(frame.tables||{}).reduce((sum:number,rows:any)=>sum+(Array.isArray(rows)?rows.length:0),0),fieldSources:frame.fieldSources||{},warnings:frame.warnings||[]}));
}
export function CollectionPopup({report,sources}:{report:(message:string)=>void;sources:any[]}){
 const [tab,setTab]=useState<CollectionTab>('raw'),[captures,setCaptures]=useState<any[]>([]),[captureId,setCaptureId]=useState(''),[capture,setCapture]=useState<any>(),[events,setEvents]=useState<RecordRow[]>([]),[policy,setPolicy]=useState<any>(),[inspection,setInspection]=useState<any>(),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[selected,setSelected]=useState<RecordRow>(),[detail,setDetail]=useState(false),[ruleEditor,setRuleEditor]=useState(false),[error,setError]=useState('');
 async function refresh(){setBusy(true);setError('');try{const [raws,eventResult,rules]=await Promise.all([request('capture.list'),request('collector.events',{limit:1000}),request('collector.policy')]);setCaptures(Array.isArray(raws)?raws:raws.captures||[]);const actions=Array.isArray(eventResult)?eventResult:eventResult.events||eventResult.rows||[];setEvents(actions.map((event:any,index:number)=>({...event,__rowId:String(event.id||'event-'+index)})));setPolicy(rules);if(!captureId&&raws.length)setCaptureId(raws[0].captureId);}catch(error){setError(String(error));report(String(error));}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[]);
 useEffect(()=>{if(!ruleEditor)return;const timer=setTimeout(()=>window.dispatchEvent(new CustomEvent('pce-open-settings',{detail:{key:'collector.rules'}})),0);return()=>clearTimeout(timer);},[ruleEditor]);
 useEffect(()=>{if(!captureId)return;let current=true;request('capture.read',{captureId}).then(result=>{if(current)setCapture(result);}).catch(error=>{if(current)setError(String(error));});return()=>{current=false;};},[captureId]);
 const rows=useMemo(()=>{
  if(tab==='events')return events;
  if(tab==='rules')return (policy?.rules||[]).map((rule:any,index:number)=>({...rule,sourceLabel:sources.find(source=>source.sourceId===rule.sourceId)?.label||rule.sourceId,__rowId:'rule-'+index}));
  if(tab==='screens')return inspection?inspection.frames.map((frame:any,index:number)=>({__rowId:'observed-frame-'+index,frameId:frame.frameId,url:frame.url,title:frame.title,controls:frame.controls?.length||0,links:frame.links?.length||0,warnings:frame.warnings||[]})):capturedFrameRows(capture);
  if(tab==='controls')return (inspection?.frames||[]).flatMap((frame:any)=>frame.controls.map((control:any,index:number)=>({...control,frameId:frame.frameId,url:frame.url,__rowId:'control-'+frame.frameId+'-'+index})));
  if(tab==='links'){
   if(inspection)return inspection.frames.flatMap((frame:any)=>frame.links.map((link:any,index:number)=>({...link,frameId:frame.frameId,origin:frame.url,__rowId:'link-'+frame.frameId+'-'+index})));
   return capturedFrameRows(capture).filter(frame=>frame.url).map(frame=>({__rowId:frame.__rowId,label:'원본 화면 URL',url:frame.url,framePath:frame.framePath}));
  }return [];
 },[tab,events,policy,sources,inspection,capture]);
 const columns=useMemo(()=>columnsFor(rows),[rows]);
 const filtered=useMemo(()=>search.trim()?rows.filter((row:RecordRow)=>JSON.stringify(row).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())):rows,[rows,search]);
 async function inspect(){setBusy(true);setError('');try{const next=await extensionCommand({type:'inspection.read'});if(!Array.isArray(next.frames))throw Error('화면 관찰 결과 형식이 다릅니다. 확장을 다시 로드하세요.');setInspection(next);setSelected(undefined);report('현재 원천 화면의 표시 요소·링크를 읽었습니다.');}catch(error){setError(String(error));}finally{setBusy(false);}}
 async function saveInspection(){if(!inspection||busy)return;setBusy(true);try{const current=await request('settings.read',{key:'collector.inspections'});if(current.value!=null&&!Array.isArray(current.value))throw Error('기존 관찰 보관 형식을 확인하세요. 기존 설정을 덮어쓰지 않았습니다.');await request('settings.save',{key:'collector.inspections',storeVersion:current.storeVersion,value:[...(current.value||[]),{capturedAt:new Date().toISOString(),...inspection}]});report('화면 관찰 자료를 SQL 설정에 보관했습니다.');}catch(error){setError(String(error));}finally{setBusy(false);}}
 async function loadInspection(){try{const setting=await request('settings.read',{key:'collector.inspections'});const latest=Array.isArray(setting.value)?setting.value.at(-1):null;if(!latest)throw Error('보관한 화면 관찰이 없습니다. 현재 화면 읽기 후 보관하세요.');setInspection(latest);setSelected(undefined);report('최근 보관 관찰: '+latest.capturedAt);}catch(error){setError(String(error));}}
 function canLeave(){const check=new Event('pce:close-check',{cancelable:true});window.dispatchEvent(check);return !check.defaultPrevented||confirm('저장하지 않은 설정 변경을 버릴까요?');}
 function changeTab(next:CollectionTab){if(!canLeave())return;setTab(next);setSearch('');setSelected(undefined);setDetail(false);setRuleEditor(false);}
 return <section className="capture-workspace"><div className="capture-tabs" role="tablist" aria-label="수집 관리 보기">{tabs.map(entry=><button role="tab" key={entry.key} aria-selected={tab===entry.key} onClick={()=>changeTab(entry.key)}>{entry.label}</button>)}</div>
  {tab==='raw'?<div className="collection-review"><CapturePanel report={report} gridList/></div>:<>
  <div className="capture-toolbar"><input aria-label="수집 관리 검색" type="search" placeholder="목록 검색" value={search} onChange={event=>setSearch(event.target.value)}/><button disabled={busy} onClick={()=>void refresh()}>다시 읽기</button>{['screens','controls','links'].includes(tab)&&<><button disabled={busy} onClick={()=>void inspect()}>현재 화면 읽기</button><button disabled={busy||!inspection} onClick={()=>void saveInspection()}>관찰 보관</button><button disabled={busy} onClick={()=>void loadInspection()}>최근 관찰</button></>}<span className="capture-spacer"/><button disabled={!selected} onClick={()=>setDetail(!detail)}>선택 상세</button><button disabled={!filtered.length} onClick={()=>exportSheet('pce-collection-'+tab,filtered,columns,'xlsx',true)}>XLSX</button><button disabled={!filtered.length} onClick={()=>download('pce-collection-'+tab+'.json',JSON.stringify(filtered.map(({__rowId,...row}:RecordRow)=>row),null,2))}>JSON</button>{tab==='rules'&&<button onClick={()=>{if(canLeave())setRuleEditor(!ruleEditor);}}>규칙 편집</button>}</div>
  {['screens','links'].includes(tab)&&<div className="capture-toolbar"><label>수집 원본<select aria-label="화면 출처 원본" value={captureId} onChange={event=>{setCaptureId(event.target.value);setInspection(undefined);setSelected(undefined);}}><option value="">원본 선택</option>{captures.map(entry=><option key={entry.captureId} value={entry.captureId}>{entry.capturedAt} · {entry.origin||entry.captureId}</option>)}</select></label><span className="muted">{inspection?'현재 또는 보관 관찰':'선택한 수집 원본의 frame 정보'}</span></div>}
  {tab==='rules'&&<small className="muted">{policy?.rules===null||policy?.includeDefaults?'기본 나라장터 규칙 사용':'사용자 규칙만 사용'} · 사용자 규칙 {rows.length}개</small>}
  {ruleEditor?<div className="collection-rule-editor"><SettingsPanel sources={sources} report={report}/></div>:<div className="capture-main-grid"><DataGrid rows={filtered} columns={columns} readOnly onSelect={setSelected}/></div>}
  {detail&&selected&&<div className="capture-detail"><pre>{JSON.stringify(selected,null,2)}</pre></div>}
  <small className="muted">{filtered.length} / {rows.length}건{tab==='events'?' · 최근 1000개까지':''}{tab==='controls'&&!inspection?' · 현재 화면 읽기로 컨트롤을 확인하세요.':''}</small>
  </>}{error&&<p className="error" role="alert">{error}</p>}
  <details><summary>자료 출처·보관 범위</summary><p>수집 원본은 저장된 현재 로딩 자료입니다. 이벤트는 저장·반영 등 Gateway 동작 이력이며 브라우저 클릭·네트워크 요청 전체가 아닙니다. 현재 화면 읽기는 컨트롤과 실제 링크를 관찰하고 실행하지 않습니다. 원본 화면 URL과 실행 스크립트는 구분됩니다.</p></details>
 </section>;
}

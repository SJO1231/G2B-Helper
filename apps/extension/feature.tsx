import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DatabasePopup} from './features/Database';
import {CatalogPopup} from './features/Catalog';
import {request} from '../../plugins/core/gateway';
import {CapturePanel,RelationPanel,SqlPanel,BackupPanel} from '../ui/Panels';
import {ExtractPopup} from './features/Extract';
import {DocumentsPopup} from './features/Documents';
import {LauncherPopup} from './features/Launcher';
import {ExplorerPopup} from './features/Explorer';
import {WorkPopup} from './features/Work';
import {NotesPopup} from './features/Notes';
import {CollectionPopup} from './features/Collection';
import {AggregationPopup} from './features/Aggregation';
import {AppearancePopup} from './features/Settings';
import {applyTheme} from './theme';
import {extensionCommand} from './transport';
import './feature.css';
import './theme.css';

const params=new URLSearchParams(location.search),surface=params.get('surface')||'db';
const titles:Record<string,string>={aggregate:'Excel 취합',settings:'설정',sql:'SQL 조회',backup:'백업 · 복원',extract:'임시 추출',db:'DB 브라우저',notes:'메모 · 일정',documents:'문서 생성',dictionary:'사전 · 설정',collection:'수집 관리',explorer:'업무 폴더',launcher:'런처',relations:'관계 · 통합 뷰',work:'업무 화면 설정'};
function FeatureWindow(){
 useEffect(()=>{const refresh=()=>request('settings.read',{key:'ui.appearance'}).then(result=>applyTheme(document.documentElement,result.value?.theme)).catch(()=>applyTheme(document.documentElement,'light'));void refresh();const listener=(message:any,sender:chrome.runtime.MessageSender)=>{if(sender.id===chrome.runtime.id&&message.type==='ui.refresh')void refresh();};chrome.runtime.onMessage.addListener(listener);return()=>chrome.runtime.onMessage.removeListener(listener);},[]);
 useEffect(()=>{const close=(message:any,sender:chrome.runtime.MessageSender)=>{if(sender.id!==chrome.runtime.id||message.type!=='surface.close.request'||message.panelId!==params.get('panelId'))return;const check=new Event('pce:close-check',{cancelable:true});window.dispatchEvent(check);const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);if((check.defaultPrevented||unload.defaultPrevented)&&!confirm('저장하지 않은 변경을 버리고 닫을까요?'))return;void extensionCommand({type:'surface.closed',panelId:params.get('panelId')});};chrome.runtime.onMessage.addListener(close);return()=>chrome.runtime.onMessage.removeListener(close);},[]);
 const [context,setContext]=useState<any>({}),[notice,setNotice]=useState(''),[sources,setSources]=useState<any[]>([]);
 useEffect(()=>{document.title='PCE · '+(titles[surface]||'업무 도구');extensionCommand({type:'context.read'}).then(setContext).catch(error=>setNotice('원천 탭: '+error));request('table.list').then(result=>{setSources(Array.isArray(result)?result:result.sources);setNotice('');}).catch(error=>setNotice('로컬 DB에 연결할 수 없습니다. Native Host 설치 안내를 확인하세요. '+error));},[]);
 const shared={report:setNotice,sourceId:params.get('sourceId')||undefined,rowId:params.get('rowId')||undefined,mode:params.get('mode')||undefined};
 return <div className={'feature-window'+(params.has('embedded')?' embedded':'')+(params.get('mode')==='sticky'?' sticky':'')}><header className="feature-header">{context.screenCandidates?.length>1&&<label>연결 화면<select aria-label="메모·업무 연결 화면" value={context.selectedFramePath||''} onChange={event=>{extensionCommand({type:'context.select',framePath:event.target.value}).then(setContext).catch(error=>setNotice(String(error)));}}><option value="">화면을 선택하세요</option>{context.screenCandidates.map((candidate:any)=><option key={candidate.framePath} value={candidate.framePath}>{candidate.label||candidate.framePath}</option>)}</select></label>}</header><div className="feature-notice" role="status" hidden={params.get('mode')==='sticky'&&/^(SQLite 연결됨|저장했습니다)/.test(notice)}>{notice}</div>{surface==='settings'?<AppearancePopup {...shared}/>:surface==='aggregate'?<AggregationPopup {...shared}/>:surface==='collection'?<CollectionPopup {...shared} sources={sources}/>:surface==='db'?<DatabasePopup {...shared}/>:surface==='extract'?<ExtractPopup {...shared}/>:surface==='notes'?<div className="feature-content"><NotesPopup {...shared} context={context}/></div>:surface==='documents'?<DocumentsPopup {...shared} context={context}/>:surface==='launcher'?<LauncherPopup {...shared}/>:surface==='explorer'?<ExplorerPopup {...shared} context={context}/>:surface==='work'?<WorkPopup {...shared}/>:<div className="feature-content">{surface==='sql'?<SqlPanel {...shared}/>:surface==='backup'?<BackupPanel {...shared} sources={sources}/>:surface==='dictionary'?<CatalogPopup {...shared} sources={sources}/>:surface==='collection'?<CapturePanel {...shared} gridList/>:surface==='relations'?<RelationPanel {...shared} sources={sources}/>:<p>지원하지 않는 도구입니다.</p>}</div>}</div>;
}
class FeatureErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message};}render(){return this.state.error?<main className="feature-content"><h1>화면을 열지 못했습니다</h1><p>{this.state.error}</p><p>이 오류로 저장된 SQLite 자료를 변경하지 않았습니다. 창을 닫고 다시 열어 주세요.</p></main>:this.props.children;}}
createRoot(document.getElementById('root')!).render(<FeatureErrorBoundary><FeatureWindow/></FeatureErrorBoundary>);

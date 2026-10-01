import { performPageAction, performWorkAction, type PageAction, type WorkActionRequest } from '../../plugins/page-actions/index';
import type { CapturePayload, CollectionPolicy, GatewayRequest, GatewayResponse } from '../../packages/contracts/src/index';
import { collectPage, mergeFrameCaptures } from '../../plugins/collector/extractor';
import { createCapture, createBundle } from '../../plugins/collector/transfer';
import { evaluateCollectionScope, parseCollectionPolicy } from '../../plugins/collector/scope';
import {inspectPage} from './inspection';

const HOST = 'com.pce.gateway';
const maxNativeRequestBytes=60*1024*1024;
const maxNativeResponseBytes=100*1024*1024;
let nativePort: chrome.runtime.Port | undefined;
type Waiting = { resolve: (result: GatewayResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; parts?: Map<number,string>; total?: number; bytes?:number };
const waiting = new Map<string, Waiting>();
function failure(error: unknown) { return error instanceof Error ? error.message : String(error); }
function nativeRequest(request: GatewayRequest): Promise<GatewayResponse> {
  return new Promise((resolve,reject) => {
    if (!request || request.protocolVersion !== 1 || typeof request.requestId !== 'string' || typeof request.command !== 'string') { reject(new Error('Gateway 요청 형식이 올바르지 않습니다.')); return; }
    if (waiting.has(request.requestId)) { reject(new Error('같은 요청 ID가 이미 처리 중입니다.')); return; }
    try {
      const requestBytes=new TextEncoder().encode(JSON.stringify(request)).byteLength;
      if(requestBytes>maxNativeRequestBytes)throw new Error('Native 요청 JSON이 60 MiB 전송 한도를 초과했습니다 ('+(requestBytes/1024/1024).toFixed(1)+' MiB). HWPX 파일 크기와 JSON 전송 크기는 다릅니다. 자료 크기를 줄이거나 나누어 저장하세요.');
      if (!nativePort) {
        nativePort = chrome.runtime.connectNative(HOST);
        nativePort.onMessage.addListener((message: GatewayResponse & { chunk?: {index:number;total:number;text:string} }) => {
          const pending = waiting.get(message.requestId); if (!pending) return;
          try {
            if (message.chunk) {
              const {index,total,text} = message.chunk;
              if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || total > 4096 || index >= total || typeof text !== 'string' || text.length > 300000) throw new Error('Native Host 응답 조각 형식이 올바르지 않습니다 (최대 4096개).');
              if (pending.total !== undefined && pending.total !== total) throw new Error('응답 조각 개수가 변경되었습니다.');
              pending.total = total; pending.parts ??= new Map();
              if (pending.parts.has(index) && pending.parts.get(index) !== text) throw new Error('응답 조각이 충돌합니다.');
              if(!pending.parts.has(index)) {
                const bytes=(pending.bytes??0)+new TextEncoder().encode(text).byteLength;
                if(bytes>maxNativeResponseBytes)throw new Error('Native Host 응답이 전체 100 MiB 전송 한도를 초과했습니다. 자료를 나누어 조회하세요.');
                pending.bytes=bytes;
              }
              pending.parts.set(index,text);
              if (pending.parts.size < total) return;
              const envelope = JSON.parse(Array.from({length:total},(_,i) => pending.parts!.get(i)).join('')) as GatewayResponse;
              if (envelope.requestId !== message.requestId || envelope.protocolVersion !== 1) throw new Error('응답 ID 또는 버전이 다릅니다.');
              clearTimeout(pending.timer); waiting.delete(message.requestId); pending.resolve(envelope);
            } else {
              if (message.protocolVersion !== 1) throw new Error('지원하지 않는 응답 버전입니다.');
              if(new TextEncoder().encode(JSON.stringify(message)).byteLength>maxNativeResponseBytes)throw new Error('Native Host 응답이 전체 100 MiB 전송 한도를 초과했습니다. 자료를 나누어 조회하세요.');
              clearTimeout(pending.timer); waiting.delete(message.requestId); pending.resolve(message);
            }
          } catch(error) { clearTimeout(pending.timer); waiting.delete(message.requestId); pending.reject(new Error(failure(error))); }
        });
        nativePort.onDisconnect.addListener(() => {
          const detail = chrome.runtime.lastError?.message || 'Native Host 연결 종료';
          nativePort = undefined;
          for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('PCE 데스크탑 연결 실패: ' + detail + '. Native Host 설치와 확장 ID 등록을 확인하세요.')); }
          waiting.clear();
        });
      }
      const timer = setTimeout(() => { waiting.delete(request.requestId); reject(new Error('데스크탑 응답 시간 초과. 저장 여부를 조회한 뒤 같은 요청 ID로 재시도하세요.')); }, 90000);
      waiting.set(request.requestId,{resolve,reject,timer});
      nativePort.postMessage(request);
    } catch(error) {
      const pending=waiting.get(request.requestId); if(pending) clearTimeout(pending.timer);
      waiting.delete(request.requestId); reject(new Error(failure(error)));
    }
  });
}
const busyTabs = new Map<number,Promise<unknown>>();
const submittedWrites = new Map<number,number>();
const automaticGenerations = new Map<number,number>();
function invalidateAutomatic(tabId:number):number {const generation=(automaticGenerations.get(tabId)??0)+1;automaticGenerations.set(tabId,generation);return generation;}
const alarmPrefix = 'pce-capture:';
async function activeTab(explicit?: number): Promise<chrome.tabs.Tab> {
  const tab = explicit !== undefined ? await chrome.tabs.get(explicit) : (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];
  if (tab?.id === undefined || !tab.url || !/^https?:/.test(tab.url)) throw new Error('자료가 있는 HTTP/HTTPS 탭을 선택하세요.');
  return tab;
}
async function captureTab(tab: chrome.tabs.Tab, persist: boolean, applyAutomatic = false, continuing=()=>true) {
  const ensureCurrent=()=>{if(!continuing())throw new Error('자동 수집을 정지하여 후속 저장 요청을 취소했습니다.');};
  const write=async(request:GatewayRequest)=>{
    ensureCurrent();
    submittedWrites.set(tab.id!,(submittedWrites.get(tab.id!)??0)+1);
    try{return await nativeRequest(request);}
    finally{const left=(submittedWrites.get(tab.id!)??1)-1;if(left)submittedWrites.set(tab.id!,left);else submittedWrites.delete(tab.id!);}
  };
  let policy:CollectionPolicy|undefined;
  if(persist){
    const response=await nativeRequest({protocolVersion:1,requestId:crypto.randomUUID(),command:'collector.policy',payload:{}});
    if(response.error)throw new Error(response.error.message);
    policy=parseCollectionPolicy(response.result);
  }
  const results = await chrome.scripting.executeScript({target:{tabId:tab.id!,allFrames:true},world:'MAIN',func:collectPage,args:[false]});
  const extracted = mergeFrameCaptures(results);
  if (!results.length) extracted.warnings.push('읽을 수 있는 frame이 없습니다.');
  extracted.warnings.push('접근 권한이 없는 frame은 포함되지 않을 수 있습니다. 현재 로딩된 자료만 수집했습니다.');
  let payload:CapturePayload=extracted;
  const origin = new URL(tab.url!).origin;
  if(persist){
    const current=await activeTab(tab.id);
    if(current.url!==tab.url)throw new Error('화면 이동을 확인하여 수집을 중단했습니다. 현재 화면에서 다시 시작하세요.');
    const scope=evaluateCollectionScope(payload,policy!);
    if(!scope.allowed)throw new Error(scope.reason+(extracted.warnings.length?' 읽기 경고: '+extracted.warnings.join(' '):'')+' 임시 추출 또는 수집 규칙 설정을 사용하세요.');
    payload=scope.filteredPayload!;
    // Policy URL and source data must refer to the same document in each selected frame.
    if(payload.frames?.length) {
      const frameIds=[...new Set(payload.frames.map(frame=>Number(/^frame:(\d+)\//.exec(frame.framePath)?.[1])))];
      if(frameIds.some(id=>!Number.isSafeInteger(id)))throw new Error('수집 frame 출처를 확인할 수 없습니다.');
      const locations=await chrome.scripting.executeScript({target:{tabId:tab.id!,frameIds},world:'MAIN',func:()=>window.location.href});
      for(const frame of payload.frames) {
        const frameId=Number(/^frame:(\d+)\//.exec(frame.framePath)![1]);
        const location=locations.find(item=>item.frameId===frameId)?.result;
        if(typeof location!=='string'||location!==frame.url)throw new Error('수집 frame이 이동했습니다. 현재 화면에서 다시 시작하세요.');
      }
    }
  }
  const capture = createCapture(payload,origin,undefined,persist?'collection':undefined);
  // Each collection is a distinct event. Replaying its exported bundle preserves
  // the event ID; equal observations from later collections retain their history.
  const bundle = createBundle([capture],origin,policy?{collectionPolicy:policy}:undefined);
  if (!persist) return {payload,bundle};
  const reply = await write({protocolVersion:1,requestId:crypto.randomUUID(),command:'capture.collect',payload:{bundle,policyVersion:policy!.storeVersion}});
  if (reply.error) throw new Error(reply.error.message);
  const automaticResults: unknown[] = [];
  for (const captureId of (reply.result as {captureIds?:string[]})?.captureIds || []) {
    ensureCurrent();
    const preview = await nativeRequest({protocolVersion:1,requestId:crypto.randomUUID(),command:'collector.preview',payload:{captureId}});
    if(preview.error) throw new Error(preview.error.message);
    const proposal=preview.result as {status:string;previewToken:string};
    if(proposal.status !== 'ready' || !applyAutomatic) { automaticResults.push(preview.result); continue; }
    const applied=await write({protocolVersion:1,requestId:crypto.randomUUID(),command:'collector.apply',payload:{captureId,previewToken:proposal.previewToken,decisions:[]}});
    if(applied.error) throw new Error(applied.error.message);
    automaticResults.push(applied.result);
  }
  await chrome.storage.session.set({ ['lastCapture:' + tab.id]: {capturedAt:new Date().toISOString(),error:null} });
  return {payload,bundle,importResult:reply.result,automaticResults,reviewPending:!applyAutomatic};
}
async function collectOnce(tab: chrome.tabs.Tab, applyAutomatic = false, continuing=()=>true) {
  if (busyTabs.has(tab.id!)) return busyTabs.get(tab.id!);
  const task = captureTab(tab,true,applyAutomatic,continuing).finally(() => busyTabs.delete(tab.id!));
  busyTabs.set(tab.id!,task); return task;
}
async function captureCommand(message: {mode:string;tabId?:number}) {
  if(message.mode === 'stop') {
    // Stopping must work even after navigation to a page we cannot inspect.
    const tabId=message.tabId ?? (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.id;
    if(tabId===undefined)throw new Error('정지할 탭이 없습니다.');
    invalidateAutomatic(tabId);
    try { await chrome.alarms.clear(alarmPrefix+tabId); }
    finally { await chrome.storage.session.set({['autoCapture:' + tabId]:false}); }
    const pendingWritesMayComplete=(submittedWrites.get(tabId)??0)>0;
    return {active:false,inFlight:busyTabs.has(tabId),pendingWritesMayComplete,message:pendingWritesMayComplete?'정지했습니다. 이미 전달한 저장 요청은 완료될 수 있으므로 결과를 확인하세요.':'정지했습니다. 자동 수집의 후속 저장 요청은 시작하지 않습니다.'};
  }
  const tab = await activeTab(message.tabId);
  const name = alarmPrefix + tab.id;
  if(message.mode === 'status') {
    const state = await chrome.storage.session.get(['lastCapture:' + tab.id]);
    return {active:!!await chrome.alarms.get(name),last:state['lastCapture:' + tab.id]};
  }
  if(message.mode === 'extract') return captureTab(tab,false);
  if(message.mode === 'start') {
    const generation=invalidateAutomatic(tab.id!);
    const current=()=>automaticGenerations.get(tab.id!)===generation;
    try {
      const result=await collectOnce(tab,true,current);
      if(!current())return {active:false,cancelled:true};
      await chrome.alarms.create(name,{periodInMinutes:0.5});
      if(!current()){await chrome.alarms.clear(name);return {active:false,cancelled:true};}
      await chrome.storage.session.set({['autoCapture:' + tab.id]:true});
      if(!current()){await chrome.alarms.clear(name);await chrome.storage.session.set({['autoCapture:' + tab.id]:false});return {active:false,cancelled:true};}
      return {...result as object,active:true,intervalSeconds:30};
    }catch(error){
      if(!current())return {active:false,cancelled:true};
      await chrome.alarms.clear(name);
      await chrome.storage.session.set({['autoCapture:' + tab.id]:false});
      return {active:false,error:failure(error)};
    }
  }
  if(message.mode === 'once') return collectOnce(tab);
  throw new Error('지원하지 않는 수집 명령입니다.');
}
chrome.alarms.onAlarm.addListener(alarm => {
  if(!alarm.name.startsWith(alarmPrefix)) return;
  const tabId=Number(alarm.name.slice(alarmPrefix.length));
  const generation=automaticGenerations.get(tabId)??0;
  void chrome.alarms.get(alarm.name).then(async scheduled=>{
    if(!scheduled||(automaticGenerations.get(tabId)??0)!==generation)return;
    const tab=await activeTab(tabId);
    if((automaticGenerations.get(tabId)??0)!==generation)return;
    return collectOnce(tab,true,()=>(automaticGenerations.get(tabId)??0)===generation);
  }).catch(async error => {
    if((automaticGenerations.get(tabId)??0)!==generation)return;
    invalidateAutomatic(tabId);
    await chrome.alarms.clear(alarm.name);
    await chrome.storage.session.set({['autoCapture:' + tabId]:false});
    await chrome.storage.session.set({['lastCapture:' + tabId]:{error:failure(error),capturedAt:new Date().toISOString()}});
  });
});
chrome.tabs.onRemoved.addListener(tabId => { invalidateAutomatic(tabId);void chrome.alarms.clear(alarmPrefix+tabId); });
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.getAll().then(alarms => Promise.all(alarms.filter(a=>a.name.startsWith(alarmPrefix)).map(a=>chrome.alarms.clear(a.name))));
});
chrome.action?.onClicked.addListener(tab => {
  if(tab.id===undefined || !tab.url || !/^https?:/.test(tab.url))return;
  void chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',files:['widget.js']}).catch(error=>{
    void chrome.storage.session.set({['widgetError:'+tab.id]:failure(error)});
  });
});

async function gatewayValue(command:string,payload:Record<string,unknown>={}) {
  const response=await nativeRequest({protocolVersion:1,requestId:crypto.randomUUID(),command,payload});
  if(response.error)throw new Error(response.error.message);
  return response.result;
}
async function executeUserScript(tabId:number,code:unknown) {
  const tab=await activeTab(tabId);
  try { await chrome.userScripts.getScripts(); }
  catch { throw new Error('Chrome 확장 관리 → PCE 세부정보 → 사용자 스크립트 허용을 켠 뒤 다시 실행하세요. 사이트 접근 권한도 필요합니다.'); }
  if(typeof code!=='string'||!code.trim())throw new Error('실행할 스크립트가 없습니다.');
  return chrome.userScripts.execute({target:{tabId:tab.id!},js:[{code}],world:'MAIN'});
}
async function openSurface(message:any) {
  const surfaces=['sql','backup','extract','aggregate','settings','db','notes','documents','dictionary','collection','explorer','launcher','relations','work'];
  if(!surfaces.includes(message.surface))throw new Error('지원하지 않는 기능창입니다.');
  const tab=await activeTab(message.tabId);
  const url=new URL(chrome.runtime.getURL('feature.html'));
  url.searchParams.set('surface',message.surface);url.searchParams.set('sourceTabId',String(tab.id));
  for(const key of ['sourceId','rowId','mode']) {
    if(message[key]!==undefined) {
      if(typeof message[key]!=='string'||message[key].length>2000)throw new Error('기능창 문맥을 확인하세요.');
      url.searchParams.set(key,message[key]);
    }
  }
  const panelId=JSON.stringify([message.surface,message.sourceId||'',message.rowId||'',message.mode||'',message.surface==='notes'&&message.mode==='sticky'&&!message.rowId?crypto.randomUUID():'']);
  url.searchParams.set('embedded','1');url.searchParams.set('panelId',panelId);
  const presentation={type:'surface.present',surface:message.surface,panelId,url:url.href};
  try {await chrome.tabs.sendMessage(tab.id!,presentation,{frameId:0});}
  catch {await chrome.scripting.executeScript({target:{tabId:tab.id!,frameIds:[0]},world:'ISOLATED',files:['widget.js']});await chrome.tabs.sendMessage(tab.id!,presentation,{frameId:0});}
  return {sourceTabId:tab.id,panelId,url:url.href};
}
async function readContext(tabId:number) {
  const tab=await activeTab(tabId);
  const results=await chrome.scripting.executeScript({target:{tabId:tab.id!,allFrames:true},world:'MAIN',func:collectPage,args:[false]});
  const capture=mergeFrameCaptures(results);
  const current=await activeTab(tab.id!);
  if(current.url!==tab.url) {
    await chrome.storage.session.set({['screenContext:'+tab.id]:null});
    throw new Error('화면 문맥을 읽는 중 탭이 이동했습니다. 현재 화면을 다시 읽으세요.');
  }
  // Selection is UI state only; identities always come from the current frame read.
  const screenFields=['areaCd','depth1','depth2'] as const;
  const scalar=(value:unknown)=>value!==null&&value!==undefined&&['string','number','boolean'].includes(typeof value)&&!(typeof value==='string'&&!value.trim())&&!(typeof value==='number'&&!Number.isFinite(value));
  const identity=(point:Record<string,unknown>)=>screenFields.map(key=>scalar(point[key])?point[key]:'');
  const screenCandidates=capture.frames.filter(frame=>screenFields.some(key=>scalar(frame.pointInfo[key]))).map(frame=>({framePath:frame.framePath,label:frame.framePath+' · '+screenFields.map(key=>frame.pointInfo[key]).filter(scalar).join(' / '),url:frame.url,pointInfo:frame.pointInfo}));
  const key='screenContext:'+tab.id;
  const stored=(await chrome.storage.session.get([key]))[key] as {tabUrl?:string;framePath?:string;frameUrl?:string;identity?:string}|null|undefined;
  let primary=stored&&stored.tabUrl===tab.url?screenCandidates.find(candidate=>candidate.framePath===stored.framePath&&candidate.url===stored.frameUrl&&JSON.stringify(identity(candidate.pointInfo))===stored.identity):undefined;
  if(stored&&!primary)await chrome.storage.session.set({[key]:null});
  if(!primary&&screenCandidates.length===1)primary=screenCandidates[0];
  const requiresScreenSelection=screenCandidates.length>1&&!primary;
  const tuple=[tab.url||'',...identity(primary?.pointInfo||{})];
  const screenKey=requiresScreenSelection?'':JSON.stringify(tuple);
  return {tabId:tab.id,url:tab.url,title:tab.title||'',screenKey,pointInfo:primary?.pointInfo||{},frames:capture.frames,warnings:capture.warnings,screenCandidates,requiresScreenSelection,selectedFramePath:primary?.framePath};
}
async function selectContext(message:any) {
  if(typeof message.framePath!=='string'||!message.framePath.trim())throw new Error('선택할 화면 frame 경로를 확인하세요.');
  const context=await readContext(message.tabId);
  const candidate=context.screenCandidates.find(item=>item.framePath===message.framePath);
  if(!candidate)throw new Error('선택한 화면이 현재 탭에 없습니다. 현재 화면을 다시 읽으세요.');
  const current=await activeTab(message.tabId);
  if(current.url!==context.url)throw new Error('화면 선택 중 탭이 이동했습니다. 현재 화면을 다시 읽으세요.');
  const scalar=(value:unknown)=>value!==null&&value!==undefined&&['string','number','boolean'].includes(typeof value)&&!(typeof value==='string'&&!value.trim())&&!(typeof value==='number'&&!Number.isFinite(value));
  const identity=JSON.stringify(['areaCd','depth1','depth2'].map(key=>scalar(candidate.pointInfo[key])?candidate.pointInfo[key]:''));
  await chrome.storage.session.set({['screenContext:'+context.tabId]:{tabUrl:context.url,framePath:candidate.framePath,frameUrl:candidate.url,identity}});
  return readContext(context.tabId!);
}
async function workAction(message:any) {
  const tab=await activeTab(message.tabId);
  const action=message.action as WorkActionRequest;
  if(!action || !['detect','yearShift','yearRange','setRowCount','search','excel'].includes(action.kind))throw new Error('업무 동작 종류를 확인하세요.');
  if(message.frameId!==undefined && (!Number.isSafeInteger(message.frameId)||message.frameId<0))throw new Error('업무 frame ID를 확인하세요.');
  const target:chrome.scripting.InjectionTarget=message.frameId===undefined?{tabId:tab.id!,allFrames:true}:{tabId:tab.id!,frameIds:[message.frameId]};
  const inspected=await chrome.scripting.executeScript({target,world:'MAIN',func:performWorkAction,args:[{...action,traverseFrames:false,mode:'inspect'}]});
  const frames=inspected.map(item=>({frameId:item.frameId,result:item.result}));
  const candidates=frames.flatMap(frame=>(frame.result?.candidates||[]).map(candidate=>({...candidate,frameId:frame.frameId})));
  const warnings=frames.flatMap(frame=>(frame.result?.warnings||[]).map(warning=>'frame '+frame.frameId+': '+warning));
  if(action.kind==='detect')return {status:candidates.length?'ready':'unavailable',candidates,frames,warnings,clicked:false,message:candidates.length?'현재 탭의 frame별 업무 후보입니다.':'업무 후보를 찾지 못했습니다.'};
  const matching=frames.filter(frame=>frame.result?.status==='ready'||frame.result?.status==='needsSelection');
  if(matching.length>1 || matching.some(frame=>frame.result?.status==='needsSelection'))return {status:'needsSelection',candidates,frames,warnings,clicked:false,message:'frame과 업무 요소를 선택하세요.'};
  const chosen=matching[0];
  if(!chosen) {
    const detailed=frames.find(frame=>frame.result?.status==='invalid') || frames.find(frame=>frame.result?.candidates.length) || frames[0];
    return {...detailed?.result,status:detailed?.result?.status||'unavailable',candidates,frames,warnings,frameId:detailed?.frameId,clicked:false,message:detailed?.result?.message||'업무 요소를 찾지 못했습니다.'};
  }
  if(action.mode==='inspect')return {...chosen.result,candidates,frames,warnings,frameId:chosen.frameId};
  const applied=await chrome.scripting.executeScript({target:{tabId:tab.id!,frameIds:[chosen.frameId]},world:'MAIN',func:performWorkAction,args:[{...action,traverseFrames:false,mode:'apply'}]});
  if(applied.length!==1 || !applied[0].result)throw new Error('업무 동작 실행 frame 결과를 확인할 수 없습니다.');
  return {...applied[0].result,frameId:chosen.frameId,candidates,frames,warnings:[...warnings,...applied[0].result.warnings]};
}
async function runLauncher(message:any) {
  if(typeof message.rowId!=='string'||!message.rowId.trim()||message.rowId.length>200)throw new Error('실행할 런처 레코드 ID를 확인하세요.');
  // SQL reads only the public read-only record view. User text is a quoted literal.
  const rowLiteral="'"+message.rowId.replaceAll("'","''")+"'";
  const value=await gatewayValue('query.execute',{sql:'SELECT content FROM pce_records WHERE source_id = \'launchers\' AND row_id = '+rowLiteral+' LIMIT 2'}) as {rows?:{content:unknown}[]};
  if(value?.rows?.length!==1 || typeof value.rows[0].content!=='string')throw new Error('런처 레코드를 하나 찾지 못했습니다.');
  const launcher=JSON.parse(value.rows[0].content) as {kind?:unknown;target?:unknown};
  if(typeof launcher.target!=='string'||!launcher.target.trim())throw new Error('런처 대상이 비어 있습니다.');
  if(launcher.kind==='script')return {kind:'script',results:await executeUserScript(message.tabId,launcher.target)};
  if(launcher.kind==='url'||launcher.kind==='internal') {
    const url=new URL(launcher.target);
    if(!['http:','https:'].includes(url.protocol))throw new Error('HTTP/HTTPS 런처 주소만 열 수 있습니다.');
    const opened=await chrome.tabs.create({url:url.href});return {kind:launcher.kind,tabId:opened.id,opened:url.href};
  }
  if(!['file','folder'].includes(String(launcher.kind)))throw new Error('지원하지 않는 런처 종류입니다.');
  return gatewayValue('launcher.execute',{rowId:message.rowId});
}
async function handle(message: any) {
  if(message.type==='ui.refresh') {await chrome.tabs.sendMessage(message.tabId,{type:'ui.refresh'});return {ok:true};}
  if(message.type==='inspection.read') {
    const tab=await activeTab(message.tabId);
    const context=await readContext(tab.id!);
    const frames=await chrome.scripting.executeScript({target:{tabId:tab.id!,allFrames:true},world:'MAIN',func:inspectPage});
    return {context,frames:frames.filter(frame=>frame.result).map(frame=>({frameId:frame.frameId,...frame.result}))};
  }
  if(message.type === 'gateway') return nativeRequest(message.request);
  if(message.type === 'capture') return captureCommand(message);
  if(typeof message.type==='string' && message.type.startsWith('capture.')) return captureCommand({...message,mode:message.type.slice('capture.'.length)});
  if(message.type === 'surface.open')return openSurface(message);
  if(message.type==='surface.requestClose'||message.type==='surface.closed'){await chrome.tabs.sendMessage(message.tabId,{type:message.type==='surface.requestClose'?'surface.close.request':'surface.closed',panelId:message.panelId});return {ok:true};}
  if(message.type === 'context.read')return readContext(message.tabId);
  if(message.type === 'context.select')return selectContext(message);
  if(message.type === 'work.action')return workAction(message);
  if(message.type === 'launcher.run')return runLauncher(message);
  if(message.type === 'workspace.open') { const tab=await chrome.tabs.create({url:chrome.runtime.getURL('workspace.html')}); return {tabId:tab.id}; }
  if(message.type === 'script.execute') {
    const tab=await activeTab(message.tabId);return executeUserScript(tab.id!,message.code);
  }
  if(message.type === 'page.action') {
    const tab=await activeTab(message.tabId); const action=message.action as PageAction;
    if(!action || !['click','setValue','dateShift','readText'].includes(action.kind) || typeof action.selector !== 'string' || !action.selector.trim())throw new Error('저장된 업무 요소 설정을 확인하세요.');
    return chrome.scripting.executeScript({target:{tabId:tab.id!},world:'MAIN',func:performPageAction,args:[action]});
  }
  throw new Error('알 수 없는 PCE 명령입니다.');
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  const extensionPage=sender.url?.startsWith(chrome.runtime.getURL(''));
  const widget=!extensionPage && sender.tab?.id!==undefined && /^https?:/.test(sender.url||'');
  if(sender.id !== chrome.runtime.id || (!extensionPage&&!widget)) { sendResponse({error:'확장 화면에서만 명령을 실행할 수 있습니다.'}); return false; }
  if(!message || typeof message.type!=='string'){sendResponse({error:'PCE 메시지 형식을 확인하세요.'});return false;}
  let routed={...message};
  if(widget) {
    const allowed=['surface.requestClose','gateway','surface.open','context.read','work.action','launcher.run','capture','capture.extract','capture.once','capture.start','capture.stop','capture.status'];
    if(!allowed.includes(message.type)){sendResponse({error:'페이지 위젯에서 허용하지 않는 명령입니다.'});return false;}
    if(message.type==='gateway' && !['table.list','table.read','settings.read','gateway.health'].includes(message.request?.command)){sendResponse({protocolVersion:1,requestId:message.request?.requestId||'',error:{code:'WIDGET_COMMAND_DENIED',message:'페이지 위젯은 허용된 읽기 명령만 직접 요청할 수 있습니다.'}});return false;}
    routed.tabId=sender.tab!.id;
  } else {
    const popup=new URL(sender.url!).pathname.endsWith('/feature.html');
    if(message.type==='context.select'&&!popup){sendResponse({error:'화면 선택은 원본 탭을 연결한 기능창에서 실행하세요.'});return false;}
    const sourceOperation=['ui.refresh','inspection.read','surface.closed','surface.requestClose','surface.open','context.read','context.select','work.action','launcher.run','capture','script.execute','page.action'].includes(message.type)||message.type.startsWith('capture.');
    if(sourceOperation && (popup || ['surface.open','context.read','context.select','work.action','launcher.run'].includes(message.type)) && (!Number.isSafeInteger(message.tabId)||message.tabId<0)){sendResponse({error:'원본 페이지 탭 ID를 명시하세요. 기능창 자신의 탭은 수집하지 않습니다.'});return false;}
  }
  void handle(routed).then(sendResponse,error=>sendResponse(message.type==='gateway'?{protocolVersion:1,requestId:message.request?.requestId||'',error:{code:'NATIVE_CONNECTION',message:failure(error)}}:{error:failure(error)}));
  return true;
});


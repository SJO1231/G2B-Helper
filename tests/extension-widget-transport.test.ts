import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest } from '../packages/contracts/src/index';
import type { WorkActionResult } from '../plugins/page-actions';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup() {
  vi.resetModules();
  let listener:any,alarmListener:any,actionListener:any,nativeListener:any;
  let pageUrl='https://www.g2b.go.kr/current';
  const sourceTab=42;
  const requests:GatewayRequest[]=[];
  const alarms=new Map<string,unknown>();
  const session:Record<string,any>={};
  const context={areaCd:'14',depth1:'01001',depth2:'01114',ctrtDmndRcptNo:'0001',ctrtDmndRcptOrd:'00'};
  let captureFrames:any[]=[{frameId:0,result:{pointInfo:context,tables:{},frames:[{framePath:'top',url:pageUrl,pointInfo:context,tables:{},fieldSources:{},warnings:[]}],warnings:[]}}];
  const frameUrls=new Map<number,string>([[0,pageUrl]]);
  let launcher={kind:'url',target:'https://fixture.test/launch'};
  const deferred=new Set<string>();
  const workFrames=new Map<number,WorkActionResult>();
  const chromeMock:any={
    runtime:{id:'fixture',getURL:(path:string)=>'chrome-extension://fixture/'+path,lastError:undefined,
      onMessage:{addListener:(fn:any)=>{listener=fn;}},onInstalled:{addListener:vi.fn()},
      connectNative:vi.fn(()=>({onMessage:{addListener:(fn:any)=>{nativeListener=fn;}},onDisconnect:{addListener:vi.fn()},postMessage:(request:GatewayRequest)=>{
        requests.push(request);
        if(deferred.has(request.command))return;
        const result=request.command==='collector.policy'?{version:1,storeVersion:7,rules:null,includeDefaults:false}:request.command==='query.execute'?{rows:[{content:JSON.stringify(launcher)}]}:request.command==='capture.collect'?{captureIds:['c1']}:request.command==='collector.preview'?{status:'ready',previewToken:'token'}:{ok:true};
        queueMicrotask(()=>nativeListener({protocolVersion:1,requestId:request.requestId,result}));
      }}))},
    action:{onClicked:{addListener:(fn:any)=>{actionListener=fn;}}},
    tabs:{sendMessage:vi.fn(async()=>({opened:true})),get:vi.fn(async(id:number)=>({id,url:id===sourceTab?pageUrl:'https://fixture.test/other',title:'현재 화면'})),query:vi.fn(async()=>[{id:999,url:'chrome-extension://fixture/feature.html'}]),create:vi.fn(async()=>({id:77})),onRemoved:{addListener:vi.fn()}},
    windows:{create:vi.fn(async()=>({id:8,tabs:[{id:88}]}))},
    alarms:{onAlarm:{addListener:(fn:any)=>{alarmListener=fn;}},create:vi.fn(async(name:string)=>{alarms.set(name,true);}),clear:vi.fn(async(name:string)=>alarms.delete(name)),get:vi.fn(async(name:string)=>alarms.get(name)),getAll:vi.fn(async()=>[])},
    storage:{session:{set:vi.fn(async(value:Record<string,unknown>)=>{Object.assign(session,value);}),get:vi.fn(async(keys:string[])=>Object.fromEntries(keys.filter(key=>key in session).map(key=>[key,session[key]])))}},
    sidePanel:{setPanelBehavior:vi.fn()},
    userScripts:{getScripts:vi.fn(async()=>[]),execute:vi.fn(async()=>[{frameId:0,result:'executed'}])},
    scripting:{executeScript:vi.fn(async(injection:any)=>{
      if(injection.files)return [];
      const name=injection.func?.name;
      if(name==='performWorkAction') {
        const selectedIds=injection.target.frameIds||[...workFrames.keys()];
        return selectedIds.map((frameId:number)=>({frameId,result:injection.args[0].mode==='apply'?{...workFrames.get(frameId),status:'applied',clicked:true}:workFrames.get(frameId)}));
      }
      if(injection.func.toString().includes('window.location.href'))return injection.target.frameIds.map((frameId:number)=>({frameId,result:frameUrls.get(frameId)}));
      return captureFrames;
    })}
  };
  vi.stubGlobal('chrome',chromeMock);
  await import('../apps/extension/background');
  const widgetSender={id:'fixture',url:pageUrl,tab:{id:sourceTab,url:pageUrl},frameId:0};
  const popupSender={id:'fixture',url:'chrome-extension://fixture/feature.html?surface=work&sourceTabId=42',tab:{id:88,url:'chrome-extension://fixture/feature.html'}};
  const send=(message:any,sender:any=widgetSender)=>new Promise<any>(resolve=>listener(message,sender,resolve));
  const respond=(command:string,result:any)=>{const request=[...requests].reverse().find(r=>r.command===command)!;nativeListener({protocolVersion:1,requestId:request.requestId,result});};
  return {send,sourceTab,requests,alarms,session,chromeMock,workFrames,frameUrls,respond,deferred,native:(message:any)=>nativeListener(message),widgetSender,popupSender,clickAction:()=>actionListener({id:sourceTab,url:pageUrl}),tick:(id=sourceTab)=>alarmListener({name:'pce-capture:'+id}),setLauncher:(value:any)=>{launcher=value;},setCapture:(value:any[])=>{captureFrames=value;},navigate:(url:string)=>{pageUrl=url;}};
}
function workResult(frameId:number,status:WorkActionResult['status']='ready'):WorkActionResult {
  return {status,candidates:[{id:'top:search:button',role:'search',framePath:'top',elementId:'button',componentId:'button',label:'검색 '+frameId,value:'',via:'dom',evidence:'fixture',disabled:false,ready:true}],selected:{},changes:[],clicked:false,warnings:[],message:'fixture'};
}
describe('extension page widget transport',()=>{
  it('injects the isolated movable widget on action clicks without opening a side panel',async()=>{
    const env=await setup();env.clickAction();await Promise.resolve();
    expect(env.chromeMock.scripting.executeScript).toHaveBeenCalledWith({target:{tabId:42,frameIds:[0]},world:'ISOLATED',files:['widget.js']});
    expect(env.chromeMock.sidePanel.setPanelBehavior).not.toHaveBeenCalled();
  });
  it('opens in-page feature panels with the actual widget source tab and encoded context',async()=>{
    const env=await setup();const result=await env.send({type:'surface.open',surface:'notes',tabId:91,sourceId:'테이블 A',rowId:'001',mode:'detail'});
    expect(result.sourceTabId).toBe(42);expect(result.panelId).toBeDefined();expect(env.chromeMock.windows.create).not.toHaveBeenCalled();
    const url=new URL(env.chromeMock.tabs.sendMessage.mock.calls[0][1].url);
    expect(url.pathname).toBe('/feature.html');expect(url.searchParams.get('sourceTabId')).toBe('42');expect(url.searchParams.get('sourceId')).toBe('테이블 A');expect(url.searchParams.get('rowId')).toBe('001');expect(url.searchParams.get('embedded')).toBe('1');expect(env.chromeMock.tabs.sendMessage.mock.calls[0][0]).toBe(42);expect(env.chromeMock.tabs.query).not.toHaveBeenCalled();
  });
  it('requires explicit source tab IDs for feature popups and never captures their own tab',async()=>{
    const env=await setup();const response=await env.send({type:'capture.extract'},env.popupSender);
    expect(response.error).toContain('원본 페이지 탭 ID');expect(env.chromeMock.scripting.executeScript).not.toHaveBeenCalled();expect(env.chromeMock.tabs.query).not.toHaveBeenCalled();
    const extracted=await env.send({type:'capture.extract',tabId:42},env.popupSender);
    expect(extracted.payload.pointInfo.ctrtDmndRcptNo).toBe('0001');expect(env.chromeMock.scripting.executeScript.mock.calls[0][0].target.tabId).toBe(42);
  });
  it('allows widget read gateways and rejects direct write/SQL/arbitrary script messages',async()=>{
    const env=await setup();const request={protocolVersion:1,requestId:'read',command:'table.list',payload:{}};
    expect((await env.send({type:'gateway',request})).result).toEqual({ok:true});
    for(const command of ['grid.commit','query.execute','launcher.execute'])expect((await env.send({type:'gateway',request:{...request,requestId:command,command}})).error.code).toBe('WIDGET_COMMAND_DENIED');
    expect((await env.send({type:'script.execute',code:'alert(1)'})).error).toContain('허용하지 않는');expect(env.requests).toHaveLength(1);expect(env.chromeMock.userScripts.execute).not.toHaveBeenCalled();
  });
  it('returns current page information and frame provenance without native writes',async()=>{
    const env=await setup();const result=await env.send({type:'context.read',tabId:91});
    expect(result).toMatchObject({tabId:42,url:'https://www.g2b.go.kr/current',title:'현재 화면',pointInfo:{ctrtDmndRcptNo:'0001'}});expect(JSON.parse(result.screenKey)).toEqual(['https://www.g2b.go.kr/current','14','01001','01114']);expect(result.frames[0].framePath).toBe('frame:0/top');expect(env.requests).toHaveLength(0);
  });
  it('returns frame IDs on work detection and does not apply ambiguous frames',async()=>{
    const env=await setup();env.workFrames.set(0,workResult(0));env.workFrames.set(5,workResult(5));
    const detection=await env.send({type:'work.action',action:{kind:'detect'}});
    expect(detection.candidates.map((c:any)=>c.frameId)).toEqual([0,5]);
    const query=await env.send({type:'work.action',action:{kind:'search'}});
    expect(query.status).toBe('needsSelection');expect(env.chromeMock.scripting.executeScript.mock.calls.every((c:any)=>c[0].args[0].mode==='inspect')).toBe(true);
  });
  it('inspects all readable frames then executes in only the selected frame',async()=>{
    const env=await setup();env.workFrames.set(0,workResult(0));env.workFrames.set(5,workResult(5));
    const response=await env.send({type:'work.action',frameId:5,action:{kind:'search',selection:{search:'top:search:button'}}});
    expect(response.status).toBe('applied');expect(response.frameId).toBe(5);expect(env.chromeMock.scripting.executeScript).toHaveBeenCalledTimes(2);expect(env.chromeMock.scripting.executeScript.mock.calls[1][0].target).toEqual({tabId:42,frameIds:[5]});
  });
  it('keeps work previews free of applying calls',async()=>{
    const env=await setup();env.workFrames.set(3,workResult(3));
    const result=await env.send({type:'work.action',action:{kind:'search',mode:'inspect'}});
    expect(result.status).toBe('ready');expect(result.frameId).toBe(3);expect(env.chromeMock.scripting.executeScript).toHaveBeenCalledOnce();
  });
  it('uses the stored launcher row for scripts and ignores supplied code',async()=>{
    const env=await setup();env.setLauncher({kind:'script',target:'window.example = 1;'});
    const result=await env.send({type:'launcher.run',rowId:"row'1",tabId:99,code:'untrusted replacement'});
    expect(result.kind).toBe('script');expect(env.requests[0].command).toBe('query.execute');expect(env.requests[0].payload.sql).toContain("row_id = 'row''1'");expect(env.chromeMock.userScripts.execute).toHaveBeenCalledWith({target:{tabId:42},js:[{code:'window.example = 1;'}],world:'MAIN'});
  });
  it('opens stored URL launchers in new tabs and delegates file launchers to native',async()=>{
    const env=await setup();await env.send({type:'launcher.run',rowId:'url-row'});
    expect(env.chromeMock.tabs.create).toHaveBeenCalledWith({url:'https://fixture.test/launch'});
    env.setLauncher({kind:'file',target:'E:\\업무\\example.hwpx'});await env.send({type:'launcher.run',rowId:'file-row'});
    expect(env.requests.at(-1)).toMatchObject({command:'launcher.execute',payload:{rowId:'file-row'}});
  });
  it('keeps automatic collection attached to its started tab and reports submitted writes during stop',async()=>{
    const env=await setup();env.deferred.add('capture.collect');const started=env.send({type:'capture.start',tabId:99});
    await vi.waitFor(()=>expect(env.requests.some(r=>r.command==='capture.collect')).toBe(true));
    const stopped=await env.send({type:'capture.stop',tabId:99});expect(stopped).toMatchObject({active:false,inFlight:true,pendingWritesMayComplete:true});
    env.respond('capture.collect',{captureIds:['c1']});expect(await started).toMatchObject({active:false,cancelled:true});expect(env.requests.some(r=>r.command==='collector.apply')).toBe(false);expect(env.alarms.size).toBe(0);expect(env.chromeMock.tabs.query).not.toHaveBeenCalled();
  });
  it('does not submit fresh writes after stopping during policy/extraction work',async()=>{
    const env=await setup();env.deferred.add('collector.policy');const started=env.send({type:'capture',mode:'start'});
    await vi.waitFor(()=>expect(env.requests).toHaveLength(1));expect((await env.send({type:'capture.stop'})).pendingWritesMayComplete).toBe(false);
    env.respond('collector.policy',{version:1,storeVersion:7,rules:null});expect(await started).toMatchObject({active:false,cancelled:true});expect(env.requests).toHaveLength(1);
  });
  it('checks each allowed frame URL again before creating a capture write',async()=>{
    const env=await setup();env.frameUrls.set(0,'https://fixture.test/moved');
    const result=await env.send({type:'capture.once'});expect(result.error).toContain('frame이 이동');expect(env.requests.map(r=>r.command)).toEqual(['collector.policy']);
  });
});

function contextFrame(frameId:number,pointInfo:Record<string,unknown>,url='https://fixture.test/frame/'+frameId) {
  return {frameId,result:{pointInfo,tables:{},frames:[{framePath:'top',url,pointInfo,tables:{},fieldSources:{},warnings:[]}],warnings:[]}};
}
describe('actual frame screen context',()=>{
  it('automatically uses the identified child when the top frame has no screen fields',async()=>{
    const env=await setup();env.setCapture([contextFrame(0,{}),contextFrame(3,{areaCd:'01',depth1:'01001',depth2:'01114',screenId:'detail',zero:0})]);
    const context=await env.send({type:'context.read'});
    expect(context.requiresScreenSelection).toBe(false);expect(context.selectedFramePath).toBe('frame:3/top');expect(context.screenCandidates).toHaveLength(1);expect(context.pointInfo).toEqual({areaCd:'01',depth1:'01001',depth2:'01114',screenId:'detail',zero:0});expect(JSON.parse(context.screenKey)).toEqual(['https://www.g2b.go.kr/current','01','01001','01114']);
  });
  it('does not guess a screen when multiple frames are identified',async()=>{
    const env=await setup();env.setCapture([contextFrame(0,{depth2:'01114',screenId:'first'}),contextFrame(2,{depth2:'01114',screenId:'second'})]);
    const context=await env.send({type:'context.read'});
    expect(context.screenKey).toBe('');expect(context.requiresScreenSelection).toBe(true);expect(context.selectedFramePath).toBeUndefined();expect(context.pointInfo).toEqual({});expect(context.screenCandidates.map((c:any)=>c.framePath)).toEqual(['frame:0/top','frame:2/top']);
  });
  it('remembers explicit feature selection while the frame identity and URLs match',async()=>{
    const env=await setup();env.setCapture([contextFrame(0,{depth2:'01114',screenId:'first'}),contextFrame(2,{depth2:'01114',screenId:'second'})]);
    const chosen=await env.send({type:'context.select',tabId:42,framePath:'frame:2/top'},env.popupSender);
    expect(chosen.selectedFramePath).toBe('frame:2/top');expect(chosen.requiresScreenSelection).toBe(false);expect(JSON.parse(chosen.screenKey)).toEqual(['https://www.g2b.go.kr/current','','','01114']);expect(env.session['screenContext:42'].framePath).toBe('frame:2/top');
    const refreshed=await env.send({type:'context.read'});expect(refreshed.screenKey).toBe(chosen.screenKey);expect(refreshed.selectedFramePath).toBe('frame:2/top');
    expect((await env.send({type:'context.select',framePath:'frame:2/top'})).error).toContain('허용하지 않는');
  });
  it('clears explicit selection when the tab navigates',async()=>{
    const env=await setup();env.setCapture([contextFrame(0,{depth2:'first'}),contextFrame(2,{depth2:'second'})]);
    await env.send({type:'context.select',tabId:42,framePath:'frame:2/top'},env.popupSender);env.navigate('https://fixture.test/new-page');
    const context=await env.send({type:'context.read'});
    expect(context.requiresScreenSelection).toBe(true);expect(context.screenKey).toBe('');expect(env.session['screenContext:42']).toBeNull();
  });
  it('clears selection on same-URL application screen changes or child URL changes',async()=>{
    const env=await setup();env.setCapture([contextFrame(0,{depth2:'first'}),contextFrame(2,{depth2:'second'})]);
    await env.send({type:'context.select',tabId:42,framePath:'frame:2/top'},env.popupSender);
    env.setCapture([contextFrame(0,{depth2:'first'}),contextFrame(2,{depth2:'new-screen'})]);
    expect((await env.send({type:'context.read'})).requiresScreenSelection).toBe(true);expect(env.session['screenContext:42']).toBeNull();
    await env.send({type:'context.select',tabId:42,framePath:'frame:2/top'},env.popupSender);
    env.setCapture([contextFrame(0,{depth2:'first'}),contextFrame(2,{depth2:'new-screen'},'https://fixture.test/moved-child')]);
    expect((await env.send({type:'context.read'})).screenKey).toBe('');expect(env.session['screenContext:42']).toBeNull();
  });
  it('does not preserve a frame choice after its removal and permits a URL-only context with no identifiers',async()=>{
    const env=await setup();env.setCapture([contextFrame(0,{depth2:'first'}),contextFrame(2,{depth2:'second'})]);
    await env.send({type:'context.select',tabId:42,framePath:'frame:2/top'},env.popupSender);
    env.setCapture([contextFrame(0,{})]);const context=await env.send({type:'context.read'});
    expect(context.screenCandidates).toEqual([]);expect(context.requiresScreenSelection).toBe(false);expect(JSON.parse(context.screenKey)).toEqual(['https://www.g2b.go.kr/current','','','']);expect(env.session['screenContext:42']).toBeNull();
    expect((await env.send({type:'context.select',tabId:42,framePath:'frame:2/top'},env.popupSender)).error).toContain('현재');
  });
});

describe('native JSON transport size limits',()=>{
  it('rejects a request exceeding 60 MiB before connecting or submitting native writes',async()=>{
    const env=await setup();const response=await env.send({type:'gateway',request:{protocolVersion:1,requestId:'oversized',command:'extension.document.put',payload:{data:'a'.repeat(60*1024*1024)}}},env.popupSender);
    expect(response.error.message).toContain('60 MiB');expect(response.error.message).toContain('HWPX 파일 크기와 JSON 전송 크기');expect(env.chromeMock.runtime.connectNative).not.toHaveBeenCalled();expect(env.requests).toHaveLength(0);
  });
  it('reassembles a valid response with more than 256 chunks',async()=>{
    const env=await setup();env.deferred.add('gateway.health');const pending=env.send({type:'gateway',request:{protocolVersion:1,requestId:'big',command:'gateway.health',payload:{}}},env.popupSender);
    const body='a'.repeat(16*1024*1024),serialized=JSON.stringify({protocolVersion:1,requestId:'big',result:{body}}),size=60000,total=Math.ceil(serialized.length/size);
    expect(total).toBeGreaterThan(256);
    for(let index=total-1;index>=0;index--)env.native({requestId:'big',chunk:{index,total,text:serialized.slice(index*size,(index+1)*size)}});
    expect((await pending).result.body).toBe(body);
  });
  it('rejects chunk declarations over 4096 and whole response UTF-8 bytes over 100 MiB',async()=>{
    const env=await setup();env.deferred.add('gateway.health');
    const count=env.send({type:'gateway',request:{protocolVersion:1,requestId:'count',command:'gateway.health',payload:{}}},env.popupSender);
    env.native({requestId:'count',chunk:{index:0,total:4097,text:''}});expect((await count).error.message).toContain('4096');
    const bytes=env.send({type:'gateway',request:{protocolVersion:1,requestId:'bytes',command:'gateway.health',payload:{}}},env.popupSender);
    const text='가'.repeat(100000),total=350;
    for(let index=0;index<total;index++)env.native({requestId:'bytes',chunk:{index,total,text}});
    expect((await bytes).error.message).toContain('100 MiB');
  });
});

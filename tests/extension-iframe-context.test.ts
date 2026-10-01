import {afterEach,describe,expect,it,vi} from 'vitest';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup(){
 let listener:any,nativeListener:any;
 const nativeRequests:any[]=[];
 const chromeMock:any={
  runtime:{id:'fixture',getURL:(path:string)=>'chrome-extension://fixture/'+path,onMessage:{addListener:(fn:any)=>{listener=fn;}},onInstalled:{addListener:vi.fn()},
   connectNative:()=>({onMessage:{addListener:(fn:any)=>{nativeListener=fn;}},onDisconnect:{addListener:vi.fn()},postMessage:(request:any)=>{nativeRequests.push(request);queueMicrotask(()=>nativeListener({protocolVersion:1,requestId:request.requestId,result:{ok:true}}));}})},
  tabs:{get:vi.fn(async(id:number)=>({id,url:'https://www.g2b.go.kr/task',title:'source'})),query:vi.fn(async()=>[{id:999,url:'https://wrong.test/active'}]),onRemoved:{addListener:vi.fn()}},
  alarms:{onAlarm:{addListener:vi.fn()},clear:vi.fn(async()=>true),getAll:vi.fn(async()=>[])},
  storage:{session:{set:vi.fn(async()=>{}),get:vi.fn(async()=>({}))}},
  scripting:{executeScript:vi.fn(async()=>[{frameId:0,result:{pointInfo:{depth2:'01114'},tables:{rows:[{code:'0001',value:0,enabled:false}]},frames:[{framePath:'top',url:'https://www.g2b.go.kr/task',pointInfo:{depth2:'01114'},tables:{rows:[{code:'0001',value:0,enabled:false}]}}],warnings:[]}}])},
 };
 vi.stubGlobal('chrome',chromeMock);await import('../apps/extension/background');
 const sender={id:'fixture',url:'chrome-extension://fixture/feature.html?surface=extract&sourceTabId=42',tab:{id:42,url:'https://www.g2b.go.kr/task'},frameId:7};
 return {chromeMock,nativeRequests,sender,send:(message:any,source:any=sender)=>new Promise<any>(resolve=>listener(message,source,resolve))};
}

describe('extension iframe source tab routing (mock Chrome sender)',()=>{
 it('extension iframe uses its explicit sourceTabId despite sender.tab and another focused tab',async()=>{
  const env=await setup();
  const result=await env.send({type:'capture.extract',tabId:42});
  expect(result.error).toBeUndefined();
  expect(env.chromeMock.scripting.executeScript.mock.calls[0][0].target).toEqual({tabId:42,allFrames:true});
  expect(env.chromeMock.tabs.query).not.toHaveBeenCalled();
  expect(result.payload.tables.rows[0]).toEqual({code:'0001',value:0,enabled:false});
 });
 it('iframe missing sourceTabId fails before extraction and does not silently fall back',async()=>{
  const env=await setup();
  const result=await env.send({type:'capture.extract'});
  expect(result.error).toContain('원본 페이지 탭 ID');
  expect(env.chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  expect(env.chromeMock.tabs.query).not.toHaveBeenCalled();
 });
 it('extension iframe retains SQL mutation permissions instead of being treated as the read-only widget',async()=>{
  const env=await setup();
  const request={protocolVersion:1,requestId:'iframe-save',command:'grid.commit',payload:{sourceId:'memos',changes:{added:[{title:'iframe note'}],updated:[],deleted:[]}}};
  const result=await env.send({type:'gateway',request});
  expect(result.error).toBeUndefined();expect(result.result).toEqual({ok:true});
  expect(env.nativeRequests).toEqual([request]);
 });
 it('page widget still overrides claimed tab IDs with its real sender tab',async()=>{
  const env=await setup();
  const result=await env.send({type:'capture.extract',tabId:999},{...env.sender,url:'https://www.g2b.go.kr/task',frameId:0});
  expect(result.error).toBeUndefined();
  expect(env.chromeMock.scripting.executeScript.mock.calls[0][0].target.tabId).toBe(42);
 });
});

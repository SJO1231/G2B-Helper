import { describe,it,expect,vi,afterEach } from 'vitest';
import type { GatewayRequest } from '../packages/contracts/src/index';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup(respond?: (request: GatewayRequest)=>any) {
  let listener:any;
  let nativeListener:any;
  const requests:GatewayRequest[]=[];
  const alarms=new Map<string,unknown>();
  let alarmListener:any;
  let currentTab={id:4,url:'https://www.g2b.go.kr/current'};
  let capturePayload={pointInfo:{areaCd:'14',depth1:'01001',depth2:'01114',ctrtDmndRcptNo:'001',ctrtDmndRcptOrd:'00'},tables:{},frames:[],warnings:[]} as any;
  const chromeMock={
    runtime:{id:'fixture',getURL:(path:string)=>'chrome-extension://fixture/'+path,lastError:undefined,
      onMessage:{addListener:(fn:any)=>{listener=fn;}},onInstalled:{addListener:vi.fn()},
      connectNative:vi.fn(()=>({onMessage:{addListener:(fn:any)=>{nativeListener=fn;}},onDisconnect:{addListener:vi.fn()},postMessage:(request:GatewayRequest)=>{
        requests.push(request); if(respond)queueMicrotask(()=>nativeListener({protocolVersion:1,requestId:request.requestId,result:request.command==='collector.policy'?{version:1,storeVersion:3,rules:null}:respond(request)}));
      }}))},
    tabs:{query:async()=>[currentTab],get:async()=>currentTab,onRemoved:{addListener:vi.fn()}},
    alarms:{onAlarm:{addListener:(fn:any)=>{alarmListener=fn;}},create:async(name:string)=>{alarms.set(name,true);},clear:async(name:string)=>alarms.delete(name),get:async(name:string)=>alarms.get(name)},
    storage:{session:{set:vi.fn(async()=>{}),get:async()=>({})}},
    scripting:{executeScript:async(injection:any)=>{
      if(injection.func.toString().includes('window.location.href'))return injection.target.frameIds.map((frameId:number)=>({frameId,result:currentTab.url}));
      const observed={...capturePayload,frames:capturePayload.frames?.length?capturePayload.frames:[{framePath:'top',url:currentTab.url,pointInfo:capturePayload.pointInfo,tables:capturePayload.tables,fieldSources:{},warnings:[]}]};
      return [{frameId:0,result:observed}];
    }}
  };
  vi.stubGlobal('chrome',chromeMock);
  await import('../apps/extension/background');
  const send=(message:any,sender={id:'fixture',url:'chrome-extension://fixture/sidepanel.html'})=>new Promise<any>(resolve=>listener(message,sender,resolve));
  return {send,requests,alarms,native:(message:any)=>nativeListener(message),setPayload:(payload:any)=>{capturePayload=payload;},navigate:(url:string)=>{currentTab={...currentTab,url};},tick:()=>alarmListener({name:'pce-capture:4'})};
}
describe('extension boundary and native routing',()=>{
  it('rejects page-origin requests',async()=>{
    const env=await setup(); const result=await env.send({type:'gateway'},{id:'fixture',url:'https://fixture.test'});
    expect(result.error).toContain('확장 화면');expect(env.requests).toHaveLength(0);
  });
  it('routes out-of-order response chunks to the original request',async()=>{
    const env=await setup(); const request={protocolVersion:1,requestId:'r1',command:'tables.list',payload:{}};
    const done=env.send({type:'gateway',request});
    const text=JSON.stringify({...request,result:['한글']});const midpoint=Math.floor(text.length/2);
    env.native({protocolVersion:1,requestId:'r1',chunk:{index:1,total:2,text:text.slice(midpoint)}});
    env.native({protocolVersion:1,requestId:'r1',chunk:{index:0,total:2,text:text.slice(0,midpoint)}});
    expect((await done).result).toEqual(['한글']);
  });
  it('automatic collection applies only nonconflicting values with matching token',async()=>{
    const env=await setup(request=>request.command==='capture.collect'?{captureIds:['capture-1']}:request.command==='collector.preview'?{status:'ready',previewToken:'verified-token'}:{changed:[],pending:{records:[]}});
    const reply=await env.send({type:'capture',mode:'start'});
    expect(reply.error).toBeUndefined();
    expect(env.requests.map(r=>r.command)).toEqual(['collector.policy','capture.collect','collector.preview','collector.apply']);
    expect(env.requests[3].payload).toEqual({captureId:'capture-1',previewToken:'verified-token',decisions:[]});
    expect(env.requests[1].payload.policyVersion).toBe(3);
    expect((env.requests[1].payload.bundle as any).captures[0].captureId).toMatch(/^[0-9a-f-]{36}$/);
    const firstId=(env.requests[1].payload.bundle as any).captures[0].captureId;
    await env.send({type:'capture',mode:'start'});
    expect((env.requests[5].payload.bundle as any).captures[0].captureId).not.toBe(firstId);
  });
  it('one-time collection retains raw and awaits explicit review before applying',async()=>{
    const env=await setup(request=>request.command==='capture.collect'?{captureIds:['capture-1']}:{status:'ready',previewToken:'t'});
    const reply=await env.send({type:'capture',mode:'once'});
    expect(reply.reviewPending).toBe(true);
    expect(env.requests.map(r=>r.command)).toEqual(['collector.policy','capture.collect','collector.preview']);
  });
  it('keeps raw-only capture pending instead of applying unmatched rules',async()=>{
    const env=await setup(request=>request.command==='capture.collect'?{captureIds:['capture-1']}:{status:'raw_only',previewToken:'t'});
    await env.send({type:'capture',mode:'once'});
    expect(env.requests.map(r=>r.command)).toEqual(['collector.policy','capture.collect','collector.preview']);
  });
  it('blocks unknown collection before capture storage and keeps automatic collection off',async()=>{
    const env=await setup(()=>({captureIds:[]}));
    env.setPayload({pointInfo:{ctrtDmndRcptNo:'001',ctrtDmndRcptOrd:'00'},tables:{},frames:[],warnings:['frame denied']});
    expect((await env.send({type:'capture',mode:'once'})).error).toContain('지정');
    const start=await env.send({type:'capture',mode:'start'});
    expect(start.active).toBe(false);expect(start.error).toContain('frame denied');
    expect(env.alarms.size).toBe(0);expect(env.requests.map(r=>r.command)).toEqual(['collector.policy','collector.policy']);
  });
  it('reevaluates scope and stops automatic collection after navigation to an unknown screen',async()=>{
    const env=await setup(request=>request.command==='capture.collect'?{captureIds:[]}:{status:'ready'});
    expect((await env.send({type:'capture',mode:'start'})).active).toBe(true);
    env.setPayload({pointInfo:{areaCd:'14',depth1:'01001',depth2:'01108'},tables:{},frames:[],warnings:[]});
    env.tick();
    await vi.waitFor(()=>expect(env.alarms.size).toBe(0));
    expect(env.requests.filter(request=>request.command==='capture.collect')).toHaveLength(1);
    expect(env.requests.filter(request=>request.command==='collector.policy')).toHaveLength(2);
  });
  it('stops default automatic collection after navigation to a non-G2B copy with identical business fields',async()=>{
    const env=await setup(request=>request.command==='capture.collect'?{captureIds:[]}:{status:'ready'});
    expect((await env.send({type:'capture',mode:'start'})).active).toBe(true);
    env.navigate('https://fixture.test/copied-screen');env.tick();
    await vi.waitFor(()=>expect(env.alarms.size).toBe(0));
    expect(env.requests.filter(request=>request.command==='capture.collect')).toHaveLength(1);
    expect(env.requests.filter(request=>request.command==='collector.policy')).toHaveLength(2);
  });
  it('keeps unrestricted extraction separate from collection and never sends it to the gateway',async()=>{
    const env=await setup(()=>({}));
    env.setPayload({pointInfo:{arbitrary:'data'},tables:{},frames:[],warnings:[]});
    const result=await env.send({type:'capture',mode:'extract'});
    expect(result.payload.pointInfo).toEqual({arbitrary:'data'});expect(env.requests).toHaveLength(0);
  });
  it('stop during initial collection prevents the delayed start from reactivating its alarm',async()=>{
    const env=await setup();
    const start=env.send({type:'capture',mode:'start'});
    await vi.waitFor(()=>expect(env.requests).toHaveLength(1));
    expect((await env.send({type:'capture',mode:'stop'})).active).toBe(false);
    const policyRequest=env.requests[0];
    env.native({protocolVersion:1,requestId:policyRequest.requestId,result:{version:1,storeVersion:0,rules:null}});
    expect(await start).toMatchObject({active:false,cancelled:true});expect(env.alarms.size).toBe(0);
    expect(env.requests).toHaveLength(1); // Stop precedes storage submission; no new write may begin.
    const count=env.requests.length;env.tick();await Promise.resolve();await Promise.resolve();expect(env.requests).toHaveLength(count);
  });
});


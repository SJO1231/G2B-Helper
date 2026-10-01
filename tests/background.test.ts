import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
let listener:any,nativeMessage:any,nativeDisconnect:any,chromeMock:any;
beforeEach(async()=>{
 vi.resetModules();
 const port={postMessage:vi.fn(),onMessage:{addListener:(fn:any)=>{nativeMessage=fn;}},onDisconnect:{addListener:(fn:any)=>{nativeDisconnect=fn;}}};
 chromeMock={runtime:{id:'test',getURL:(p:string)=>'chrome-extension://test/'+p,connectNative:vi.fn(()=>port),onMessage:{addListener:(fn:any)=>{listener=fn;}},onInstalled:{addListener:vi.fn()}},tabs:{query:vi.fn(async()=>[{id:7,url:'chrome://settings'}]),get:vi.fn(),onRemoved:{addListener:vi.fn()}},alarms:{clear:vi.fn(async()=>true),get:vi.fn(),getAll:vi.fn(async()=>[]),create:vi.fn(),onAlarm:{addListener:vi.fn()}},storage:{session:{set:vi.fn(async()=>{}),get:vi.fn(async()=>({}))}},sidePanel:{setPanelBehavior:vi.fn()},scripting:{executeScript:vi.fn()}};
 vi.stubGlobal('chrome',chromeMock);await import('../apps/extension/background');
});
afterEach(()=>vi.unstubAllGlobals());
const send=(message:any)=>new Promise<any>(resolve=>listener(message,{id:'test',url:'chrome-extension://test/sidepanel.html'},resolve));
describe('extension background protocol',()=>{
 it('stops even on a restricted navigated page',async()=>{const response=await send({type:'capture',mode:'stop'});expect(response.active).toBe(false);expect(chromeMock.alarms.clear).toHaveBeenCalledWith('pce-capture:7');expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();});
 it('returns typed native connection failures',async()=>{chromeMock.runtime.connectNative.mockImplementation(()=>{throw new Error('offline');});const response=await send({type:'gateway',request:{protocolVersion:1,requestId:'x',command:'gateway.health',payload:{}}});expect(response).toEqual({protocolVersion:1,requestId:'x',error:{code:'NATIVE_CONNECTION',message:'offline'}});});
 it('reassembles out of order UTF8 chunks',async()=>{const promise=send({type:'gateway',request:{protocolVersion:1,requestId:'chunk',command:'gateway.health',payload:{}}});const response={protocolVersion:1,requestId:'chunk',result:{text:'한글 😀'}};const text=JSON.stringify(response),middle=30;nativeMessage({requestId:'chunk',chunk:{index:1,total:2,text:text.slice(middle)}});nativeMessage({requestId:'chunk',chunk:{index:0,total:2,text:text.slice(0,middle)}});expect(await promise).toEqual(response);});
 it('rejects an inconsistent duplicate response fragment',async()=>{const promise=send({type:'gateway',request:{protocolVersion:1,requestId:'conflict',command:'gateway.health',payload:{}}});nativeMessage({requestId:'conflict',chunk:{index:0,total:2,text:'first'}});nativeMessage({requestId:'conflict',chunk:{index:0,total:2,text:'different'}});expect((await promise).error.code).toBe('NATIVE_CONNECTION');});
 it('does not accept commands from a web page sender',async()=>{let result:any;expect(listener({type:'gateway'},{id:'test',url:'https://example.com'},(r:any)=>result=r)).toBe(false);expect(result.error).toBeTruthy();});
 it('reads configured page counts without changing the element',async()=>{chromeMock.tabs.query.mockResolvedValue([{id:7,url:'https://example.com'}]);const element={textContent:' 총 24건 ',click:vi.fn()};vi.stubGlobal('document',{querySelectorAll:()=>[element]});chromeMock.scripting.executeScript.mockImplementation(async (injection:any)=>[{result:injection.func(...injection.args)}]);expect(await send({type:'page.action',action:{kind:'readText',selector:'#count'}})).toEqual([{result:{text:'총 24건'}}]);expect(element.click).not.toHaveBeenCalled();});
});

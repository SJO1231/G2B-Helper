import {describe,it,expect} from 'vitest';
import {evaluateCollectionScope,parseCollectionPolicy} from '../plugins/collector/scope';
import type {CapturePayload,CollectionPolicy} from '../packages/contracts/src/index';
import cases from './collection-scope-cases.json';

describe('pre-storage designated collection scope',()=>{
  it('requires G2B HTTP(S) URLs for actual default-profile frames and preserves URL-less samples',()=>{
    const pointInfo={areaCd:'14',depth1:'01001',depth2:'01114',ctrtDmndRcptNo:'0001',ctrtDmndRcptOrd:'00'};
    for(const url of ['https://g2b.go.kr/detail','https://www.g2b.go.kr/detail','http://legacy.g2b.go.kr/detail']) {
      expect(evaluateCollectionScope({pointInfo:{},tables:{},frames:[{framePath:'actual',url,pointInfo,tables:{}}]}).allowed).toBe(true);
    }
    for(const url of ['https://fixture.test/copy','https://g2b.go.kr.evil.test/copy','https://fakeg2b.go.kr/copy','https://g2b.go.kr@evil.test/copy','file:///g2b.go.kr/copy','not-an-absolute-url']) {
      const result=evaluateCollectionScope({pointInfo:{},tables:{},frames:[{framePath:'actual',url,pointInfo,tables:{}}]});
      expect(result.allowed,url).toBe(false);expect(result.filteredPayload).toBeUndefined();
    }
    expect(evaluateCollectionScope({pointInfo,tables:{}}).allowed).toBe(true);
    expect(evaluateCollectionScope({pointInfo:{},tables:{},frames:[{framePath:'reference',url:'',pointInfo,tables:{}}]}).allowed).toBe(true);
    expect(evaluateCollectionScope({url:'https://fixture.test/copy',pointInfo,tables:{}}).allowed).toBe(false);
  });
  it('never borrows a G2B URL from another frame for matching screen fields',()=>{
    const pointInfo={areaCd:'14',depth1:'01001',depth2:'01114',ctrtDmndRcptNo:'0001',ctrtDmndRcptOrd:'00'};
    const result=evaluateCollectionScope({url:'https://www.g2b.go.kr',pointInfo,tables:{},frames:[{framePath:'copy',url:'https://fixture.test/copy',pointInfo,tables:{}},{framePath:'g2b',url:'https://www.g2b.go.kr/other',pointInfo:{},tables:{}}]});
    expect(result.allowed).toBe(false);expect(result.filteredPayload).toBeUndefined();
  });
  it('includes registered non-G2B custom data while excluding non-G2B default copies',()=>{
    const copied={framePath:'copy',url:'https://fixture.test/copy',pointInfo:{areaCd:'14',depth1:'01001',depth2:'01114',ctrtDmndRcptNo:'0001',ctrtDmndRcptOrd:'00'},tables:{rows:[{id:'copied'}]}};
    const registered={framePath:'registered',url:'https://fixture.test/registered',pointInfo:{screenId:'custom'},tables:{rows:[{id:'registered',zero:0}]}};
    const policy:CollectionPolicy={version:1,storeVersion:4,includeDefaults:true,rules:[{sourceId:'dataset.user',dataset:'rows',identityFields:['id'],urlFilter:{field:'url',operator:'equals',values:[registered.url]},screenFilter:{field:'screenId',operator:'equals',values:['custom']}}]};
    const result=evaluateCollectionScope({pointInfo:{},tables:{},frames:[copied,registered]},policy);
    expect(result.allowed).toBe(true);expect(result.filteredPayload?.frames?.map(frame=>frame.framePath)).toEqual(['registered']);expect(result.filteredPayload?.tables.rows).toEqual([{id:'registered',zero:0}]);
  });
  for(const fixture of cases)it(fixture.name,()=>{
    const original=JSON.stringify(fixture.payload);
    const result=evaluateCollectionScope(fixture.payload as unknown as CapturePayload,fixture.policy as CollectionPolicy|undefined);
    expect({allowed:result.allowed,status:result.status}).toEqual({allowed:fixture.allowed,status:fixture.status});
    expect(JSON.stringify(fixture.payload)).toBe(original);
    if('framePaths' in fixture)expect(result.filteredPayload?.frames?.map(frame=>frame.framePath)).toEqual(fixture.framePaths);
    if(result.allowed)expect(JSON.stringify(result.filteredPayload)).not.toContain('secret');
    else expect(result.filteredPayload).toBeUndefined();
  });
  it('blocks conflicting same business values and item values across frames',()=>{
    const frame=(framePath:string,value:string)=>({framePath,url:'https://www.g2b.go.kr/detail',pointInfo:{areaCd:'14',depth1:'01570',depth2:'01571',ctrtNo:'C',ctrtChgOrd:'00'},tables:{items:[{ctrtItemSqno:'01',amount:value}]}});
    expect(evaluateCollectionScope({pointInfo:{},tables:{},frames:[frame('top/0','1'),frame('top/1','2')]}).status).toBe('ambiguous');
  });
  it('rejects invalid policy before matching any data',()=>{
    expect(()=>parseCollectionPolicy({version:1,storeVersion:-1,rules:null})).toThrow();
    expect(()=>parseCollectionPolicy({version:1,storeVersion:0,rules:[{sourceId:'x',dataset:'rows',identityFields:[]}]})).toThrow();
    expect(()=>parseCollectionPolicy({version:1,storeVersion:0,rules:[{sourceId:'x',dataset:'rows',identityFields:['id'],screenFilter:{field:'x',operator:'equals',values:['1'],path:['constructor']}}]})).toThrow();
  });
  it('excludes unrelated frame contents and keeps global partial-read evidence',()=>{
    const result=evaluateCollectionScope({pointInfo:{},tables:{},warnings:['[top] unrelated warning'],frames:[
      {framePath:'top',url:'https://fixture.test/other',pointInfo:{secret:'x'},tables:{},warnings:['secret warning']} as any,
      {framePath:'top/0',url:'https://www.g2b.go.kr/detail',pointInfo:{areaCd:'14',depth1:'01570',depth2:'01571',ctrtNo:'C',ctrtChgOrd:'00'},tables:{},warnings:['matching warning']} as any
    ]});
    expect(JSON.stringify(result.filteredPayload)).not.toContain('secret');
    expect(result.filteredPayload?.warnings).toEqual(['[top] unrelated warning','[top/0] matching warning']);
  });
  it('keeps distinct configured table rows and item identities within a single procurement parent',()=>{
    const pointInfo={ctrtDmndRcptNo:'R',ctrtDmndRcptOrd:'00'};
    const rows=[{...pointInfo,ctrtDmndRcptItemSqno:'01',amount:'1'},{...pointInfo,ctrtDmndRcptItemSqno:'02',amount:'2'}];
    const policy:CollectionPolicy={version:1,storeVersion:1,rules:[{sourceId:'procurement.receipt_item',dataset:'items',identityFields:['ctrtDmndRcptNo','ctrtDmndRcptOrd','ctrtDmndRcptItemSqno']}]};
    const result=evaluateCollectionScope({pointInfo,tables:{items:rows}},policy);
    expect(result.allowed).toBe(true);expect(result.filteredPayload?.tables.items).toEqual(rows);
    expect(evaluateCollectionScope({pointInfo:{},tables:{items:[{id:'a'},{id:'b'}]}},{version:1,storeVersion:1,rules:[{sourceId:'dataset.user',dataset:'items',identityFields:['id']}]}).allowed).toBe(true);
  });
});

describe('frame URL and default/custom collection policy composition',()=>{
  const screen={field:'depth2',operator:'equals' as const,values:['custom']};
  const url={field:'url',operator:'equals' as const,values:['https://fixture.test/allowed']};
  const custom=(includeDefaults=false):CollectionPolicy=>({version:1,storeVersion:4,includeDefaults,rules:[{sourceId:'dataset.user',dataset:'rows',identityFields:['id'],screenFilter:screen,urlFilter:url}]});
  const frame=(framePath:string,frameUrl:string,depth2:string,rows:Record<string,unknown>[]=[{id:'001',value:0}])=>({framePath,url:frameUrl,pointInfo:{depth2},tables:{rows}});
  const approved={areaCd:'14',depth1:'01001',depth2:'01114',ctrtDmndRcptNo:'0001',ctrtDmndRcptOrd:'00'};

  it('matches URL, screen and row identity from the same frame and excludes aggregate leaks',()=>{
    const payload:CapturePayload={pointInfo:{depth2:'custom',secret:'aggregate'},tables:{rows:[{id:'aggregate'}]},frames:[
      frame('wrong-url','https://fixture.test/other','custom'),frame('wrong-screen','https://fixture.test/allowed','other'),frame('matching','https://fixture.test/allowed','custom')
    ]};
    const original=JSON.stringify(payload),result=evaluateCollectionScope(payload,custom());
    expect(result.allowed).toBe(true);expect(result.filteredPayload?.frames?.map(f=>f.framePath)).toEqual(['matching']);expect(result.filteredPayload?.tables.rows).toEqual([{id:'001',value:0}]);expect(result.filteredPayload?.pointInfo).toEqual({depth2:'custom'});expect(JSON.stringify(payload)).toBe(original);
  });
  it('never combines URL and screen from different frames',()=>{
    const result=evaluateCollectionScope({pointInfo:{depth2:'custom'},tables:{rows:[{id:'pooled'}]},frames:[frame('screen','https://fixture.test/other','custom'),frame('url','https://fixture.test/allowed','other')]},custom());
    expect(result.status).toBe('unconfigured');expect(result.filteredPayload).toBeUndefined();
  });
  it('supports nested URL filter groups using only the local frame URL',()=>{
    const policy=custom();policy.rules![0].urlFilter={join:'and',conditions:[{field:'url',operator:'contains',values:['fixture.test']},{join:'or',conditions:[{field:'url',operator:'contains',values:['/allowed']},{field:'url',operator:'contains',values:['/alternate']}]}]};
    const result=evaluateCollectionScope({pointInfo:{},tables:{},frames:[frame('allowed','https://fixture.test/allowed','custom'),frame('foreign','https://other.test/allowed','custom')]},policy);
    expect(result.filteredPayload?.frames?.map(f=>f.framePath)).toEqual(['allowed']);
  });
  it('uses and preserves explicitly supplied top-level URL when frame records are absent',()=>{
    const payload={url:'https://fixture.test/allowed',pointInfo:{depth2:'custom'},tables:{rows:[{id:'001',empty:'',flag:false,value:0}]}};
    const original=JSON.stringify(payload),result=evaluateCollectionScope(payload,custom());
    expect(result.allowed).toBe(true);expect((result.filteredPayload as any)?.url).toBe(payload.url);expect(result.filteredPayload?.frames).toBeUndefined();expect(result.filteredPayload?.tables.rows).toEqual(payload.tables.rows);expect(JSON.stringify(payload)).toBe(original);
    expect(evaluateCollectionScope({pointInfo:payload.pointInfo,tables:payload.tables},custom()).allowed).toBe(false);
  });
  it('preserves a supplied URL through a default/custom union without synthetic frames',()=>{
    const payload={url:'https://www.g2b.go.kr/allowed',pointInfo:approved,tables:{rows:[{id:'001',amount:'35608652.5'}]}};
    const policy=custom(true);delete policy.rules![0].screenFilter;policy.rules![0].urlFilter={field:'url',operator:'equals',values:[payload.url]};
    const result=evaluateCollectionScope(payload,policy);
    expect(result.allowed).toBe(true);expect((result.filteredPayload as any)?.url).toBe(payload.url);expect(result.filteredPayload?.frames).toBeUndefined();expect(result.filteredPayload?.tables.rows).toEqual(payload.tables.rows);
  });
  it('keeps defaults opt-in for configured policies and permits independent custom frames',()=>{
    const payload:CapturePayload={pointInfo:{},tables:{},frames:[{framePath:'default',url:'https://www.g2b.go.kr/default',pointInfo:approved,tables:{items:[{amount:'35608652.5'}]}},frame('custom','https://fixture.test/allowed','custom')]};
    const original=JSON.stringify(payload);
    expect(evaluateCollectionScope(payload,custom(false)).filteredPayload?.frames?.map(f=>f.framePath)).toEqual(['custom']);
    const both=evaluateCollectionScope(payload,custom(true));
    expect(both.filteredPayload?.frames?.map(f=>f.framePath)).toEqual(['default','custom']);expect(both.filteredPayload?.tables.items).toEqual([{amount:'35608652.5'}]);expect(both.filteredPayload?.tables.rows).toEqual([{id:'001',value:0}]);expect(JSON.stringify(payload)).toBe(original);
    expect(evaluateCollectionScope(payload,{version:1,storeVersion:4,rules:[],includeDefaults:true}).filteredPayload?.frames?.map(f=>f.framePath)).toEqual(['default']);
  });
  it('does not duplicate a frame, overwrite default rows with a custom subset, or remove original duplicates',()=>{
    const rows=[{amount:'without-custom-id'},{id:'001',amount:'a'},{id:'001',amount:'a'}];
    const unit={framePath:'same',url:'https://www.g2b.go.kr/allowed',pointInfo:approved,tables:{rows},warnings:['local evidence']};
    const payload:CapturePayload={pointInfo:{},tables:{},frames:[unit],warnings:['global evidence']};
    const policy=custom(true);delete policy.rules![0].screenFilter;policy.rules![0].urlFilter={field:'url',operator:'equals',values:[unit.url]};
    const original=JSON.stringify(payload),result=evaluateCollectionScope(payload,policy);
    expect(result.allowed).toBe(true);expect(result.filteredPayload?.frames).toHaveLength(1);expect(result.filteredPayload?.tables.rows).toEqual(rows);expect(result.filteredPayload?.frames?.[0].tables.rows).toEqual(rows);expect(result.filteredPayload?.warnings).toEqual(['global evidence','[same] local evidence']);expect(JSON.stringify(payload)).toBe(original);
  });
  it('unions multiple custom rules for the same dataset in original row order',()=>{
    const rows=[{leftId:'01',value:false},{rightId:'02',value:0},{leftId:'03',rightId:'04',value:''},{leftId:'03',rightId:'04',value:''}];
    const payload:CapturePayload={pointInfo:{},tables:{rows}};
    const policy:CollectionPolicy={version:1,storeVersion:4,rules:[{sourceId:'dataset.right',dataset:'rows',identityFields:['rightId']},{sourceId:'dataset.left',dataset:'rows',identityFields:['leftId']}]};
    const original=JSON.stringify(payload),result=evaluateCollectionScope(payload,policy);
    expect(result.allowed).toBe(true);expect(result.filteredPayload?.tables.rows).toEqual(rows);expect(JSON.stringify(payload)).toBe(original);
  });
  it('keeps aggregate duplicate dataset names distinguishable by frame provenance',()=>{
    const payload:CapturePayload={pointInfo:{},tables:{},frames:[frame('first','https://fixture.test/allowed','custom',[{id:'001',value:0}]),frame('second','https://fixture.test/allowed','custom',[{id:'002',value:false}])]};
    const result=evaluateCollectionScope(payload,custom(true));
    expect(result.filteredPayload?.tables.rows).toEqual([{id:'001',value:0}]);expect(result.filteredPayload?.tables['second::rows']).toEqual([{id:'002',value:false}]);expect(result.filteredPayload?.pointInfo['second::depth2']).toBe('custom');
  });
  it('does not use a custom match to bypass ambiguous default procurement data',()=>{
    const payload:CapturePayload={pointInfo:{...approved,areaCd:'14',depth1:'wrong'},tables:{rows:[{id:'001'}]}};
    const policy=custom(true);delete policy.rules![0].urlFilter;delete policy.rules![0].screenFilter;
    expect(evaluateCollectionScope(payload,policy).status).toBe('ambiguous');
  });
  it('does not let independent default/custom evaluations join different procurement parents',()=>{
    const customPoint={depth2:'custom',ctrtDmndRcptNo:'0002',ctrtDmndRcptOrd:'00'};
    const payload:CapturePayload={pointInfo:{},tables:{},frames:[{framePath:'default',url:'https://www.g2b.go.kr/default',pointInfo:approved,tables:{}},{framePath:'custom',url:'https://fixture.test/allowed',pointInfo:customPoint,tables:{rows:[{...customPoint,id:'001'}]}}]};
    const policy=custom(true);policy.rules![0].sourceId='procurement.receipt';policy.rules![0].identityFields=['ctrtDmndRcptNo','ctrtDmndRcptOrd'];
    expect(evaluateCollectionScope(payload,policy).status).toBe('ambiguous');
    const sameParent=structuredClone(payload);sameParent.frames![1].pointInfo.ctrtDmndRcptNo='0001';sameParent.frames![1].tables.rows[0].ctrtDmndRcptNo='0001';
    expect(evaluateCollectionScope(sameParent,policy).allowed).toBe(true);
    policy.rules![0].sourceId='dataset.user';policy.rules![0].identityFields=['id'];
    expect(evaluateCollectionScope(payload,policy).allowed).toBe(true); // Generic data does not acquire a procurement schema.
  });
  it('rejects invalid includeDefaults and URL filters and returns an independent policy copy',()=>{
    expect(()=>parseCollectionPolicy({...custom(),includeDefaults:'yes'})).toThrow();
    expect(()=>parseCollectionPolicy({...custom(),rules:[{...custom().rules![0],urlFilter:{join:'and',conditions:[{field:'url',operator:'invalid',values:[]}]}}]})).toThrow();
    const original=custom(true),parsed=parseCollectionPolicy(original);parsed.rules![0].urlFilter=(parsed.rules![0].urlFilter as any);(parsed.rules![0].urlFilter as any).values.push('changed');expect((original.rules![0].urlFilter as any).values).toEqual(['https://fixture.test/allowed']);
  });
});


it('keeps explicit custom rules active when areaCd fails the included default profile',()=>{
 const payload:CapturePayload={pointInfo:{areaCd:'13',depth1:'01001',depth2:'01114',ctrtDmndRcptNo:'001',ctrtDmndRcptOrd:'00'},tables:{rows:[{id:'x'}]}};
 expect(evaluateCollectionScope(payload).allowed).toBe(false);
 expect(evaluateCollectionScope(payload,{version:1,storeVersion:1,includeDefaults:true,rules:[{sourceId:'dataset.custom',dataset:'rows',identityFields:['id'],screenFilter:{field:'areaCd',operator:'equals',values:['13']}}]}).allowed).toBe(true);
});

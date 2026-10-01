import {it,expect} from 'vitest';
import {collectPage} from '../plugins/collector/extractor';
import {evaluateCollectionScope} from '../plugins/collector/scope';
import type {CapturePayload,CollectionPolicy} from '../packages/contracts/src';
it('extracts stable original grid ID once while retaining the runtime component ID',()=>{
 const sourceRows=[{id:'001',quantity:0,enabled:false},{id:'001',quantity:0,enabled:false}];
 const component={id:'wq_uuid_17_grid',getPluginName:()=> 'gridView',getOriginalID:()=> 'stableGrid',getDataList:()=>({getAllJSON:()=>sourceRows})};
 const fake={location:{href:'https://fixture.test'},document:{querySelectorAll:()=>[{id:'wq_uuid_17_grid'}]},WebSquare:{util:{getComponentById:()=>component}},frames:[]} as unknown as Window;
 const captured=collectPage(false,fake);expect(Object.keys(captured.tables)).toEqual(['stableGrid']);expect(captured.frames[0].tableSources).toEqual({stableGrid:{componentId:'wq_uuid_17_grid',originalId:'stableGrid'}});expect(captured.tables.stableGrid).toEqual(sourceRows);
});
it('legacy actual-ID and stable-ID rules resolve the same table without multiplying duplicate rows',()=>{
 const frame={framePath:'top',url:'https://fixture.test',pointInfo:{screen:'one'},tables:{stableGrid:[{id:'001',zero:0},{id:'001',zero:0}]},tableSources:{stableGrid:{componentId:'wq_uuid_17_grid',originalId:'stableGrid'}}};
 const payload:CapturePayload={pointInfo:{},tables:{},frames:[frame]};
 const rules=['wq_uuid_17_grid','stableGrid'].map(dataset=>({dataset,sourceId:'dataset.test',identityFields:['id'],urlFilter:{field:'url',operator:'equals' as const,values:[frame.url]}}));
 const policy:CollectionPolicy={version:1,storeVersion:1,rules};const result=evaluateCollectionScope(payload,policy);expect(result.allowed).toBe(true);expect(result.filteredPayload?.frames?.[0].tables).toEqual(frame.tables);expect(result.filteredPayload?.frames?.[0].tableSources).toEqual(frame.tableSources);
 const next=structuredClone(payload);next.frames![0].tableSources!.stableGrid.componentId='wq_uuid_99_grid';expect(evaluateCollectionScope(next,{...policy,rules:[rules[1]]}).allowed).toBe(true);
});
it('rejects malformed source metadata before collection',()=>{
 const result=evaluateCollectionScope({pointInfo:{},tables:{},tableSources:{missing:{componentId:'x',originalId:'y'}}},{version:1,storeVersion:0,rules:[]});expect(result.allowed).toBe(false);expect(result.reason).toContain('메타데이터');
});

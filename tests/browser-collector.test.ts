import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectPage, mergeFrameCaptures } from '../plugins/collector/extractor';
import { presentCapture, defaultExtractionOptions } from '../plugins/collector/presentation';
import { CollectionLoop } from '../plugins/collector/transfer';

function fakeWindow(components: Record<string,any>, frames: any[] = []): Window {
  return { location:{href:'https://fixture.test/screen'}, document:{querySelectorAll:()=>Object.keys(components).map(id=>({id}))}, frames, WebSquare:{util:{getComponentById:(id:string)=>components[id]}} } as unknown as Window;
}
afterEach(()=>vi.useRealTimers());
describe('WebSquare extraction',()=>{
  it('keeps zero false empty values, duplicate refs and data-list rows with provenance',()=>{
    const components={
      first:{getRef:()=> 'dm.same',getValue:()=>0},
      second:{getRef:()=> 'dm.same',getValue:()=>false},
      blank:{getRef:()=> 'dm.',getValue:()=>''},
      grid:{id:'result',getPluginName:()=> 'gridView',getDataList:()=> 'list'},
      list:{getAllJSON:()=>[{code:'01',price:'35608652.5',active:false}]}
    };
    const capture=collectPage(true,fakeWindow(components));
    expect(capture.pointInfo).toEqual({same:0,'same#2':false,blank:''});
    expect(capture.tables.result).toEqual([{code:'01',price:'35608652.5',active:false}]);
    expect(capture.frames[0].fieldSources['same#2']).toEqual({componentId:'second',ref:'dm.same'});
  });
  it('keeps readable data when one component and cross-origin frame fail',()=>{
    const inaccessible={get location(){throw new Error('cross-origin');}};
    const capture=collectPage(true,fakeWindow({
      good:{getValue:()=> 'kept'},
      bad:{getValue:()=>{throw new Error('read failure');}},
      grid:{getPluginName:()=> 'gridView',getDataList:()=>({getAllJSON:()=>null})}
    },[inaccessible]));
    expect(capture.pointInfo.good).toBe('kept');
    expect(capture.warnings.join(' ')).toContain('read failure');
    expect(capture.warnings.join(' ')).toContain('cross-origin');
    expect(capture.frames).toHaveLength(2);
  });
  it('does not overwrite same source name across separately injected frames',()=>{
    const result=collectPage(false,fakeWindow({depth:{getValue:()=> 'A'}}));
    const other=collectPage(false,fakeWindow({depth:{getValue:()=> 'B'}}));
    const merged=mergeFrameCaptures([{frameId:4,result:other},{frameId:0,result}]);
    expect(merged.pointInfo).toEqual({depth:'A','frame:4::depth':'B'});
    expect(merged.frames[1].framePath).toBe('frame:4/top');
  });
});
describe('extraction presentation',()=>{
  const original={pointInfo:{scalar:0,hidden:'text'},tables:{rows:[{mapped:0,flag:false,blank:' ',unmapped:8},{mapped:null,flag:null,blank:'',unmapped:null}],empty:[]}};
  it('default shows mapped columns and excludes empty rows/columns without mutating raw',()=>{
    const snapshot=JSON.stringify(original);
    const view=presentCapture(original,{mapped:'수량',flag:'여부',blank:'빈칸'},defaultExtractionOptions);
    expect(view.tables).toEqual([{source:'rows',columns:['mapped','flag'],rows:[{mapped:0,flag:false}]}]);
    expect(view.pointInfo).toEqual({});
    expect(JSON.stringify(original)).toBe(snapshot);
  });
  it('supports four modes and independently disabling empty filters',()=>{
    expect(presentCapture(original,{scalar:'화면값'},{...defaultExtractionOptions,mode:'mappedAll'}).pointInfo).toEqual({scalar:0});
    expect(presentCapture(original,{}, {...defaultExtractionOptions,mode:'allTables'}).pointInfo).toEqual({});
    const all=presentCapture(original,{}, {mode:'all',hideEmptyColumns:false,hideEmptyRows:false,hideEmptyTables:false});
    expect(all.tables).toHaveLength(2); expect(all.tables[0].rows).toHaveLength(2); expect(all.pointInfo).toEqual(original.pointInfo);
  });
});
describe('automatic collection lifecycle',()=>{
  it('always stops after capture and finalization failures',async()=>{
    vi.useFakeTimers();
    const collect=vi.fn(async()=>{throw new Error('storage full');});const failed=vi.fn();
    const loop=new CollectionLoop(collect,failed,10);
    loop.start(); await vi.advanceTimersByTimeAsync(20);
    expect(failed).toHaveBeenCalled();
    await expect(loop.stop(async()=>{throw new Error('final failed');})).rejects.toThrow('final failed');
    const calls=collect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(loop.active).toBe(false); expect(collect).toHaveBeenCalledTimes(calls);
  });
  it('does not restart a stopped in-flight collection',async()=>{
    vi.useFakeTimers(); let finish!:()=>void;
    const collect=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const loop=new CollectionLoop(collect,vi.fn(),10);
    loop.start(); const stopping=loop.stop(); finish(); await stopping; await vi.advanceTimersByTimeAsync(100);
    expect(collect).toHaveBeenCalledTimes(1);
  });
});


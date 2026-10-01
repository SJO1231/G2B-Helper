import { afterEach, describe, expect, it, vi } from 'vitest';
import { performPageAction, performWorkAction, type WorkActionRequest } from '../plugins/page-actions';

class Input {
  private current='';
  id=''; tagName='INPUT'; hidden=false; disabled=false; readOnly=false;
  textContent=''; attrs:Record<string,string>={}; options:any[]=[]; events:string[]=[];
  ownerDocument:any; click=vi.fn();
  constructor(id:string,value:string,tagName='INPUT') {this.id=id;this.value=value;this.tagName=tagName;}
  get value(){return this.current;} set value(value:string){this.current=value;}
  getAttribute(name:string){return this.attrs[name]??null;}
  closest(_selector:string){return null;}
  getBoundingClientRect(){return {width:100,height:20};}
  dispatchEvent(event:Event){this.events.push(event.type);return true;}
  appendChild(option:any){this.options.push(option);option.parent=this;return option;}
}
class Select extends Input {}
class TextArea extends Input {}

function fixture(elements:Input[],components:Record<string,any>={},frames:any[]=[]):any {
  const document:any={
    querySelectorAll(selector:string){
      if(selector==='[') throw new Error('Invalid selector');
      if(selector==='select') return elements.filter(e=>e.tagName==='SELECT');
      if(selector==='[id]') return elements;
      if(selector.includes('_ibxStrDay')) return elements.filter(e=>e.id.endsWith('_ibxStrDay'));
      if(selector.includes('_ibxEndDay')) return elements.filter(e=>e.id.endsWith('_ibxEndDay'));
      if(selector.includes('btnS0001')) return elements.filter(e=>e.id==='mf_wfm_container_btnS0001' || ['조회','검색'].includes(e.value));
      if(selector.includes('btnExcelDwnld')) return elements.filter(e=>e.id==='mf_wfm_container_btnExcelDwnld' || ['엑셀다운로드','엑셀다운'].includes(e.value));
      if(selector.startsWith('button,')) return elements.filter(e=>e.tagName==='BUTTON' || e.tagName==='A');
      if(selector.startsWith('#')) return elements.filter(e=>e.id===selector.slice(1));
      return [];
    },
    createElement(tag:string){
      const option:any={tagName:tag.toUpperCase(),value:'',text:'',disabled:false,remove(){const i=this.parent?.options.indexOf(this);if(i>=0)this.parent.options.splice(i,1);}};
      return option;
    }
  };
  elements.forEach(e=>e.ownerDocument=document);
  const w:any={document,frames,location:{href:'https://fixture.test/'},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),HTMLInputElement:Input,HTMLSelectElement:Input,HTMLTextAreaElement:Input,Event,WebSquare:{util:{getComponentById:(id:string)=>components[id]}}};
  return w;
}
function install(w:any) { vi.stubGlobal('window',w);vi.stubGlobal('document',w.document);vi.stubGlobal('HTMLInputElement',Input);vi.stubGlobal('HTMLSelectElement',Select);vi.stubGlobal('HTMLTextAreaElement',TextArea); }
function dates(start='20240101',end='20241231',prefix='screen') {return [new Input(prefix+'_ibxStrDay',start),new Input(prefix+'_ibxEndDay',end)];}
afterEach(()=>vi.unstubAllGlobals());

describe('independent browser work actions',()=>{
  it('remains serializable for executeScript without module closures',()=>{
    const fields=dates();install(fixture(fields));
    const injected=new Function('request','return ('+performWorkAction.toString()+')(request)') as (r:WorkActionRequest)=>ReturnType<typeof performWorkAction>;
    const result=injected({kind:'yearShift',years:1});
    expect(result.status).toBe('applied');expect(fields.map(e=>e.value)).toEqual(['20250101','20251231']);
  });
  it('preserves original first-click normalization for a leap-day period',()=>{
    const fields=dates('2024-02-29','2024-03-02');install(fixture(fields));
    expect(performWorkAction({kind:'yearShift',years:-1}).status).toBe('applied');
    expect(fields.map(e=>e.value)).toEqual(['2024-01-01','2024-12-31']);
    performWorkAction({kind:'yearShift',years:-1});
    expect(fields.map(e=>e.value)).toEqual(['2023-01-01','2023-12-31']);
  });
  it('rejects impossible leap dates and leaves both values intact',()=>{
    const fields=dates('20230229','20230310');install(fixture(fields));
    expect(performWorkAction({kind:'yearShift',years:1}).status).toBe('invalid');
    expect(fields.map(e=>e.value)).toEqual(['20230229','20230310']);
  });
  it('previews an explicit annual range without applying values or clicking',()=>{
    const fields=dates();const search=new Input('mf_wfm_container_btnS0001','검색');install(fixture([...fields,search]));
    const result=performWorkAction({kind:'yearRange',year:2028,mode:'inspect',searchAfter:true});
    expect(result.status).toBe('ready');expect(result.changes.map(c=>c.after)).toEqual(['20280101','20281231']);
    expect(fields.map(e=>e.value)).toEqual(['20240101','20241231']);expect(search.click).not.toHaveBeenCalled();expect(result.clicked).toBe(false);
  });
  it('requires a search candidate before a requested immediate query changes dates',()=>{
    const fields=dates();install(fixture(fields));
    expect(performWorkAction({kind:'yearShift',years:1,searchAfter:true}).status).toBe('unavailable');
    expect(fields.map(e=>e.value)).toEqual(['20240101','20241231']);
  });
  it('applies dates through $p WebSquare APIs then invokes one search trigger',()=>{
    const fields=dates();const search=new Input('mf_wfm_container_btnS0001','검색');const components:Record<string,any>={};
    fields.forEach(e=>{let value=e.value;components[e.id]={getValue:()=>value,setValue:vi.fn((v:string)=>{value=v;})};});
    components[search.id]={trigger:vi.fn()};const w=fixture([...fields,search]);w.$p={getComponentById:(id:string)=>components[id]};install(w);
    const result=performWorkAction({kind:'yearShift',years:1,searchAfter:true});
    expect(result.status).toBe('applied');expect(result.clicked).toBe(true);expect(components[search.id].trigger).toHaveBeenCalledExactlyOnceWith('onclick');expect(search.click).not.toHaveBeenCalled();
    expect(components[fields[0].id].setValue).toHaveBeenCalledWith('20250101');
  });
  it('returns all candidates and requires explicit selection instead of first matches',()=>{
    const first=dates(),second=dates('20200101','20201231','other');install(fixture([...first,...second]));
    const unresolved=performWorkAction({kind:'yearShift',years:1});
    expect(unresolved.status).toBe('needsSelection');expect(first[0].value).toBe('20240101');
    const selection=Object.fromEntries(unresolved.candidates.filter(c=>c.elementId.startsWith('other')).map(c=>[c.role,c.id]));
    const applied=performWorkAction({kind:'yearShift',years:1,selection});
    expect(applied.status).toBe('applied');expect(second.map(e=>e.value)).toEqual(['20210101','20211231']);expect(first[0].value).toBe('20240101');
  });
  it('uses current frame only by default and reports inaccessible children when traversing',()=>{
    const child=fixture(dates());const blocked={get document(){throw new Error('cross-origin');}};install(fixture([],{},[child,blocked]));
    expect(performWorkAction({kind:'detect'}).candidates).toHaveLength(0);
    const detection=performWorkAction({kind:'detect',traverseFrames:true});
    expect(detection.candidates).toHaveLength(2);expect(detection.candidates[0].framePath).toBe('top/frames[0]');expect(detection.warnings.join(' ')).toContain('cross-origin');
  });
  it('does not combine a start date and end date from separate frames',()=>{
    const [start,end]=dates();install(fixture([start],{},[fixture([end])]));
    expect(performWorkAction({kind:'yearShift',years:1,traverseFrames:true}).status).toBe('needsSelection');
    expect(start.value).toBe('20240101');
  });
  it('requires explicit pairing for different date groups in a single frame',()=>{
    const [start]=dates();const [,end]=dates('20240101','20241231','other');install(fixture([start,end]));
    const pending=performWorkAction({kind:'yearShift',years:1});
    expect(pending.status).toBe('needsSelection');expect(start.value).toBe('20240101');
    const selection=Object.fromEntries(pending.candidates.map(c=>[c.role,c.id]));
    expect(performWorkAction({kind:'yearShift',years:1,selection}).status).toBe('applied');
  });
  it('sets custom row count with WebSquare addItem and does not click implicitly',()=>{
    const count=new Input('recordcountperpage','10','SELECT');count.options=[{value:'10',disabled:false}];let value='10';
    const component={getValue:()=>value,setValue:vi.fn((v:string)=>{value=v;}),addItem:vi.fn()};install(fixture([count],{[count.id]:component}));
    const preview=performWorkAction({kind:'setRowCount',rowCount:250,mode:'inspect'});
    expect(preview.status).toBe('ready');expect(component.addItem).not.toHaveBeenCalled();expect(count.options).toHaveLength(1);
    const result=performWorkAction({kind:'setRowCount',rowCount:250});
    expect(result.status).toBe('applied');expect(result.clicked).toBe(false);expect(component.addItem).toHaveBeenCalledExactlyOnceWith('250','250');expect(component.setValue).toHaveBeenCalledWith('250');expect(count.options.map(o=>o.value)).toEqual(['10','250']);expect(result.warnings.join(' ')).toContain('서버');
  });
  it('supports native custom count setting and explicit searchAfter',()=>{
    const count=new Input('pageSize','10','SELECT');count.options=[{value:'10',disabled:false}];const search=new Input('mf_wfm_container_btnS0001','조회');install(fixture([count,search]));
    const result=performWorkAction({kind:'setRowCount',rowCount:37,searchAfter:true});
    expect(result.status).toBe('applied');expect(count.value).toBe('37');expect(count.events).toEqual(['input','change']);expect(search.click).toHaveBeenCalledOnce();
  });
  it('returns unavailable for disabled buttons and excludes hidden buttons',()=>{
    const search=new Input('mf_wfm_container_btnS0001','조회');search.disabled=true;const excel=new Input('mf_wfm_container_btnExcelDwnld','엑셀다운로드');excel.hidden=true;install(fixture([search,excel]));
    expect(performWorkAction({kind:'search'}).status).toBe('unavailable');expect(performWorkAction({kind:'excel'}).status).toBe('unavailable');expect(search.click).not.toHaveBeenCalled();
  });
  it('never guesses query from unrelated text or pagination/Enter fallbacks',()=>{
    const input=new Input('arbitrary','');const page=new Input('pagination','1','A');page.textContent='상세조회';install(fixture([input,page]));
    expect(performWorkAction({kind:'search'}).status).toBe('unavailable');expect(page.click).not.toHaveBeenCalled();expect(input.events).toEqual([]);
  });
  it('does not accept stale selections or malformed manual selectors',()=>{
    install(fixture(dates()));
    expect(performWorkAction({kind:'yearShift',years:1,selection:{startDate:'stale'}}).status).toBe('invalid');
    expect(performWorkAction({kind:'search',selectors:{search:'['}}).status).toBe('invalid');
  });
  it('does not mask component read failure as a working DOM field',()=>{
    const fields=dates();install(fixture(fields,{[fields[0].id]:{getValue:()=>{throw new Error('broken');},setValue:vi.fn()}}));
    expect(performWorkAction({kind:'yearShift',years:1}).status).toBe('unavailable');expect(fields[1].value).toBe('20241231');
  });
  it('restores attempted values after a setter failure without performing query',()=>{
    const fields=dates();let start=fields[0].value;const search=new Input('mf_wfm_container_btnS0001','검색');
    const comps={
      [fields[0].id]:{getValue:()=>start,setValue:(v:string)=>{start=v;}},
      [fields[1].id]:{getValue:()=>fields[1].value,setValue:(v:string)=>{if(v==='20251231')throw new Error('rejected');fields[1].value=v;}}
    };install(fixture([...fields,search],comps));
    const result=performWorkAction({kind:'yearShift',years:1,searchAfter:true});
    expect(result.status).toBe('failed');expect(start).toBe('20240101');expect(fields[1].value).toBe('20241231');expect(search.click).not.toHaveBeenCalled();
  });
  it('executes Excel click without claiming download completion',()=>{
    const excel=new Input('mf_wfm_container_btnExcelDwnld','엑셀다운로드');install(fixture([excel]));
    const result=performWorkAction({kind:'excel'});
    expect(result.status).toBe('applied');expect(excel.click).toHaveBeenCalledOnce();expect(result.message).toContain('별도 확인');
  });
  it('reports a button attempt when a handler throws after dispatch',()=>{
    const search=new Input('mf_wfm_container_btnS0001','검색');search.click=vi.fn(()=>{throw new Error('handler failed');});install(fixture([search]));
    const result=performWorkAction({kind:'search'});
    expect(result.status).toBe('failed');expect(result.clicked).toBe(true);expect(result.warnings.join(' ')).toContain('복원할 수 없습니다');
  });
});

describe('legacy page action compatibility',()=>{
  it('keeps readText, native setValue and day-based dateShift',()=>{
    const input=new Input('manual','2024-02-28');install(fixture([input]));
    expect(performPageAction({kind:'readText',selector:'#manual'})).toEqual({text:'2024-02-28'});
    expect(performPageAction({kind:'dateShift',selector:'#manual',days:1})).toEqual({applied:true,value:'2024-02-29'});
    expect(performPageAction({kind:'setValue',selector:'#manual',value:'hello'})).toEqual({applied:true,value:'hello'});
  });
});

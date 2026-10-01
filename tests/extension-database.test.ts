import {describe,it,expect,vi} from 'vitest';
vi.mock('../apps/extension/transport',()=>({openSurface:vi.fn()}));
import {databaseCategory,databaseFilter,readDatabaseTable,databaseChanges,isDatabaseBlank,databaseGroupSources,databaseVisibleColumns,databaseInputRows,databaseMergeInput,databaseNeedsInputRow,databaseNextColumn,databaseFormula,databaseRelationRows} from '../apps/extension/features/Database';
import {mergeGridEdits} from '../apps/ui/editBuffer';
import type {Column} from '../apps/ui/Grid';
import type {Filter} from '../apps/ui/Filter';

const columns:Column[]=[{field:'number',label:'번호',kind:'text',hidden:false,frozen:true,editable:true},{field:'status',label:'상태',kind:'code',values:{'00':'접수'},editable:true},{field:'hidden',label:'숨김',hidden:true,editable:false}];
const filter:Filter={join:'and',conditions:[{field:'status',operator:'equals',values:['00']}]};
const row=(id:string)=>({__rowId:id,__storeVersion:7,number:'001',status:'00',hidden:'원본'});
const page=(rows:ReturnType<typeof row>[],extra:Record<string,unknown>={})=>({sourceId:'dataset.test',rows,columns,storeVersion:3,rowCount:rows.length,hasMore:false,...extra});

describe('extension DB whole-table reads',()=>{
 it('passes the same server filter through every page and keeps display metadata',async()=>{
  const first=Array.from({length:1000},(_,i)=>row(String(i)));const read=vi.fn().mockResolvedValueOnce(page(first,{rowCount:1001,hasMore:true})).mockResolvedValueOnce(page([row('1000')],{rowCount:1001}));
  const result=await readDatabaseTable('dataset.test',filter,read);
  expect(result.rows).toHaveLength(1001);expect(result.columns).toEqual(columns);expect(result.storeVersion).toBe(3);
  expect(read.mock.calls.map(([,payload])=>payload)).toEqual([{sourceId:'dataset.test',filter,offset:0,limit:1000},{sourceId:'dataset.test',filter,offset:1000,limit:1000}]);
 });
 it.each([
  ['table version',{storeVersion:4}],['schema',{columns:[...columns,{field:'new'}]}],['row count',{rowCount:3}],
 ])('rejects a changing %s instead of using a partial baseline',async(_,change)=>{
  const read=vi.fn().mockResolvedValueOnce(page([row('a')],{rowCount:2,hasMore:true})).mockResolvedValueOnce(page([row('b')],{rowCount:2,...change}));
  await expect(readDatabaseTable('dataset.test',filter,read)).rejects.toThrow('읽는 동안 표가 변경');
 });
 it('rejects an empty continuation and repeated source rows',async()=>{
  const empty=vi.fn().mockResolvedValueOnce(page([row('a')],{rowCount:2,hasMore:true})).mockResolvedValueOnce(page([],{rowCount:2,hasMore:true}));
  await expect(readDatabaseTable('dataset.test',filter,empty)).rejects.toThrow('다음 페이지');
  const duplicate=vi.fn().mockResolvedValueOnce(page([row('a')],{rowCount:2,hasMore:true})).mockResolvedValueOnce(page([row('a')],{rowCount:2}));
  await expect(readDatabaseTable('dataset.test',filter,duplicate)).rejects.toThrow('반복되거나 누락');
 });
 it('rejects another source and an incomplete final page',async()=>{
  await expect(readDatabaseTable('dataset.test',filter,async()=>page([],{sourceId:'other'}))).rejects.toThrow('출처');
  await expect(readDatabaseTable('dataset.test',filter,async()=>page([row('a')],{rowCount:2}))).rejects.toThrow('다음 페이지');
 });
 it('does not begin another page after navigation invalidates the read',async()=>{
  let current=true;const read=vi.fn(async()=>{current=false;return page([row('a')],{rowCount:2,hasMore:true});});
  await expect(readDatabaseTable('dataset.test',filter,read,()=>current)).rejects.toThrow('취소');expect(read).toHaveBeenCalledTimes(1);
 });
 it('accepts a genuine empty table without losing its configured columns',async()=>{
  const result=await readDatabaseTable('dataset.test',filter,async()=>page([]));expect(result.rows).toEqual([]);expect(result.columns).toEqual(columns);
 });
});

describe('extension DB edits and presentation',()=>{
 it('keeps hidden rows, hidden fields, decimal strings and observed CAS versions',()=>{
  const original=[{...row('blank'),number:'',status:'',hidden:''},{...row('visible'),amount:'35608652.5',zero:0,flag:false}];
  const edited=mergeGridEdits(original,[{__rowId:'visible',__storeVersion:999,number:'002',__virtual0:'display only'}]);
  const changes=databaseChanges(original,edited,columns,columns);
  expect(changes.deleted).toEqual([]);expect(changes.added).toEqual([]);
  expect(changes.updated).toEqual([{rowId:'visible',storeVersion:7,values:{number:'002',status:'00',hidden:'원본',amount:'35608652.5',zero:0,flag:false}}]);
 });
 it('bundles appended columns with new rows and explicit deletions, without changing old metadata',()=>{
  const original=[row('kept'),row('deleted')];const added={__rowId:'new-row',number:'000',status:'00',new:'추가'};const nextColumns=[...columns,{field:'new',label:'새 열',kind:'text'}];
  const changes=databaseChanges(original,[row('kept'),added],columns,nextColumns);
  expect(changes.columns).toBe(nextColumns);expect(changes.added).toEqual([{number:'000',status:'00',new:'추가'}]);expect(changes.deleted).toEqual([{rowId:'deleted',storeVersion:7}]);expect(changes.updated).toEqual([]);
  expect(()=>databaseChanges(original,original,columns,[{...columns[0],frozen:false},...columns.slice(1)])).toThrow('표 설정');
 });
 it('does not delete records absent from a filtered edit baseline',()=>{
  const changes=databaseChanges([row('observed')],[{...row('observed'),number:'새 값'}],columns,columns);
  expect(changes.deleted).toEqual([]);expect(changes.updated.map(change=>change.rowId)).toEqual(['observed']);
 });
 it('combines whole-table raw and dictionary label search with the existing filter',()=>{
  const result=databaseFilter(filter,' 접수 ',columns,'status');
  expect(result).toEqual({join:'and',conditions:[filter,{join:'or',conditions:[{field:'status',operator:'contains',values:['접수'],compareAs:'raw'},{field:'status',operator:'contains',values:['접수'],compareAs:'label'}]}]});
  (result.conditions[0] as Filter).conditions=[];expect(filter.conditions).toHaveLength(1);expect(()=>databaseFilter(filter,'x',columns,'missing')).toThrow('검색할 열');
 });
 it('maps collection and dataset to business without renaming the source',()=>{
  expect([0,false,'00','35608652.5',{},[]].every(value=>!isDatabaseBlank(value))).toBe(true);expect(['',null,undefined,' '].every(isDatabaseBlank)).toBe(true);
  const inputs=[{sourceId:'procurement.receipt',group:'collection'},{sourceId:'dataset.custom',group:'dataset'},{sourceId:'contacts',group:'reference'},{sourceId:'launchers',group:'reference'},{sourceId:'sys.raw',group:'settings'}];
  expect(inputs.map(databaseCategory)).toEqual(['업무','업무','공통','시스템','시스템']);expect(inputs[3]).toEqual({sourceId:'launchers',group:'reference'});
 });
 it('uses a fixed group list for both tabs and sidebar, with notices first',()=>{
  const sources=[['procurement.receipt','collection'],['contacts','reference'],['dataset.custom','dataset'],['procurement.bid_item','collection'],['procurement.bid','collection'],['launchers','reference']].map(([sourceId,group])=>({sourceId,group,label:sourceId,editable:true}));
  expect(databaseGroupSources(sources,'업무').map(source=>source.sourceId)).toEqual(['procurement.bid','procurement.bid_item','procurement.receipt','dataset.custom']);
  expect(databaseGroupSources(sources,'공통').map(source=>source.sourceId)).toEqual(['contacts']);
  expect(databaseGroupSources(sources,'시스템').map(source=>source.sourceId)).toEqual(['launchers']);
  expect(databaseGroupSources(sources,'업무')).toHaveLength(4);
 });
 it('retains empty columns and dictionary metadata unless explicitly hidden',()=>{
  const blank={field:'blank',label:'빈 열',values:{'00':'미입력'}};
  expect(databaseVisibleColumns([...columns,blank])).toEqual([columns[0],columns[1],blank]);
  expect(databaseVisibleColumns(columns)[1].values).toEqual({'00':'접수'});
 });
 it('shows blank input slots but saves only entered drafts and retains blank source rows',()=>{
  const original=[{__rowId:'stored-empty',__storeVersion:3,number:'',status:''}];
  const visible=databaseInputRows(original,'test');expect(visible).toHaveLength(12);
  const untouched=databaseMergeInput(original,visible);expect(untouched).toEqual(original);
  visible[1].number='001';visible[1].hidden='';
  const edited=databaseMergeInput(original,visible);
  expect(databaseChanges(original,edited,columns,columns).added).toEqual([{number:'001',hidden:''}]);
  expect(edited.some(row=>row.__draft)).toBe(false);
 });
 it('preserves zero and false in a newly entered blank slot',()=>{
  const visible=databaseInputRows([],'test');visible[0].zero=0;visible[0].flag=false;
  expect(databaseChanges([],databaseMergeInput([],visible),[],[]).added).toEqual([{zero:0,flag:false}]);
 });
 it('replenishes after editing the last slot even when earlier input slots are still empty',()=>{
  const slots=databaseInputRows([],'test');expect(databaseNeedsInputRow(slots)).toBe(false);
  slots[slots.length-1].zero=0;expect(databaseNeedsInputRow(slots)).toBe(true);
  slots.push({__rowId:'next',__draft:true});expect(databaseNeedsInputRow(slots)).toBe(false);
  expect(databaseNeedsInputRow([])).toBe(true);
 });
 it('adds a usable column immediately with a collision-free key',()=>{
  expect(databaseNextColumn([{field:'column_1'},{field:'column_3'}])).toEqual({field:'column_2',label:'열 2',kind:'text',editable:true});
 });
 it('joins saved relation results without overwriting equal source keys or resolving ambiguity',()=>{
  const output=databaseRelationRows([{left:{__rowId:'l',code:'001',zero:0},right:[{__rowId:'r1',code:'002',flag:false},{__rowId:'r2',code:'003'}],status:'ambiguous'},{left:{__rowId:'missing',code:'004'},right:[],status:'missing'}]);
  expect(output).toHaveLength(3);expect(output[0]).toMatchObject({'left.code':'001','right.code':'002','left.zero':0,'right.flag':false,status:'ambiguous',leftRowId:'l',rightRowId:'r1'});
  expect(output[2]).toMatchObject({status:'missing',leftRowId:'missing',rightRowId:''});
 });
});

describe('DB Excel-style calculation',()=>{
 const numericColumns:Column[]=[{field:'amount',kind:'decimal'},{field:'hidden',hidden:true},{field:'count',kind:'integer'}];
 const rows=[{amount:'9007199254740993.1',count:2},{amount:'0.2',count:3},{amount:'',count:0}];
 it.each([
  ['=SUM(A1:A2)','9007199254740993.3'],['=AVERAGE(B1:B2)','2.5'],['=MIN(B1:B3)','0'],['=MAX(B1:B3)','3'],['=COUNT(A1:A3)','2'],['=SUM(B1:B3)*2+1','11'],['=SUM(1,2;3)','6'],['=(1+2)/10','0.3'],['=SUM(B3:B1)','5'],
 ])('evaluates %s with decimal text and visible-column cell addresses',(expression,result)=>expect(databaseFormula(expression,rows,numericColumns)).toBe(result));
 it('retains exact original field keys in row references',()=>expect(databaseFormula('=[amount]+[count]',rows,numericColumns,rows[1])).toBe('3.2'));
 it('does not collapse case-sensitive source keys and accepts lower-case functions',()=>{
  expect(databaseFormula('=[code]+[CODE]',[],[],{code:'1',CODE:'2'})).toBe('3');
  expect(databaseFormula('=sum(b1:b2)',rows,numericColumns)).toBe('5');
 });
 it.each(['=FETCH("https://example.test")','=SUM(A1:Z9)','=1/0','=process.exit()','=SUM(A1:A2','=UNKNOWN(1)','=A1:B2+1'])('rejects unsupported or invalid %s without changing input',expression=>{
  const before=structuredClone(rows);expect(()=>databaseFormula(expression,rows,numericColumns)).toThrow();expect(rows).toEqual(before);
 });
 it('rejects textual cells instead of silently treating them as numbers',()=>expect(()=>databaseFormula('=SUM(A1:A2)',[{amount:'001'},{amount:'code'}],numericColumns)).toThrow('숫자가 아닌'));
});

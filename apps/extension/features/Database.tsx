import {useEffect,useMemo,useRef,useState} from 'react';
import {request} from '../../../plugins/core/gateway';
import {aggregateDecimal,evaluateCalculation} from '../../../plugins/core/calculation';
import Decimal from 'decimal.js';
import {DataGrid,type Column,type RecordRow,type GridHandle} from '../../ui/Grid';
import {FilterEditor,emptyFilter,type Filter} from '../../ui/Filter';
import {ImportDialog,exportSheet,download} from '../../ui/ImportExport';
import {TableSettingsPanel} from '../../ui/features/TableSettingsPanel';
import {RelationPanel} from '../../ui/features/RelationPanel';
import {mergeGridEdits} from '../../ui/editBuffer';
import {openSurface} from '../transport';
import './db.css';

type Source={sourceId:string;label:string;group:string;editable:boolean;columns?:Column[];storeVersion?:number;rowCount?:number;[key:string]:unknown};
export type DatabaseSnapshot={sourceId:string;columns:Column[];rows:RecordRow[];storeVersion:number;rowCount:number};
type Page=DatabaseSnapshot&{offset?:number;hasMore?:boolean};
type ReadPage=(command:string,payload:Record<string,unknown>)=>Promise<Page>;
const categories=['업무','공통','시스템'] as const;
const systemIds=new Set(['launchers','templates','file_links']);
export function databaseCategory(source:Pick<Source,'sourceId'|'group'>):typeof categories[number]{
 if(source.group==='collection')return '업무';
 if(source.group==='settings'||source.group==='system'||source.sourceId.startsWith('sys.')||systemIds.has(source.sourceId))return '시스템';
 if(source.group==='dataset'||source.group==='business')return '업무';
 return '공통';
}
export function databaseFilter(filter:Filter,term:string,columns:Column[],field=''):Filter{
 const text=term.trim();if(!text)return structuredClone(filter);
 const search:Filter={join:'or',conditions:columns.filter(column=>!column.field.startsWith('__')&&(!field||column.field===field)).flatMap(column=>[
  {field:column.field,operator:'contains',values:[text],compareAs:'raw' as const},
  {field:column.field,operator:'contains',values:[text],compareAs:'label' as const},
 ])};
 if(!search.conditions.length)throw Error('검색할 열을 선택하세요.');
 return {join:'and',conditions:[structuredClone(filter),search]};
}
/** Every page is filtered by the Gateway before pagination; a partial read is never an edit baseline. */
export async function readDatabaseTable(sourceId:string,filter:Filter,read:ReadPage=request,isCurrent=()=>true):Promise<DatabaseSnapshot>{
 const rows:RecordRow[]=[],ids=new Set<string>();let first:Page|undefined,offset=0;
 for(;;){
  if(!isCurrent())throw Error('표 읽기가 취소되었습니다.');
  const page=await read('table.read',{sourceId,filter,offset,limit:1000});
  if(!isCurrent())throw Error('표 읽기가 취소되었습니다.');
  if(page.sourceId!==sourceId||!Array.isArray(page.rows)||!Array.isArray(page.columns)||!Number.isSafeInteger(page.storeVersion)||!Number.isSafeInteger(page.rowCount)||page.rowCount<0)throw Error('표 응답의 출처·구조·버전을 확인할 수 없습니다.');
  first??=page;
  if(page.storeVersion!==first.storeVersion||page.rowCount!==first.rowCount||JSON.stringify(page.columns)!==JSON.stringify(first.columns))throw Error('읽는 동안 표가 변경되었습니다. 다시 읽어 주세요.');
  for(const row of page.rows){if(typeof row.__rowId!=='string'||ids.has(row.__rowId)||!Number.isSafeInteger(row.__storeVersion))throw Error('표 행 식별/버전이 반복되거나 누락되었습니다. 다시 읽어 주세요.');ids.add(row.__rowId);}
  rows.push(...page.rows);offset+=page.rows.length;
  if(offset>page.rowCount)throw Error('표의 전체 행 수와 응답이 다릅니다. 다시 읽어 주세요.');
  if(!page.hasMore&&offset===page.rowCount)break;
  if(!page.rows.length||page.hasMore===false)throw Error('표의 다음 페이지를 읽지 못했습니다.');
 }
 return {sourceId,rows,columns:first.columns,storeVersion:first.storeVersion,rowCount:first.rowCount};
}
const clean=(row:RecordRow)=>Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('__')));
export function databaseChanges(original:RecordRow[],edited:RecordRow[],originalColumns:Column[],columns:Column[]){
 const before=new Map(original.map(row=>[row.__rowId,row]));
 if(columns.length<originalColumns.length||originalColumns.some((column,index)=>JSON.stringify(column)!==JSON.stringify(columns[index])))throw Error('기존 열 설정은 표 설정에서 변경하세요. 편집 저장은 추가 열만 반영합니다.');
 return {
  ...(columns.length>originalColumns.length?{columns}:{}),
  added:edited.filter(row=>!before.has(row.__rowId)).map(clean),
  updated:edited.filter(row=>before.has(row.__rowId)&&JSON.stringify(clean(row))!==JSON.stringify(clean(before.get(row.__rowId)!))).map(row=>({rowId:row.__rowId,storeVersion:before.get(row.__rowId)!.__storeVersion,values:clean(row)})),
  deleted:original.filter(row=>!edited.some(next=>next.__rowId===row.__rowId)).map(row=>({rowId:row.__rowId,storeVersion:row.__storeVersion})),
 };
}
export const isDatabaseBlank=(value:unknown)=>value==null||typeof value==='string'&&!value.trim();

const workOrder=['procurement.bid','procurement.bid_item','procurement.receipt','procurement.receipt_item','procurement.contract','procurement.contract_item'];
export function databaseGroupSources(sources:Source[],category:ReturnType<typeof databaseCategory>):Source[]{
 return sources.filter(source=>databaseCategory(source)===category).map((source,index)=>({source,index})).sort((a,b)=>{
  const order=(source:Source)=>{const index=workOrder.indexOf(source.sourceId);return index<0?workOrder.length:index;};
  return order(a.source)-order(b.source)||a.index-b.index;
 }).map(entry=>entry.source);
}
export function databaseVisibleColumns(columns:Column[]){return columns.filter(column=>!column.hidden&&!column.field.startsWith('__'));}
/** Empty input slots are not source records. Existing empty records are retained. */
export function databaseInputRows(rows:RecordRow[],sourceId:string,minimum=12):RecordRow[]{
 const count=Math.max(1,minimum-rows.length);
 return [...rows,...Array.from({length:count},(_,index)=>({__rowId:'draft-'+sourceId+'-'+index,__draft:true}))];
}
export function databaseMergeInput(previous:RecordRow[],visible:RecordRow[],deletedIds:string[]=[]){
 const input=visible.filter(row=>!row.__draft||Object.entries(row).some(([field,value])=>!field.startsWith('__')&&!isDatabaseBlank(value)));
 return mergeGridEdits(previous,input,deletedIds).map(row=>Object.fromEntries(Object.entries(row).filter(([field])=>field!=='__draft')));
}
export function databaseNeedsInputRow(rows:RecordRow[]){
 const last=rows.at(-1);
 return !last||!last.__draft||Object.entries(last).some(([field,value])=>!field.startsWith('__')&&!isDatabaseBlank(value));
}
export function databaseNextColumn(columns:Column[]):Column{
 let index=1;while(columns.some(column=>column.field==='column_'+index))index++;
 return {field:'column_'+index,label:'열 '+index,kind:'text',editable:true};
}
/** Bounded Excel-style syntax; values are evaluated using the shared Decimal calculation module. */
export function databaseFormula(expression:string,rows:RecordRow[],columns:Column[],row:RecordRow={}):string{
 if(expression.length>4096)throw Error('수식은 4096자 이내로 입력하세요.');
 const text=expression.trim().replace(/^=/,'');
 const tokens=text.match(/\[[^\]]+\]|[A-Z]+\d+|[A-Z]+|\d+(?:\.\d+)?|[()+\-*/,:;]/gi)||[];
 if(tokens.join('').replace(/\s/g,'')!==text.replace(/\s/g,''))throw Error('사칙연산, 셀 범위, SUM·AVERAGE·MIN·MAX·COUNT만 사용할 수 있습니다.');
 const visible=databaseVisibleColumns(columns);let offset=0,visited=0;
 const numeric=(value:unknown):string=>{if(isDatabaseBlank(value))return '';if(!/^[-+]?\d+(\.\d+)?$/.test(String(value)))throw Error('참조한 셀에 숫자가 아닌 값이 있습니다.');return String(value);};
 const address=(token:string)=>{const match=/^([A-Z]+)(\d+)$/.exec(token);if(!match)throw Error('셀 주소를 확인하세요.');let column=0;for(const char of match[1])column=column*26+char.charCodeAt(0)-64;const line=Number(match[2])-1;if(line<0||line>=rows.length||column<1||column>visible.length)throw Error('현재 표 밖의 셀은 참조할 수 없습니다.');return {line,column:column-1};};
 const scalar=(value:string|string[])=>{if(Array.isArray(value))throw Error('셀 범위는 함수 안에서 사용하세요.');return value||'0';};
 const atom=():string|string[]=>{
  const raw=tokens[offset++],token=raw?.startsWith('[')?raw:raw?.toUpperCase();if(!token)throw Error('수식을 확인하세요.');
  if(token==='+'||token==='-')return evaluateCalculation(token+'('+scalar(atom())+')');
  if(token==='('){const value=sum();if(tokens[offset++]!==')')throw Error('괄호를 확인하세요.');return value;}
  if(/^\d/.test(token))return token;
  if(token.startsWith('['))return numeric(row[token.slice(1,-1)]);
  if(/^[A-Z]+\d+$/.test(token)){
   const start=address(token);if(tokens[offset]!==':')return numeric(rows[start.line]?.[visible[start.column].field]);
   offset++;const end=address((tokens[offset++]||'').toUpperCase());const values:string[]=[];
   for(let line=Math.min(start.line,end.line);line<=Math.max(start.line,end.line);line++)for(let column=Math.min(start.column,end.column);column<=Math.max(start.column,end.column);column++){if(++visited>10000)throw Error('수식은 최대 10000셀까지 참조할 수 있습니다.');values.push(numeric(rows[line]?.[visible[column].field]));}
   return values;
  }
  if(!['SUM','AVERAGE','MIN','MAX','COUNT'].includes(token)||tokens[offset++]!=='(')throw Error('지원하지 않는 함수입니다.');
  const args:string[]=[];if(tokens[offset]!==')')for(;;){const value=sum();args.push(...(Array.isArray(value)?value:[value]));if(tokens[offset]!==','&&tokens[offset]!==';')break;offset++;}
  if(tokens[offset++]!==')')throw Error('함수 괄호를 확인하세요.');const values=args.filter(value=>value!=='');
  if(token==='COUNT')return String(values.length);
  if(token==='SUM')return aggregateDecimal(values,'sum');
  if(!values.length)throw Error('함수에 숫자 셀이 없습니다.');
  if(token==='AVERAGE')return aggregateDecimal(values,'average');
  return values.reduce((answer,value)=>new Decimal(answer)[token==='MIN'?'lte':'gte'](value)?answer:value);
 };
 const product=():string|string[]=>{let value=atom();while(tokens[offset]==='*'||tokens[offset]==='/'){const op=tokens[offset++];value=evaluateCalculation('('+scalar(value)+')'+op+'('+scalar(atom())+')');}return value;};
 const sum=():string|string[]=>{let value=product();while(tokens[offset]==='+'||tokens[offset]==='-'){const op=tokens[offset++];value=evaluateCalculation('('+scalar(value)+')'+op+'('+scalar(product())+')');}return value;};
 const value=scalar(sum());if(offset!==tokens.length)throw Error('수식을 확인하세요.');return evaluateCalculation(value);
}
type Relation={id:string;name:string;leftSourceId:string;rightSourceId:string;fieldPairs:{left:string;right:string}[];cardinality:string};
export function databaseRelationRows(matches:{left:RecordRow;right:RecordRow[];status:string}[]){
 return matches.flatMap((match,index)=>(match.right.length?match.right:[null]).map((right,child)=>({
  __rowId:'relation-'+index+'-'+child,status:match.status,
  leftRowId:match.left.__rowId,rightRowId:right?.__rowId||'',
  ...Object.fromEntries(Object.entries(clean(match.left)).map(([key,value])=>['left.'+key,value])),
  ...Object.fromEntries(Object.entries(clean(right||{})).map(([key,value])=>['right.'+key,value])),
 })));
}
function IntegratedView({sources,report,onSettings}:{sources:Source[];report:(text:string)=>void;onSettings:()=>void}){
 const [relations,setRelations]=useState<Relation[]>([]),[id,setId]=useState(''),[view,setView]=useState('table'),[data,setData]=useState<RecordRow[]>([]),[loading,setLoading]=useState(false),[metadata,setMetadata]=useState<{left:Column[];right:Column[]}>({left:[],right:[]});
 const selected=relations.find(relation=>relation.id===id),left=sources.find(source=>source.sourceId===selected?.leftSourceId),right=sources.find(source=>source.sourceId===selected?.rightSourceId);
 useEffect(()=>{let live=true;request('relation.list').then(result=>{if(live){const list=Array.isArray(result)?result:result.relations||[];setRelations(list);setId(list[0]?.id||'');}}).catch(reason=>report(String(reason)));return()=>{live=false;};},[]);
 useEffect(()=>{let live=true;setData([]);setMetadata({left:[],right:[]});if(id&&left&&right){setLoading(true);Promise.all([request('relation.query',{id}),request('table.read',{sourceId:left.sourceId,offset:0,limit:1}),request('table.read',{sourceId:right.sourceId,offset:0,limit:1})]).then(([result,leftPage,rightPage])=>{if(live){setData(databaseRelationRows(result.matches||[]));setMetadata({left:leftPage.columns,right:rightPage.columns});}}).catch(reason=>report(String(reason))).finally(()=>{if(live)setLoading(false);});}return()=>{live=false;};},[id,left?.sourceId,right?.sourceId]);
 const columns:Column[]=[{field:'status',label:'연결 상태',values:{matched:'연결',missing:'미연결',ambiguous:'여러 매칭 · 검토'}},...[{side:'left',source:left,columns:metadata.left},{side:'right',source:right,columns:metadata.right}].flatMap(({side,source,columns})=>columns.map(column=>({...column,field:side+'.'+column.field,label:(source?.label||side)+' · '+(column.label||column.field),editable:false})))];
 return <div className="db-integrated"><div className="db-search"><select aria-label="통합 관계" value={id} onChange={event=>setId(event.target.value)}><option value="">관계 선택</option>{relations.map(relation=><option key={relation.id} value={relation.id}>{relation.name}</option>)}</select><div role="group" aria-label="통합 보기"><button className={view==='table'?'active':''} onClick={()=>setView('table')}>표</button><button className={view==='diagram'?'active':''} onClick={()=>setView('diagram')}>관계도</button></div><button onClick={onSettings}>관계 설정</button></div>{loading&&<p role="status">관계 조회 중…</p>}{!selected?<p className="db-empty">저장된 관계를 선택하세요. <button onClick={onSettings}>관계 설정</button></p>:view==='table'?<div className="db-grid"><DataGrid rows={data} columns={columns} readOnly/></div>:<div className="db-relation-diagram" aria-label="저장된 관계도"><div><strong>{left?.label||selected.leftSourceId}</strong>{selected.fieldPairs.map((pair,index)=><span key={index}>{metadata.left.find(column=>column.field===pair.left)?.label||pair.left}</span>)}</div><svg viewBox="0 0 160 60" role="img" aria-label={selected.cardinality==='one'?'한 행 연결':'여러 행 연결'}><path d="M0 30H145M135 23L145 30L135 37" fill="none" stroke="currentColor" strokeWidth="2"/><text x="70" y="20" textAnchor="middle">{selected.cardinality==='one'?'1 : 1':'1 : N'}</text></svg><div><strong>{right?.label||selected.rightSourceId}</strong>{selected.fieldPairs.map((pair,index)=><span key={index}>{metadata.right.find(column=>column.field===pair.right)?.label||pair.right}</span>)}</div></div>}</div>;
}

export function DatabasePopup({report,sourceId:initialSourceId,mode}:{report:(text:string)=>void;sourceId?:string;mode?:string}){
 const [sources,setSources]=useState<Source[]>([]),[sourceId,setSourceId]=useState(''),[category,setCategory]=useState<ReturnType<typeof databaseCategory>>('업무'),[tableQuery,setTableQuery]=useState(''),[integrated,setIntegrated]=useState(false);
 const [rows,setRows]=useState<RecordRow[]>([]),[edited,setEdited]=useState<RecordRow[]>([]),[columns,setColumns]=useState<Column[]>([]),[cell,setCell]=useState<{row:RecordRow;field:string}|null>(null),[formula,setFormula]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const [panel,setPanel]=useState<'filter'|'settings'|'relations'|'addTable'|'export'|''>(mode==='relations'?'relations':''),[importing,setImporting]=useState(false),[singleClickEdit,setSingleClickEdit]=useState(false);
 const [filter,setFilter]=useState<Filter>(emptyFilter),[appliedFilter,setAppliedFilter]=useState<Filter>(emptyFilter),[search,setSearch]=useState(''),[appliedSearch,setAppliedSearch]=useState(''),[searchField,setSearchField]=useState(''),[appliedField,setAppliedField]=useState('');
 const [exportAll,setExportAll]=useState(false),[exportLabels,setExportLabels]=useState(true),[headers,setHeaders]=useState<Record<string,string>>({}),[tableName,setTableName]=useState('');
 const original=useRef<DatabaseSnapshot|undefined>(undefined),grid=useRef<GridHandle|null>(null),generation=useRef(0),live=useRef(true);
 const dirty=!!original.current&&(JSON.stringify(edited)!==JSON.stringify(original.current.rows)||JSON.stringify(columns)!==JSON.stringify(original.current.columns));
 const dirtyRef=useRef(dirty);dirtyRef.current=dirty;const busyRef=useRef(busy);busyRef.current=busy;
 const source=sources.find(item=>item.sourceId===sourceId),locked=busy||loading,editable=loaded&&source?.editable!==false&&!integrated;
 const notice=(text:string)=>{if(live.current)report(text);};
 async function refreshSources(){const result=await request('table.list');const list:Source[]=Array.isArray(result)?result:result.sources||[];if(live.current)setSources(list);return list;}
 async function load(id=sourceId,condition=appliedFilter,term=appliedSearch,field=appliedField,list=sources){
  if(!id)return;const current=++generation.current;setLoading(true);setError('');
  try{
   const nextSource=list.find(item=>item.sourceId===id);const searchColumns=id===sourceId?columns:nextSource?.columns||[];
   const result=await readDatabaseTable(id,databaseFilter(condition,term,searchColumns,field),request,()=>live.current&&current===generation.current);
   if(current!==generation.current||!live.current)return;
   original.current=structuredClone(result);setSourceId(id);setRows(result.rows);setEdited(structuredClone(result.rows));setColumns(result.columns);setLoaded(true);setCell(null);setFormula('');setIntegrated(false);if(nextSource)setCategory(databaseCategory(nextSource));
   setAppliedFilter(structuredClone(condition));setAppliedSearch(term);setAppliedField(field);
  }catch(reason){if(current===generation.current&&live.current){const message=String(reason);setError(message);notice(message+' · 현재 편집 내용은 유지됩니다.');}}
  finally{if(current===generation.current&&live.current)setLoading(false);}
 }
 function canDiscard(){return !dirtyRef.current||confirm('저장하지 않은 표 편집이 있습니다. 버리고 이동할까요?');}
 function resetSearch(){setFilter(emptyFilter());setSearch('');setSearchField('');}
 async function choose(id:string){if(locked||id===sourceId&&!integrated||!canDiscard())return;await load(id,emptyFilter(),'','');if(live.current&&original.current?.sourceId===id){resetSearch();setPanel('');}}
 async function chooseCategory(next:typeof category){if(locked||next===category||!canDiscard())return;const list=databaseGroupSources(sources,next);if(list[0])await load(list[0].sourceId,emptyFilter(),'','');else{++generation.current;original.current=undefined;setSourceId('');setRows([]);setEdited([]);setColumns([]);setLoaded(false);setIntegrated(false);setCategory(next);}resetSearch();setPanel('');}
 function chooseIntegrated(){if(locked||integrated||!canDiscard())return;if(original.current){setEdited(structuredClone(original.current.rows));setRows(original.current.rows);setColumns(original.current.columns);}setIntegrated(true);setCell(null);setPanel('');}
 useEffect(()=>{
  live.current=true;
  void(async()=>{try{
   const list=await refreshSources();try{const settings=await request('settings.read',{key:'dictionary.headers'});if(live.current)setHeaders(settings.value||{});}catch(reason){notice('Import 헤더 사전 읽기 실패: '+reason);}
   if(!live.current)return;const first=list.find(source=>source.sourceId===initialSourceId)||databaseGroupSources(list,'업무')[0]||list[0];if(first)await load(first.sourceId,emptyFilter(),'','',list);
  }catch(reason){if(live.current){setError(String(reason));notice('DB 연결 실패: '+reason);}}})();
  const unload=(event:BeforeUnloadEvent)=>{if(dirtyRef.current||busyRef.current){event.preventDefault();event.returnValue='';}};
  const closeCheck=(event:Event)=>{if(dirtyRef.current||busyRef.current)event.preventDefault();};
  window.addEventListener('beforeunload',unload);window.addEventListener('pce:close-check',closeCheck);
  return()=>{live.current=false;++generation.current;window.removeEventListener('beforeunload',unload);window.removeEventListener('pce:close-check',closeCheck);};
 },[]);
 useEffect(()=>{const saved=()=>{if(!locked&&!dirtyRef.current){refreshSources().then(list=>load(sourceId,appliedFilter,appliedSearch,appliedField,list)).catch(reason=>notice(String(reason)));}else notice('사전 변경을 저장했습니다. 현재 표 저장 후 다시 읽으면 표시를 갱신합니다.');};window.addEventListener('pce-settings-saved',saved);return()=>window.removeEventListener('pce-settings-saved',saved);},[sourceId,locked,appliedFilter,appliedSearch,appliedField]);
 const groupSources=useMemo(()=>databaseGroupSources(sources,category),[sources,category]);
 const visibleSources=groupSources.filter(source=>!tableQuery||[source.label,source.sourceId].join(' ').toLowerCase().includes(tableQuery.toLowerCase()));
 const displayColumns=useMemo(()=>databaseVisibleColumns(columns),[columns]);
 const displayRows=useMemo(()=>editable?databaseInputRows(rows,sourceId):rows,[rows,sourceId,editable]);
 async function save(){
  if(locked||!original.current||!dirty)return;setBusy(true);setError('');
  try{
   const base=original.current;const changes=databaseChanges(base.rows,edited,base.columns,columns);
   const committed=await request('grid.commit',{sourceId,tableVersion:base.storeVersion,changes});if(!live.current)return;
   const skipped=Number(committed.skipped)||0;const stored=new Map((committed.rows||[]).map((row:RecordRow)=>[row.__rowId,row]));
   const baseIds=new Set(base.rows.map(row=>row.__rowId));const reconciled=edited.filter(row=>baseIds.has(row.__rowId)).map(row=>(stored.get(row.__rowId) as RecordRow|undefined)||row);
   for(const row of (committed.rows||[]) as RecordRow[])if(!baseIds.has(row.__rowId))reconciled.push(row);
   original.current={sourceId,rows:structuredClone(reconciled),columns:structuredClone(columns),storeVersion:committed.storeVersion??base.storeVersion,rowCount:reconciled.length};setEdited(reconciled);setRows(reconciled);setCell(null);
   notice('변경 저장 완료'+(skipped?' · 중복 정책으로 '+skipped+'행 건너뜀':''));
   try{const list=await refreshSources();await load(sourceId,appliedFilter,appliedSearch,appliedField,list);}catch(reason){notice('저장은 완료했습니다. 다시 읽기 실패: '+reason);}
  }catch(reason){const message='저장 실패 · 편집 내용 유지: '+reason;setError(message);notice(message);}
  finally{if(live.current)setBusy(false);}
 }
 async function reload(){if(locked||!canDiscard())return;try{const list=await refreshSources();await load(sourceId,appliedFilter,appliedSearch,appliedField,list);}catch(reason){notice(String(reason));}}
 async function applySearch(condition=filter,term=search,field=searchField){if(locked||!canDiscard())return;await load(sourceId,condition,term,field);}
 function toggle(next:typeof panel){if(locked)return;if((next==='settings'||next==='relations'||next==='addTable')&&dirtyRef.current){notice('표 편집을 먼저 저장하거나 다시 읽기에서 버린 뒤 설정을 여세요.');return;}setPanel(panel===next?'':next);}
 async function createTable(){if(!tableName.trim()||locked)return;setBusy(true);try{const result=await request('dataset.create',{name:tableName.trim(),columns:[{field:'name',label:'이름',kind:'text',editable:true}],rows:[],duplicatePolicy:{mode:'allow',keys:[]}});const list=await refreshSources();await load(result.sourceId,emptyFilter(),'','',list);resetSearch();setTableName('');setPanel('');}catch(reason){notice('표 생성 실패 · 입력 유지: '+reason);}finally{if(live.current)setBusy(false);}}
 function addColumn(){if(!editable||locked)return;const next=databaseNextColumn(columns);setRows(edited);setColumns(previous=>[...previous,next]);notice('새 열을 추가했습니다. 헤더에서 표시명을 바꾸고 셀에 입력하세요.');}
 function changeGrid(next:RecordRow[],deletedIds:string[]=[]){
  setEdited(previous=>databaseMergeInput(previous,next,deletedIds));
  if(editable&&!locked&&databaseNeedsInputRow(next))grid.current?.add([{__rowId:'draft-'+crypto.randomUUID(),__draft:true}]);
 }
 function transformEdit(value:unknown,row:RecordRow,column:Column){
  if(typeof value!=='string'||!value.trim().startsWith('='))return value;
  if(!['decimal','integer'].includes(column.kind||''))return value;
  const current=grid.current?.rows()||displayRows;const result=databaseFormula(value,current,columns,row);
  if(column.kind==='integer'){if(!/^-?\d+$/.test(result)||!Number.isSafeInteger(Number(result)))throw Error('정수 열에는 안전한 정수 결과만 입력하세요.');return Number(result);}
  return result;
 }
 function applyCell(){
  if(!cell||locked||!editable)return;const column=columns.find(column=>column.field===cell.field);if(!column||column.editable===false)return;
  try{let value:unknown=transformEdit(formula,cell.row,column);if(column.kind==='integer'&&/^[-+]?\d+$/.test(String(value))&&Number.isSafeInteger(Number(value)))value=Number(value);if(column.kind==='boolean'&&['true','false'].includes(String(value)))value=value==='true';if(column.kind==='json'){try{value=JSON.parse(String(value));}catch{}}
   const current=grid.current?.rows()||displayRows;const next=databaseMergeInput(edited,current.map(row=>row.__rowId===cell.row.__rowId?{...row,[cell.field]:value}:row));setEdited(next);setRows(next);setCell({...cell,row:{...cell.row,[cell.field]:value}});setFormula(typeof value==='object'?JSON.stringify(value):String(value??''));setError('');
  }catch(reason){setError(String(reason));notice(String(reason));}
 }
 async function output(format:'xlsx'|'csv'|'json'){if(locked||!sourceId)return;try{const all=exportAll?await readDatabaseTable(sourceId,emptyFilter()):null;const outputRows=all?.rows||databaseMergeInput(edited,grid.current?.rows()||displayRows),outputColumns=all?.columns||displayColumns;if(format==='json')download((source?.label||'자료')+'.json',JSON.stringify({sourceId,rows:outputRows.map(clean)},null,2));else exportSheet(source?.label||'자료',outputRows,outputColumns,format,exportLabels);}catch(reason){notice(String(reason));}}
 return <div className="db-browser" aria-label="DB 브라우저">
  <aside className="db-sidebar"><div className="db-groups" role="group" aria-label="테이블 그룹">{categories.map(group=><button key={group} disabled={locked} className={category===group?'active':''} aria-pressed={category===group} onClick={()=>void chooseCategory(group)}>{group}</button>)}</div><input aria-label="테이블 검색" type="search" placeholder="테이블 검색" value={tableQuery} onChange={event=>setTableQuery(event.target.value)}/><div className="db-table-list">{visibleSources.map(source=><button disabled={locked} className={!integrated&&source.sourceId===sourceId?'active':''} key={source.sourceId} title={source.sourceId} onClick={()=>void choose(source.sourceId)}>{source.label}<small>{source.rowCount??''}</small></button>)}</div><button disabled={locked||dirty} onClick={()=>toggle('addTable')}>+ 테이블 추가</button></aside>
  <main className="db-main">
   <nav className="db-tabs" aria-label="그룹 테이블 탭">{category==='업무'&&<button disabled={locked} className={integrated?'active':''} onClick={chooseIntegrated}>통합</button>}{groupSources.map(source=><button disabled={locked} key={source.sourceId} className={!integrated&&source.sourceId===sourceId?'active':''} onClick={()=>void choose(source.sourceId)}>{source.label}</button>)}</nav>
   {!integrated&&<form className="db-search" onSubmit={event=>{event.preventDefault();void applySearch(appliedFilter);}}><select aria-label="검색 열" value={searchField} onChange={event=>setSearchField(event.target.value)}><option value="">전체 열</option>{columns.filter(column=>!column.field.startsWith('__')).map(column=><option key={column.field} value={column.field}>{column.label||column.field}</option>)}</select><input type="search" aria-label="행 검색" placeholder="전체 표 검색" value={search} onChange={event=>setSearch(event.target.value)}/><button disabled={locked||!sourceId}>검색</button><button type="button" disabled={locked||!sourceId} onClick={()=>{setSearch('');setSearchField('');void applySearch(appliedFilter,'','');}}>해제</button><button type="button" disabled={locked||!sourceId} className={panel==='filter'?'active':''} onClick={()=>toggle('filter')}>필터{appliedFilter.conditions.length?' ●':''}</button><span className="db-spacer"/><button type="button" disabled={locked||!editable} onClick={()=>setImporting(true)}>Import</button><button type="button" disabled={locked||!sourceId} onClick={()=>toggle('export')}>Export</button><button type="button" disabled={locked||!sourceId} onClick={()=>void reload()}>다시 읽기</button><button type="button" disabled={locked||!sourceId} onClick={()=>toggle('settings')}>설정</button><button type="button" className="primary" disabled={locked||!dirty||!editable} onClick={()=>void save()}>저장</button></form>}
   {!integrated&&<form className="db-formula" onSubmit={event=>{event.preventDefault();applyCell();}}><output aria-label="선택 셀">{cell?(displayColumns.findIndex(column=>column.field===cell.field)+1)+'열 · '+(cell.row.__rowId.startsWith('draft-')?'새 행':edited.findIndex(row=>row.__rowId===cell.row.__rowId)+1+'행'):'셀 선택'}</output><label htmlFor="db-cell-input">fx</label><input id="db-cell-input" aria-label="셀 값 또는 수식" placeholder="값 또는 =SUM(A1:A3)" value={formula} disabled={locked||!editable||!cell} onChange={event=>setFormula(event.target.value)}/><button disabled={locked||!editable||!cell}>적용</button></form>}
   {panel&&<div className="db-pane"><div className="db-pane-heading"><button disabled={locked} aria-label="DB 보조 패널 닫기" onClick={()=>setPanel('')}>닫기</button></div>{panel==='export'?<><div className="row">{(['xlsx','csv','json'] as const).map(format=><button disabled={locked||!sourceId} key={format} onClick={()=>void output(format)}>{format.toUpperCase()}</button>)}</div><label><input type="checkbox" checked={exportAll} onChange={event=>setExportAll(event.target.checked)}/>저장된 전체 자료</label><label><input type="checkbox" checked={exportLabels} onChange={event=>setExportLabels(event.target.checked)}/>표시 헤더</label></>:panel==='addTable'?<form className="db-add-form" onSubmit={event=>{event.preventDefault();void createTable();}}><label>새 테이블 이름<input aria-label="새 테이블 이름" value={tableName} onChange={event=>setTableName(event.target.value)}/></label><button disabled={locked||!tableName.trim()}>생성</button></form>:panel==='filter'?<><FilterEditor compact columns={columns} value={filter} onChange={setFilter}/><div className="row"><button disabled={locked} onClick={()=>void applySearch()}>전체 자료에 적용</button><button disabled={locked} onClick={()=>{setFilter(emptyFilter());void applySearch(emptyFilter());}}>필터 해제</button></div></>:panel==='relations'?<RelationPanel sourceId={integrated?undefined:sourceId} sources={sources} report={notice}/>:<><div className="db-setting-actions"><button disabled={dirty} onClick={()=>setPanel('relations')}>관계 설정</button><button onClick={()=>openSurface('sql').catch(reason=>notice(String(reason)))}>SQL 조회</button><button onClick={()=>openSurface('backup').catch(reason=>notice(String(reason)))}>백업·복원</button><button disabled={locked||!editable||!cell} onClick={()=>grid.current?.remove()}>선택 행 삭제</button><button disabled={locked||!editable||!cell} onClick={()=>grid.current?.fillDown()}>아래로 채우기</button><button disabled={!cell||dirty||!original.current?.rows.some(row=>row.__rowId===cell.row.__rowId)} onClick={()=>openSurface('documents',{sourceId,rowId:cell?.row.__rowId}).catch(reason=>notice(String(reason)))}>문서 생성</button><button disabled={!cell||dirty||!original.current?.rows.some(row=>row.__rowId===cell.row.__rowId)} onClick={()=>openSurface('explorer',{sourceId,rowId:cell?.row.__rowId}).catch(reason=>notice(String(reason)))}>업무 폴더</button></div><label><input type="checkbox" checked={singleClickEdit} onChange={event=>{setRows(edited);setSingleClickEdit(event.target.checked);}}/>단일 클릭으로 편집</label><TableSettingsPanel key={sourceId} dirty={dirty} source={source} columns={columns} report={notice} onSaved={async()=>{const list=await refreshSources();await load(sourceId,appliedFilter,appliedSearch,appliedField,list);}}/></>}</div>}
   {error&&<p className="db-error" role="alert">{error}</p>}{loading&&<p className="db-loading" role="status">전체 표를 읽는 중…</p>}
   {integrated?<IntegratedView sources={sources} report={notice} onSettings={()=>toggle('relations')}/>:<div className="db-grid-layout"><div className="db-grid"><DataGrid rows={displayRows} columns={displayColumns} readOnly={locked||!editable} singleClickEdit={singleClickEdit} onChange={changeGrid} onCellSelect={(row,field)=>{setCell({row,field});const value=row[field];setFormula(typeof value==='object'&&value!==null?JSON.stringify(value):String(value??''));}} onAddColumn={editable?addColumn:undefined} editableTitles={columns.filter(column=>!original.current?.columns.some(existing=>existing.field===column.field)).map(column=>column.field)} onColumnTitleChange={(field,title)=>{setRows(edited);setColumns(previous=>previous.map(column=>column.field===field?{...column,label:title||field}:column));}} transformEdit={transformEdit} onEditError={reason=>{setError(String(reason));notice(String(reason));}} handle={value=>{grid.current=value;}}/></div></div>}
   <footer className="db-status"><span>{integrated?'원본 유지 · 관계 조회':edited.length+'행'+(dirty?' · 저장하지 않은 변경':'')}</span><details><summary>사용법</summary><p>클릭 선택 · 입력/F2 편집 · Esc 취소 · Tab 이동 · 범위 복사/붙여넣기 · 저장</p><p>숫자 열: =SUM(A1:A3), AVERAGE, MIN, MAX, COUNT, 사칙연산, [원천 키]. 계산 결과만 저장합니다.</p></details></footer>
  </main>
  {importing&&<ImportDialog columns={columns} headerMap={headers} onClose={()=>setImporting(false)} onApply={async(importRows,importColumns,asNew,name)=>{if(asNew){if(!canDiscard())throw Error('현재 표 편집을 유지했습니다. 먼저 저장한 뒤 가져오세요.');const result=await request('dataset.create',{name,rows:importRows,columns:importColumns,duplicatePolicy:{mode:'allow',keys:[]}});const list=await refreshSources();await load(result.sourceId,emptyFilter(),'','',list);resetSearch();}else{if(!editable)throw Error('이 표는 편집할 수 없습니다. 독립 표로 가져오세요.');const extra=importColumns.filter(column=>!columns.some(existing=>existing.field===column.field));setColumns(previous=>[...previous,...extra]);const next=[...edited,...importRows.map(row=>({...row,__rowId:'new-'+crypto.randomUUID()}))];setRows(next);setEdited(next);notice('가져온 행과 추가 열을 편집 버퍼에 담았습니다. 저장으로 확정하세요.');}}}/>}
 </div>;
}



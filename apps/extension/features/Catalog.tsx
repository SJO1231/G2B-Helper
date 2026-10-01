import {useEffect,useMemo,useRef,useState} from 'react';
import {request} from '../../../plugins/core/gateway';
import {DataGrid,type Column,type GridHandle,type RecordRow} from '../../ui/Grid';
import {mergeGridEdits} from '../../ui/editBuffer';
import {SettingsPanel} from '../../ui/features/SettingsPanel';
import {useUnsavedChanges} from '../../bookmarklet/lifecycle';

export type DictionaryKey='dictionary.keys'|'dictionary.codes'|'dictionary.headers'|'dictionary.hidden';
type CatalogKey=DictionaryKey|'collector.rules'|'screen.bindings'|'json.presentations'|'notes'|'launchers'|'relations';
const tabs:{key:CatalogKey;label:string}[]=[{key:'dictionary.keys',label:'키 사전'},{key:'dictionary.codes',label:'값 사전'},{key:'dictionary.headers',label:'Import 헤더'},{key:'dictionary.hidden',label:'숨김키'},{key:'collector.rules',label:'수집 표·규칙'},{key:'screen.bindings',label:'화면 설정'},{key:'json.presentations',label:'JSON 표시'},{key:'notes',label:'메모·일정 연결'},{key:'launchers',label:'직링크·런처'},{key:'relations',label:'관계'}];
const dictionaryKeys=new Set<string>(['dictionary.keys','dictionary.codes','dictionary.headers','dictionary.hidden']);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function assert(condition:unknown,message:string):asserts condition{if(!condition)throw Error(message);}
const dictionaryColumns=(key:DictionaryKey):Column[]=>key==='dictionary.hidden'?[{field:'key',label:'숨길 원천 키',kind:'text'}]:[...(key==='dictionary.codes'?[{field:'field',label:'원천 열',kind:'text'}]:[]),{field:'key',label:key==='dictionary.codes'?'원래 코드':key==='dictionary.headers'?'Import 헤더':'원천 키',kind:'text'},{field:'value',label:key==='dictionary.headers'?'대상 원천 키':'표시 이름',kind:'text'}];

export function dictionaryToRows(key:DictionaryKey,value:unknown):RecordRow[]{
 const source=value??(key==='dictionary.hidden'?[]:{});
 let rows:Record<string,string>[];
 if(key==='dictionary.hidden'){
  assert(Array.isArray(source)&&source.every(value=>typeof value==='string'),'숨김키는 문자열 배열이어야 합니다. 상세 설정에서 원본 형식을 확인하세요.');
  rows=source.map(value=>({key:value}));
 }else{
  assert(object(source),'사전 원본이 객체 형식이 아닙니다. 상세 설정에서 확인하세요.');
  if(key==='dictionary.codes')rows=Object.entries(source).flatMap(([field,codes])=>{
   assert(object(codes)&&Object.values(codes).every(label=>typeof label==='string'),'값 사전은 원천 열별 코드·표시명 객체여야 합니다.');
   return Object.entries(codes).map(([code,label])=>({field,key:code,value:label as string}));
  });else{
   assert(Object.values(source).every(label=>typeof label==='string'),'사전의 표시값은 문자열이어야 합니다. 원본 값을 임의 변환하지 않았습니다.');
   rows=Object.entries(source).map(([field,label])=>({key:field,value:label as string}));
  }
 }
 return rows.map((row,index)=>({...row,__rowId:'catalog-'+index}));
}
export function rowsToDictionary(key:DictionaryKey,rows:RecordRow[],original:unknown):unknown{
 // Check the original before applying an editor projection, including hidden-key arrays.
 dictionaryToRows(key,original);
 const result:Record<string,unknown>=Object.create(null),seen=new Set<string>();
 if(key==='dictionary.codes'&&object(original))for(const [field,codes] of Object.entries(original))if(object(codes)&&!Object.keys(codes).length)result[field]=Object.create(null);
 for(const row of rows){
  assert(typeof row.key==='string'&&row.key.trim(),'원천 키·코드를 입력하세요.');
  if(key==='dictionary.hidden')continue;
  assert(typeof row.value==='string','표시값은 텍스트로 입력하세요.');
  if(key==='dictionary.codes')assert(typeof row.field==='string'&&row.field.trim(),'값 사전의 원천 열을 입력하세요.');
  const identity=key==='dictionary.codes'?JSON.stringify([row.field,row.key]):row.key;
  assert(!seen.has(identity),'같은 원천 키·코드가 반복됩니다. 병합할 행을 확인하세요.');seen.add(identity);
  if(key==='dictionary.codes'){
   if(!Object.hasOwn(result,row.field))result[row.field]=Object.create(null);
   (result[row.field] as Record<string,string>)[row.key]=row.value;
  }else result[row.key]=row.value;
 }
 // Preserve ordering and repeated entries in a pre-existing hidden-key array.
 return key==='dictionary.hidden'?rows.map(row=>row.key):result;
}
function settingsRows(value:unknown):RecordRow[]{
 if(Array.isArray(value))return value.map((entry,index)=>({__rowId:'setting-'+index,index:index+1,...(object(entry)?entry:{value:entry})}));
 if(object(value))return Object.entries(value).map(([key,value],index)=>({__rowId:'setting-'+index,key,value}));
 return value==null?[]:[{__rowId:'setting-0',value}];
}
function readColumns(rows:RecordRow[]):Column[]{
 const fields=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(field=>!field.startsWith('__'));
 const labels:Record<string,string>={sourceId:'소유 표',sourceLabel:'구분',sourceName:'표 이름',title:'제목',body:'내용',screenKey:'연결 화면',rowId:'연결 레코드',name:'이름',kind:'종류',target:'직링크·실행 대상',leftSourceId:'왼쪽 표',rightSourceId:'오른쪽 표',fieldPairs:'연결 열',cardinality:'연결 개수',dataset:'원본 Dataset',identityFields:'업무키',screenFilter:'화면 조건',urlFilter:'URL 조건',enabled:'사용',storeVersion:'저장 버전'};
 return fields.map(field=>({field,label:labels[field]||field,kind:rows.some(row=>row[field]!==null&&typeof row[field]==='object')?'json':'text',editable:false}));
}

export function CatalogPopup({report,sources}:{report:(message:string)=>void;sources:any[]}){
 const [tab,setTab]=useState<CatalogKey>('dictionary.keys'),[rows,setRows]=useState<RecordRow[]>([]),[baseline,setBaseline]=useState<RecordRow[]>([]),[columns,setColumns]=useState<Column[]>([]);
 const [version,setVersion]=useState<number>(),[original,setOriginal]=useState<unknown>(),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[detail,setDetail]=useState<string>(),[summary,setSummary]=useState('');
 const generation=useRef(0),grid=useRef<GridHandle|null>(null),currentRows=useRef(rows),saving=useRef(false);currentRows.current=rows;
 const editable=dictionaryKeys.has(tab),dirty=JSON.stringify(rows)!==JSON.stringify(baseline);
 useUnsavedChanges(dirty);
 const visibleRows=useMemo(()=>{const needle=search.trim().toLocaleLowerCase();return needle?rows.filter(row=>Object.entries(row).some(([field,value])=>!field.startsWith('__')&&(typeof value==='object'?JSON.stringify(value):String(value??'')).toLocaleLowerCase().includes(needle))):rows;},[rows,search]);
 async function readAll(sourceId:string){let offset=0;const output:RecordRow[]=[];for(;;){const page=await request('table.read',{sourceId,offset,limit:1000});output.push(...page.rows);offset+=page.rows.length;if(!page.hasMore)return output;if(!page.rows.length)throw Error('다음 페이지를 읽지 못했습니다. 다시 읽으세요.');}}
 async function load(key:CatalogKey){
  const current=++generation.current;setLoading(true);setError('');setSummary('');setVersion(undefined);
  try{
   let next:RecordRow[],nextColumns:Column[],value:unknown,storeVersion:number|undefined;
   if(dictionaryKeys.has(key)){
    const setting=await request('settings.read',{key});value=setting.value;storeVersion=setting.storeVersion;next=dictionaryToRows(key as DictionaryKey,value);nextColumns=dictionaryColumns(key as DictionaryKey);
   }else if(key==='notes'){
    const [memos,schedules]=await Promise.all([readAll('memos'),readAll('schedules')]);
    next=[...memos.map(row=>({...row,sourceLabel:'메모',__rowId:'memos:'+row.__rowId})),...schedules.map(row=>({...row,sourceLabel:'일정',__rowId:'schedules:'+row.__rowId}))];nextColumns=readColumns(next);
   }else if(key==='launchers'){next=await readAll('launchers');nextColumns=readColumns(next);}
   else if(key==='relations'){next=(await request<any[]>('relation.list')).map(relation=>({...relation,__rowId:relation.id}));nextColumns=readColumns(next);}
   else{
    const setting=await request('settings.read',{key});value=setting.value;storeVersion=setting.storeVersion;
    if(key==='collector.rules'){
     const rules=value===null?[]:Array.isArray(value)?value:object(value)&&Array.isArray(value.rules)?value.rules:null;
     assert(rules,'수집 규칙의 저장 형식을 확인하세요.');next=settingsRows(rules).map(row=>({...row,sourceName:sources.find(source=>source.sourceId===row.sourceId)?.label||row.sourceId}));
     if(current===generation.current)setSummary(value===null||object(value)&&value.includeDefaults===true?'기본 접수·공고·계약 규칙과 사용자 규칙을 사용합니다.':'사용자 규칙만 사용합니다.');
    }else next=settingsRows(value);
    nextColumns=readColumns(next);
   }
   if(current!==generation.current)return;
   setRows(next);setBaseline(structuredClone(next));setColumns(nextColumns);setOriginal(value);setVersion(storeVersion);
  }catch(reason){if(current===generation.current){setRows([]);setBaseline([]);setColumns([]);const message=String(reason);setError(message);report(message);}}
  finally{if(current===generation.current)setLoading(false);}
 }
 useEffect(()=>{void load(tab);return()=>{++generation.current;};},[tab]);
 useEffect(()=>{if(detail)window.dispatchEvent(new CustomEvent('pce-open-settings',{detail:{key:detail}}));},[detail]);
 function canLeave(){return !dirty||confirm('저장하지 않은 사전 변경을 버릴까요?');}
 async function save(){
  if(!editable||busy||saving.current||loading||version===undefined)return;
  saving.current=true;
  try{
   // Let an active cell editor finish its blur before reading the complete buffer.
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   const snapshot=structuredClone(currentRows.current),value=rowsToDictionary(tab as DictionaryKey,snapshot,original);
   setBusy(true);setError('');const saved=await request('settings.save',{key:tab,value,storeVersion:version});
   setVersion(saved.storeVersion);setOriginal(saved.value);setRows(snapshot);setBaseline(structuredClone(snapshot));report('사전을 저장했습니다.');
   window.dispatchEvent(new CustomEvent('pce-settings-saved',{detail:{key:tab}}));
  }catch(reason){const message=String(reason);setError(message);report('저장 실패 · 편집 유지: '+message);}finally{saving.current=false;setBusy(false);}
 }
 if(detail)return <section className="catalog-pane"><div className="row"><button onClick={()=>{setDetail(undefined);void load(tab);}}>목록으로</button><strong>상세 설정</strong></div><SettingsPanel sources={sources} report={report}/></section>;
 return <section className="catalog-pane" aria-label="사전 및 연결 관리">
  <nav className="tabbar" aria-label="관리 항목">{tabs.map(item=><button key={item.key} className={tab===item.key?'active':''} aria-pressed={tab===item.key} disabled={busy} onClick={()=>{if(item.key!==tab&&canLeave()){setRows([]);setBaseline([]);setSearch('');setTab(item.key);}}}>{item.label}</button>)}</nav>
  <div className="row"><label>목록 검색<input type="search" aria-label="사전 목록 검색" value={search} onChange={event=>setSearch(event.target.value)} placeholder="원천 키·표시명·연결 정보"/></label><button disabled={busy||loading} onClick={()=>{if(canLeave())void load(tab);}}>다시 읽기</button>
   {editable&&<><button disabled={busy||loading||version===undefined} onClick={()=>{setSearch('');setRows(previous=>[{__rowId:'new-'+crypto.randomUUID(),key:'',value:'',...(tab==='dictionary.codes'?{field:''}:{})},...previous]);}}>+ 행</button><button disabled={busy||loading||version===undefined} onClick={()=>grid.current?.remove()}>선택 행 삭제</button><button className="primary" disabled={!dirty||busy||loading||version===undefined} onClick={()=>void save()}>저장</button></>}
   {!['notes','launchers','relations'].includes(tab)&&<button disabled={busy||loading} onClick={()=>{if(canLeave()){setRows(structuredClone(baseline));setDetail(tab);}}}>상세 설정</button>}
  </div>
  <div className="gridviewport" style={{height:'min(62vh,620px)',minHeight:240}} aria-busy={loading||busy}><DataGrid rows={visibleRows} columns={columns} readOnly={!editable||busy||loading} onChange={(next,deletedIds)=>{setRows(previous=>{const merged=mergeGridEdits(previous,next,deletedIds);currentRows.current=merged;return merged;});}} handle={value=>{grid.current=value;}}/></div>
  <div className="row"><span>{visibleRows.length} / {rows.length}행</span><span>{loading?'읽는 중…':busy?'저장 중…':dirty?'저장하지 않은 변경':editable?'셀 편집 · 범위 복사/붙여넣기':'읽기 전용 · 범위 복사 가능'}</span>{summary&&<span className="muted">{summary}</span>}</div>
  {error&&<p className="error" role="alert">{error}{dirty?' · 편집 내용은 유지됩니다.':''}</p>}
  {!editable&&<details><summary>목록 안내</summary><p className="muted">{tab==='notes'?'메모·일정 팝업에서 내용과 연결 화면을 수정하세요.':tab==='launchers'?'런처의 각 버튼 설정에서 실행 대상을 수정하세요.':tab==='relations'?'관계 팝업에서 연결 규칙을 검토하고 저장하세요.':'복합 설정은 상세 설정에서 수정합니다. 목록에서 원본 객체를 임의로 펼쳐 저장하지 않습니다.'}</p></details>}
 </section>;
}

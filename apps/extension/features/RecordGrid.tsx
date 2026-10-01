import {useEffect,useMemo,useState} from 'react';
import {request} from '../../../plugins/core/gateway';
import {DataGrid} from '../../ui/Grid';
import type {PrototypeSelection} from '../../bookmarklet/contracts';
const identityFields:Record<string,string[]>={'procurement.receipt':['ctrtDmndRcptNo','ctrtDmndRcptOrd'],'procurement.bid':['bidPbancNo','bidPbancOrd'],'procurement.contract':['ctrtNo','ctrtChgOrd']};
export function selectionFrom(source:any,row:any):PrototypeSelection{return {datasetId:source.sourceId,datasetName:source.label,rowId:row.__rowId,values:row};}
/** Use exact full identities; an ambiguous screen never silently chooses a record. */
export async function contextSelection(context:any,sourceId?:string,rowId?:string):Promise<PrototypeSelection|null>{
 const sources=await request('table.list');
 if(sourceId&&rowId){const source=sources.find((s:any)=>s.sourceId===sourceId);const page=await request('query.execute',{sql:"SELECT content FROM pce_records WHERE source_id = '"+sourceId.replaceAll("'","''")+"' AND row_id = '"+rowId.replaceAll("'","''")+"' LIMIT 1"});return source&&page.rows[0]?selectionFrom(source,{...JSON.parse(page.rows[0].content),__rowId:rowId}):null;}
 if(context?.requiresScreenSelection)return null;
 const point=context?.pointInfo||{},matches:PrototypeSelection[]=[];
 for(const [sourceId,keys] of Object.entries(identityFields)){
  if(!keys.every(key=>point[key]!==undefined&&point[key]!==null&&String(point[key])!==''))continue;
  const page=await request('table.read',{sourceId,limit:2,filter:{join:'and',conditions:keys.map(field=>({field,operator:'equals',values:[String(point[field])]}))}});
  if(page.rows.length===1&&!page.hasMore)matches.push(selectionFrom(sources.find((s:any)=>s.sourceId===sourceId),page.rows[0]));
 }
 return matches.length===1?matches[0]:null;
}
export function RecordGrid({onSelect,report}:{onSelect:(selection:PrototypeSelection|null)=>void;report:(text:string)=>void}){
 const [sources,setSources]=useState<any[]>([]),[source,setSource]=useState('integrated'),[records,setRecords]=useState<any[]>([]),[columns,setColumns]=useState<any[]>([]),[term,setTerm]=useState('');
 useEffect(()=>{request('table.list').then(setSources).catch(error=>report(String(error)));},[]);
 useEffect(()=>{let live=true;if(!sources.length)return;(async()=>{const selected=source==='integrated'?sources.filter(s=>Object.hasOwn(identityFields,s.sourceId)):sources.filter(s=>s.sourceId===source);const rows:any[]=[],fields=new Map<string,any>();if(source==='integrated')fields.set('__virtualSource',{field:'__virtualSource',label:'업무',editable:false});for(const s of selected){let offset=0,version:number|undefined;while(true){const page=await request('table.read',{sourceId:s.sourceId,offset,limit:1000});if(version!==undefined&&version!==page.storeVersion)throw Error('조회 중 표가 변경되었습니다. 다시 선택하세요.');version=page.storeVersion;for(const column of page.columns)if(!fields.has(column.field))fields.set(column.field,column);rows.push(...page.rows.map((row:any)=>({...row,__sourceId:s.sourceId,__virtualSource:s.label})));offset+=page.rows.length;if(!page.hasMore)break;if(!page.rows.length)throw Error('다음 페이지를 읽지 못했습니다.');}}if(live){setColumns([...fields.values()]);setRecords(rows);}})().catch(error=>report(String(error)));return()=>{live=false;};},[source,sources]);
 const rows=useMemo(()=>records.filter(row=>!term||JSON.stringify(row).toLocaleLowerCase().includes(term.toLocaleLowerCase())),[records,term]);
 return <aside className="record-grid"><div className="row"><select aria-label="문서 자료 표" value={source} onChange={event=>setSource(event.target.value)}><option value="integrated">통합</option>{sources.map(s=><option key={s.sourceId} value={s.sourceId}>{s.label}</option>)}</select><input aria-label="문서 자료 검색" type="search" value={term} onChange={event=>setTerm(event.target.value)}/></div><div style={{height:360}}><DataGrid readOnly rows={rows} columns={columns} onSelect={row=>onSelect(selectionFrom(sources.find(s=>s.sourceId===row.__sourceId),row))}/></div></aside>;
}

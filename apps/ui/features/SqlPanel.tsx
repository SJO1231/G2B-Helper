import {useEffect,useState} from 'react';
import {request} from '../../../plugins/core/gateway';
import {DataGrid,type RecordRow} from '../Grid';
import {FilterEditor,emptyFilter} from '../Filter';
import {download} from '../ImportExport';
const arr=(v:any)=>Array.isArray(v)?v:v?.relations||v?.captures||v?.rows||[];
export function SqlPanel({report}:{report:(s:string)=>void}){const [sql,setSql]=useState('SELECT * FROM pce_records LIMIT 100'),[result,setResult]=useState<any>(null);return <section className="panel"><h2>읽기 전용 SQL</h2><p className="muted">등록된 조회 뷰를 사용하세요. 쓰기·DDL·ATTACH·다중 문장은 거절됩니다.</p><textarea className="code" value={sql} onChange={e=>setSql(e.target.value)}/><button onClick={async()=>{try{setResult(await request('query.execute',{sql}));}catch(e){report(String(e));}}}>조회 실행</button>{result&&<><p>{result.truncated?'결과 상한으로 일부만 표시':''}</p><div className="result-grid"><DataGrid rows={result.rows||[]} columns={(result.columns||Object.keys(result.rows?.[0]||{})).map((c:any)=>typeof c==='string'?{field:c}:c)} readOnly/></div></>}</section>;}

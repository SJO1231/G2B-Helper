import type { HwpxInsertion, HwpxResourceCatalog } from '../../plugins/hwpx/index';
import { getPath } from '../../plugins/core/index';
import { templatePathToken } from '../../plugins/template/index';

function arrayPaths(values:Record<string,unknown>):string[][] {
  const result:string[][]=[];
  const visit=(value:unknown,path:string[])=>{if(result.length>=100||path.length>8)return;if(Array.isArray(value)){result.push(path);return;}if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))visit(child,[...path,key]);};
  for(const [key,value]of Object.entries(values))visit(value,[key]);return result;
}
export function HwpxInsertionEditor({insertion,onChange,values,resources}:{insertion?:HwpxInsertion;onChange:(insertion:HwpxInsertion|undefined)=>void;values:Record<string,unknown>;resources?:HwpxResourceCatalog}){
  const paths=arrayPaths(values);
  return <div className="hwpx-insertion"><label>앵커 동작<select aria-label="HWPX 앵커 동작" value={insertion?.kind??'replace'} onChange={event=>onChange(event.target.value==='replace'?undefined:event.target.value==='paragraphs-after'?{kind:'paragraphs-after'}:{kind:'table-after',rowsPath:paths[0]??[],columns:[{heading:'값',expression:'{{row}}'}],widthMm:160,rowHeightMm:8,borderFillId:resources?.borderFill[0]??'',includeHeader:true})}>
    <option value="replace">선택한 내용 치환</option><option value="paragraphs-after">선택 문단 뒤에 새 문단 추가</option><option value="table-after">선택 문단 뒤에 배열 표 추가</option></select></label>
    {insertion&&<p className="muted">본문 최상위 문단 뒤에 추가합니다. 새 문단과 셀은 선택 문단의 문단·스타일과 첫 글자 서식을 사용합니다. 원본 파일에는 추가하지 않습니다.</p>}
    {insertion?.kind==='paragraphs-after'&&<p className="muted">출력식의 줄바꿈마다 새 문단을 만듭니다. 조건 결과가 빈 문자열이면 추가하지 않습니다.</p>}
    {insertion?.kind==='table-after'&&<>
      <label>반복할 JSON 배열<select aria-label="HWPX 표 배열" value={JSON.stringify(insertion.rowsPath)} onChange={event=>{const rowsPath=JSON.parse(event.target.value) as string[],rows=getPath(values,rowsPath) as unknown[],sample=rows[0],keys=sample&&typeof sample==='object'&&!Array.isArray(sample)?Object.keys(sample).filter(key=>!key.startsWith('__')).slice(0,30):[];onChange({...insertion,rowsPath,columns:keys.length?keys.map(key=>({heading:key,expression:!/^[\p{L}\p{N}_]+$/u.test(key)?templatePathToken(['row',key]):'{{row.'+key+'}}'})):[{heading:'값',expression:'{{row}}'}]});}}><option value={JSON.stringify(insertion.rowsPath)}>{insertion.rowsPath.join(' → ')||'배열 선택'}</option>{paths.filter(path=>JSON.stringify(path)!==JSON.stringify(insertion.rowsPath)).map(path=><option key={JSON.stringify(path)} value={JSON.stringify(path)}>{path.join(' → ')}</option>)}</select></label>
      <p className="muted">각 행은 {'{{row.열이름}}'}, 현재 DB 레코드는 {'{{열이름}}'}으로 참조합니다. 행 계산은 {'{=[row.단가]*[row.수량]}'}처럼 입력합니다. 빈 배열은 표를 추가하지 않습니다.</p>
      {insertion.columns.map((column,index)=><div className="row" key={index}><input aria-label={'HWPX 표 '+(index+1)+'열 제목'} value={column.heading} onChange={event=>onChange({...insertion,columns:insertion.columns.map((existing,position)=>position===index?{...existing,heading:event.target.value}:existing)})}/><input aria-label={'HWPX 표 '+(index+1)+'열 출력'} value={column.expression} onChange={event=>onChange({...insertion,columns:insertion.columns.map((existing,position)=>position===index?{...existing,expression:event.target.value}:existing)})}/><button disabled={insertion.columns.length===1} onClick={()=>onChange({...insertion,columns:insertion.columns.filter((_,position)=>position!==index)})} aria-label={'HWPX 표 '+(index+1)+'열 삭제'}>×</button></div>)}
      <button disabled={insertion.columns.length>=30} onClick={()=>onChange({...insertion,columns:[...insertion.columns,{heading:'새 열',expression:''}]})}>표 출력 열 추가</button>
      <label><input type="checkbox" checked={insertion.includeHeader} onChange={event=>onChange({...insertion,includeHeader:event.target.checked})}/>열 제목 행 포함</label>
      <div className="row"><label>너비(mm)<input type="number" min="10" max="500" aria-label="HWPX 표 너비" value={insertion.widthMm} onChange={event=>onChange({...insertion,widthMm:Number(event.target.value)})}/></label><label>행 높이(mm)<input type="number" min="1" max="100" aria-label="HWPX 표 행 높이" value={insertion.rowHeightMm} onChange={event=>onChange({...insertion,rowHeightMm:Number(event.target.value)})}/></label></div>
      <label>원본 테두리 자원<select aria-label="HWPX 표 테두리" value={insertion.borderFillId} onChange={event=>onChange({...insertion,borderFillId:event.target.value})}><option value="">테두리 선택</option>{resources?.borderFill.map(id=><option key={id} value={id}>borderFill {id}</option>)}</select></label>
    </>}
  </div>;
}

import * as XLSX from 'xlsx';

export type AggregationCell=string|number|boolean|null;
export interface AggregationSheet {name:string;sheetName:string;matrix:AggregationCell[][];headerCandidates:number[];}
export interface AggregationSelection {sheet:AggregationSheet;headerRow:number;headers:string[];}
export interface AggregationColumn {field:string;label:string;kind:string;}
export interface AggregationResult {columns:AggregationColumn[];rows:Record<string,unknown>[];files:{name:string;rows:number;ignoredHeaders:string[]}[];}
const occupied=(value:unknown)=>value!==null&&value!==undefined&&value!=='';
export function headerCandidates(matrix:AggregationCell[][]):number[]{
 const choices=matrix.map((row,index)=>({row,index})).filter(({row})=>row.some(occupied)).slice(0,30);
 const likely=choices.filter(({row})=>row.filter(occupied).length>1&&row.filter(occupied).every(value=>typeof value==='string'));
 return [...new Set([...likely.map(({index})=>index),...choices.map(({index})=>index)])];
}
/** First worksheet only. Text is never cast to numbers; formatted zero codes remain text. */
export function parseAggregationFile(bytes:ArrayBuffer,name:string):AggregationSheet{
 if(!/\.(xlsx|xls|csv|tsv)$/i.test(name))throw Error(name+': XLSX·XLS·CSV·TSV 파일만 지원합니다.');
 const csv=/\.(csv|tsv)$/i.test(name);
 const book=csv?XLSX.read(new TextDecoder().decode(bytes),{type:'string',raw:true}):XLSX.read(bytes,{type:'array',cellDates:false});
 const sheetName=book.SheetNames[0];if(!sheetName)throw Error(name+': 첫 시트가 없습니다.');
 const sheet=book.Sheets[sheetName];if(!sheet['!ref'])throw Error(name+': 첫 시트가 비어 있습니다.');
 const range=XLSX.utils.decode_range(sheet['!ref']);
 if(range.e.r>200000||range.e.c>2000||(range.e.r+1)*(range.e.c+1)>3000000)throw Error(name+': 첫 시트가 너무 큽니다. 사용할 영역을 줄인 파일로 다시 시도하세요.');
 const matrix:AggregationCell[][]=[];
 for(let row=0;row<=range.e.r;row++){
  const values:AggregationCell[]=[];
  for(let col=0;col<=range.e.c;col++){
   const cell=sheet[XLSX.utils.encode_cell({r:row,c:col})];let value:AggregationCell=null;
   if(cell){if(cell.t==='e')throw Error(name+': '+XLSX.utils.encode_cell({r:row,c:col})+' 오류 셀을 먼저 수정하세요.');
    const original=cell.v;
    if(original!==undefined&&original!==null){
     value=typeof original==='boolean'||typeof original==='number'?original:String(original);
     if(typeof original==='number'&&typeof cell.w==='string'&&/^0\d+$/.test(cell.w))value=cell.w;
    }else if(cell.f)throw Error(name+': 계산 결과가 없는 수식입니다. Excel에서 계산·저장 후 다시 가져오세요.');
   }values.push(value);
  }matrix.push(values);
 }
 const candidates=headerCandidates(matrix);if(!candidates.length)throw Error(name+': 읽을 값이 없습니다.');
 return {name,sheetName,matrix,headerCandidates:candidates};
}
export function selectAggregationHeader(sheet:AggregationSheet,headerRow:number):AggregationSelection{
 if(!Number.isInteger(headerRow)||headerRow<0||headerRow>=sheet.matrix.length)throw Error('헤더 행 범위를 확인하세요.');
 return {sheet,headerRow,headers:sheet.matrix[headerRow].map(value=>value==null?'':String(value).trim())};
}
const canonical=(value:string,aliases:Record<string,string>)=>Object.hasOwn(aliases,value)?String(aliases[value]).trim():value.trim();
export function combineAggregation(existing:Pick<AggregationResult,'columns'|'rows'>,selections:AggregationSelection[],aliases:Record<string,string>={}):AggregationResult{
 if(!selections.length)throw Error('확인할 파일을 선택하세요.');
 let columns=existing.columns.map(column=>({...column}));const additions:Record<string,unknown>[]=[],files:AggregationResult['files']=[];
 for(const selection of selections){
  const {sheet,headerRow}=selection;
  if(!Number.isInteger(headerRow)||headerRow<0||headerRow>=sheet.matrix.length)throw Error(sheet.name+': 헤더 행을 확인하세요.');
  const headers=selection.headers.map(label=>canonical(label,aliases));const meaningful=headers.filter(Boolean);
  if(!meaningful.length)throw Error(sheet.name+': 사용할 헤더를 입력하세요.');
  if(new Set(meaningful).size!==meaningful.length)throw Error(sheet.name+': 같은 헤더가 반복됩니다. 헤더명이나 사전 대응을 수정하세요.');
  if(!columns.length)columns=meaningful.map((label,index)=>({field:'column_'+(index+1),label,kind:'text'}));
  const matches=headers.map((label,index)=>({index,column:columns.find(column=>column.label===label)})).filter(pair=>pair.column);
  if(!matches.length)throw Error(sheet.name+': 기준 헤더와 일치하는 열이 없습니다. 헤더를 수정하거나 파일을 제외하세요.');
  let count=0;
  for(const line of sheet.matrix.slice(headerRow+1)){
   if(!line.some(occupied))continue;
   // Never turn an unrelated-only row into a new empty record.
   if(!matches.some(({index})=>occupied(line[index])))continue;
   const row:Record<string,unknown>={};for(const column of columns)row[column.field]=null;
   for(const {index,column} of matches)row[column!.field]=line[index]??null;
   additions.push(row);count++;
  }
  files.push({name:sheet.name,rows:count,ignoredHeaders:headers.filter(header=>header&&!columns.some(column=>column.label===header))});
 }
 const rows=[...existing.rows.map(row=>({...row})),...additions];
 columns=columns.map(column=>{
  const kinds=new Set(rows.map(row=>row[column.field]).filter(occupied).map(value=>typeof value==='number'?(Number.isInteger(value)?'integer':'decimal'):typeof value==='boolean'?'boolean':'text'));
  return {...column,kind:kinds.size===1?[...kinds][0]:kinds.size===2&&kinds.has('integer')&&kinds.has('decimal')?'decimal':kinds.size>1?'json':'text'};
 });
 return {columns,rows,files};
}

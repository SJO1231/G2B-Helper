import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {combineAggregation,headerCandidates,parseAggregationFile,selectAggregationHeader,type AggregationSheet} from '../plugins/files/aggregation';
const sheet=(name:string,matrix:AggregationSheet['matrix']):AggregationSheet=>({name,sheetName:'첫 시트',matrix,headerCandidates:headerCandidates(matrix)});
const empty={columns:[],rows:[]};
describe('first-header file aggregation',()=>{
 it('skips leading blank/title rows and preserves typed XLSX values and formatted zero codes',()=>{
  const book=XLSX.utils.book_new();const source=XLSX.utils.aoa_to_sheet([[],['보고서'],['코드','수량','사용','단가'],['0001',0,false,35608652.5],[1,1,true,2]]);source.A5.z='0000';XLSX.utils.book_append_sheet(book,source,'첫 시트');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['제외'],['둘째 시트']]),'둘째');
  const parsed=parseAggregationFile(XLSX.write(book,{type:'array',bookType:'xlsx'}),'자료.xlsx');expect(parsed.headerCandidates[0]).toBe(2);expect(parsed.matrix[3]).toEqual(['0001',0,false,35608652.5]);expect(parsed.matrix[4][0]).toBe('0001');expect(parsed.sheetName).toBe('첫 시트');
  const combined=combineAggregation(empty,[selectAggregationHeader(parsed,2)]);expect(combined.rows[0]).toEqual({column_1:'0001',column_2:0,column_3:false,column_4:35608652.5});
 });
 it('CSV leaves textual leading zeros, literal zero and false intact',()=>{
  const bytes=new TextEncoder().encode('코드,수량,사용\r\n0001,0,false\r\n');const parsed=parseAggregationFile(bytes.buffer,'자료.csv');expect(parsed.matrix[1]).toEqual(['0001','0','false']);
 });
 it('matches reordered headers, omits unrelated columns, retains duplicate and empty-containing rows',()=>{
  const first=selectAggregationHeader(sheet('a',[['번호','수량'],['001',0],['001',0]]),0),second=selectAggregationHeader(sheet('b',[['비고','수량','번호'],['new',false,'002'],['only',null,null]]),0);
  const result=combineAggregation(empty,[first,second]);expect(result.rows).toEqual([{column_1:'001',column_2:0},{column_1:'001',column_2:0},{column_1:'002',column_2:false}]);expect(result.files[1].ignoredHeaders).toEqual(['비고']);
 });
 it('validates every file before returning and never mutates existing records on failure',()=>{
  const accepted=combineAggregation(empty,[selectAggregationHeader(sheet('a',[['번호'],['001']]),0)]),before=structuredClone(accepted);
  const good=selectAggregationHeader(sheet('b',[['번호'],['002']]),0),bad=selectAggregationHeader(sheet('c',[['없는 열'],['bad']]),0);
  expect(()=>combineAggregation(accepted,[good,bad])).toThrow('일치하는 열');expect(accepted).toEqual(before);
 });
 it('applies header aliases, refuses ambiguous aliases, and supports explicit header correction',()=>{
  const selected=selectAggregationHeader(sheet('a',[['원문','수량'],['001',0]]),0);selected.headers=['번호','수량'];
  const first=combineAggregation(empty,[selected],{});const second=selectAggregationHeader(sheet('b',[['ID','수량'],['002',0]]),0);
  expect(combineAggregation(first,[second],{ID:'번호'}).rows[1]).toEqual({column_1:'002',column_2:0});expect(()=>combineAggregation(empty,[selected],{'번호':'동일','수량':'동일'})).toThrow('같은 헤더');
 });
 it('uses safe generated fields for special header names without changing their labels',()=>{
  const result=combineAggregation(empty,[selectAggregationHeader(sheet('a',[['__proto__','__rowId','a.b'],['001',false,0]]),0)]);expect(result.columns.map(column=>column.label)).toEqual(['__proto__','__rowId','a.b']);expect(result.rows).toEqual([{column_1:'001',column_2:false,column_3:0}]);
 });
 it('refuses workbook error cells or uncached formula values rather than silently producing blank rows',()=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,{'!ref':'A1:A2',A1:{t:'s',v:'열'},A2:{t:'e',v:7}},'시트');expect(()=>parseAggregationFile(XLSX.write(book,{type:'array',bookType:'xlsx'}),'error.xlsx')).toThrow('오류 셀');
 });
});

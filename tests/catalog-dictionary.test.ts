import {describe,it,expect,vi} from 'vitest';
vi.mock('../apps/ui/Grid',()=>({DataGrid:()=>null}));
vi.mock('../apps/ui/features/SettingsPanel',()=>({SettingsPanel:()=>null}));
import {dictionaryToRows,rowsToDictionary} from '../apps/extension/features/Catalog';
import {mergeGridEdits} from '../apps/ui/editBuffer';

describe('Catalog dictionary projection preserves the SQL setting shape',()=>{
 it('원천 키와 표시값을 공백·선행 0까지 원형 보존한다',()=>{
  const original={'0001':'0','enabled':'false',' padded ':'  표시명  '};
  const rows=dictionaryToRows('dictionary.keys',original);
  expect(rowsToDictionary('dictionary.keys',rows,original)).toEqual(original);
  rows[0].value='변경';
  expect(rowsToDictionary('dictionary.keys',rows,original)).toEqual({...original,'0001':'변경'});
  expect(original['0001']).toBe('0');
 });
 it('값 사전의 원천 열·코드 및 비어 있는 코드 묶음을 보존한다',()=>{
  const original={status:{'01':'접수','00':'대기'},empty:{}};
  const rows=dictionaryToRows('dictionary.codes',original);
  expect(rowsToDictionary('dictionary.codes',rows,original)).toEqual(original);
  expect(rows.map(row=>row.key)).toEqual(['01','00']);
 });
 it('숨김키는 객체로 변환하지 않으며 배열의 순서와 중복을 유지한다',()=>{
  const original=['secret','0001','secret'];
  const rows=dictionaryToRows('dictionary.hidden',original);
  const restored=rowsToDictionary('dictionary.hidden',rows,original);
  expect(Array.isArray(restored)).toBe(true);expect(restored).toEqual(original);
  expect(()=>dictionaryToRows('dictionary.hidden',{secret:true})).toThrow('문자열 배열');
  expect(()=>rowsToDictionary('dictionary.hidden',rows,{secret:true})).toThrow('문자열 배열');
 });
 it('검색에서 숨겨진 행은 표시 행 수정과 삭제 뒤에도 유지한다',()=>{
  const original={first:'표시',hidden:'유지'};const rows=dictionaryToRows('dictionary.headers',original);
  const edited=mergeGridEdits(rows,[{...rows[0],value:'변경'}]);
  expect(rowsToDictionary('dictionary.headers',edited,original)).toEqual({first:'변경',hidden:'유지'});
  const deleted=mergeGridEdits(edited,[],[rows[0].__rowId]);
  expect(rowsToDictionary('dictionary.headers',deleted,original)).toEqual({hidden:'유지'});
 });
 it('같은 키를 조용히 덮어쓰지 않으며 비문자열 원본을 임의 변환하지 않는다',()=>{
  expect(()=>rowsToDictionary('dictionary.keys',[{key:'same',value:'a'},{key:'same',value:'b'}],{})).toThrow('반복');
  expect(()=>dictionaryToRows('dictionary.headers',{count:0})).toThrow('문자열');
  expect(()=>dictionaryToRows('dictionary.codes',{status:['a']})).toThrow('객체');
  expect(()=>rowsToDictionary('dictionary.keys',[{key:'ok',value:false}],{})).toThrow('텍스트');
 });
 it('특수 객체 키를 설정 객체의 프로토타입으로 해석하지 않는다',()=>{
  const original=JSON.parse('{"__proto__":"표시","constructor":"생성자"}');
  const restored=rowsToDictionary('dictionary.keys',dictionaryToRows('dictionary.keys',original),original) as object;
  expect(Object.getPrototypeOf(restored)).toBeNull();expect(Object.keys(restored)).toEqual(['__proto__','constructor']);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
 });
});

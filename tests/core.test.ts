import {describe,it,expect} from 'vitest';
import {matchesFilter,compareDecimal,projectRows,getPath,projectJson,evaluateCalculation,shiftDate} from '../plugins/core';
import type {FilterGroup} from '../packages/contracts/src';
import cases from './filter-cases.json';

describe('cross-runtime filter contract',()=>{for(const example of cases)it(example.name,()=>expect(matchesFilter(example.row,example.filter as FilterGroup,example.dictionaries as any)).toBe(example.expected));});

describe('multi-value nested filters',()=>{
  const filter:FilterGroup={join:'and',conditions:[{field:'기관',operator:'equals',values:['서울','경기']},{join:'or',conditions:[{field:'품명',operator:'contains',values:['프린터','복합기']},{field:'품명',operator:'equals',values:['팩스']}]},{field:'상태',operator:'notEquals',values:['취소','종료']}]};
  it('matches all list semantics and nested groups',()=>{
    expect(matchesFilter({기관:'서울',품명:'레이저 프린터',상태:'진행'},filter)).toBe(true);
    expect(matchesFilter({기관:'경기',품명:'팩스',상태:'종료'},filter)).toBe(false);
    expect(matchesFilter({기관:'부산',품명:'팩스',상태:'진행'},filter)).toBe(false);
  });
  it('preserves blank policy, false, zero, labels and paths',()=>{
    expect(matchesFilter({x:0},{join:'and',conditions:[{field:'x',operator:'equals',values:['0']}]})).toBe(true);
    expect(matchesFilter({x:false},{join:'and',conditions:[{field:'x',operator:'equals',values:['false']}]})).toBe(true);
    expect(matchesFilter({x:null},{join:'and',conditions:[{field:'x',operator:'notContains',values:['a']}]})).toBe(false);
    expect(matchesFilter({x:{code:'01'}},{join:'and',conditions:[{field:'x',path:['code'],compareAs:'label',operator:'equals',values:['진행']}]},{x:{'01':'진행'}})).toBe(true);
  });
  it('does not coerce identifiers or imprecise decimals',()=>{
    expect(matchesFilter({x:'01'},{join:'and',conditions:[{field:'x',operator:'equals',values:['1']}]})).toBe(false);
    expect(compareDecimal('9007199254740993.5','9007199254740993.4')).toBe(1);
    expect(compareDecimal('-0.05','-0.005')).toBe(-1);
  });
  it('rejects corrupted operators',()=>expect(()=>matchesFilter({}, {join:'and',conditions:[{field:'x',operator:'SQL',values:[]}]} as any)).toThrow());
});
describe('JSON presentation never mutates source',()=>{
  it('hides only wholly empty rows/columns',()=>{
    const rows=[{a:'',b:null,c:'  '},{a:0,b:false,c:''},{a:'x',b:'',c:null}];
    const before=JSON.stringify(rows);const projection=projectRows(rows,{hideEmptyRows:true,hideEmptyColumns:true});
    expect(projection.fields).toEqual(['a','b']);expect(projection.rows.length).toBe(2);expect(JSON.stringify(rows)).toBe(before);
  });
  it('keeps missing and null distinct and arrays independent',()=>{
    const value={a:[{price:'35608652.5'},null],other:[1,2,3]};
    expect(getPath(value,['a','0','price'])).toBe('35608652.5');
    expect(projectJson(value,{mode:'array',path:['a']})).toEqual([{price:'35608652.5'},{value:null}]);
    expect(getPath(value,['constructor'])).toBeUndefined();
    expect(projectJson(value,{mode:'raw',path:['missing']})).toBe('(누락)');
  });
});
describe('bounded formulas',()=>{
  it('handles arithmetic and refuses code',()=>{expect(evaluateCalculation('[수량] * (2+3)',{수량:4})).toBe('20');expect(evaluateCalculation('0.1+0.2')).toBe('0.3');expect(evaluateCalculation('[단가]*2',{단가:'35608652.5'})).toBe('71217305');expect(()=>evaluateCalculation('alert(1)')).toThrow();expect(()=>evaluateCalculation('1/0')).toThrow();});
  it('shifts dates without local DST effects',()=>{expect(shiftDate('2024-02-28',1)).toBe('2024-02-29');expect(()=>shiftDate('2025-02-29',1)).toThrow();});
});

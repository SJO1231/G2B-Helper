import { describe, expect, it } from 'vitest';
import { defaultTemplateProgram, renderTemplate, validateTemplateProgram, templatePathToken } from '../plugins/template/index';

describe('bounded conditional templates', () => {
  it('handles nested legacy conditions and preserves falsy values', () => {
    expect(renderTemplate('[같음:종류:물품]A[다름:상태:취소]{수량}:{활성}[/다름][/같음]', {종류:'물품',상태:'정상',수량:0,활성:false}).text).toBe('A0:false');
    expect(renderTemplate('[같음:종류:용역]숨김[/같음]', {종류:'물품'}).text).toBe('');
    expect(()=>renderTemplate('[같음:종류:물품]오류[/다름]',{})).toThrow('닫기');
    expect(()=>renderTemplate('[같음:종류:물품]오류',{})).toThrow('닫지');
  });
  it('uses exact decimal arithmetic without corrupting overlapping field names', () => {
    expect(renderTemplate('{금액-액} / {단가*수량} / {=[금액]/2}', {금액:'100.5',액:'0.5',단가:'35608652.5',수량:'3'}).text).toBe('100 / 106825957.5 / 50.25');
    expect(()=>renderTemplate('{=alert(1)}',{})).toThrow('계산식');
    expect(()=>renderTemplate('{=1/0}',{})).toThrow('0으로');
  });
  it('supports local-today date shifts, replacement and Unicode slices', () => {
    const result=renderTemplate('{오늘+2}|{이름:대체:서울:경기}|{이름:1:2}|{이름:2}',{이름:'서울😀'},undefined,new Date(2026,8,28));
    expect(result.text).toBe('2026/09/30|경기😀|서울|서울');
    expect(renderTemplate('{코드}', {코드:'0001'}).text).toBe('0001');
  });
  it('calculates explicitly selected nested JSON operands exactly',()=>{
    expect(renderTemplate('{=[row.단가]*[row.수량]}',{row:{단가:'35608652.5',수량:'3'}}).text).toBe('106825957.5');
    expect(()=>renderTemplate('{=[row.없는값]+1}',{row:{}})).toThrow('숫자가 아닌 열');
    expect(()=>renderTemplate('{=[row.constructor]+1}',{row:{}})).toThrow('숫자가 아닌 열');
  });
  it('keeps literal punctuation keys distinct from nested paths',()=>{
    const values={row:{'a.b':'0001',a:{b:'different'},'x}y':false,'empty key':0}};
    expect(renderTemplate(templatePathToken(['row','a.b'])+' / {{row.a.b}}',values).text).toBe('0001 / different');
    expect(renderTemplate(templatePathToken(['row','x}y'])+' / '+templatePathToken(['row','empty key']),values).text).toBe('false / 0');
    expect(()=>renderTemplate('{{path:bad}}',values)).toThrow('JSON 경로');
  });
  it('selects visual AND/OR clauses and reports missing fields', () => {
    const program={...defaultTemplateProgram(),clauses:[{id:'안내',label:'안내',condition:{join:'and' as const,conditions:[{field:'상태',operator:'notEquals' as const,values:['취소','종료']}]},whenTrue:'진행 {코드}',whenFalse:'중지'}]};
    expect(renderTemplate('{{@안내}}',{상태:'정상',코드:'01'},program).text).toBe('진행 01');
    expect(renderTemplate('{{@안내}}',{상태:'취소'},program).text).toBe('중지');
    expect(renderTemplate('{없음}',{}, {...program,missingMode:'empty'}).warnings).toEqual(['누락 필드: 없음']);
    expect(()=>renderTemplate('{없음}',{}, {...program,missingMode:'error'})).toThrow('필요한 열');
  });
  it('rejects cyclic clauses, duplicate ids and code-like property paths', () => {
    const program={...defaultTemplateProgram(),clauses:[{id:'a',label:'a',condition:{join:'and' as const,conditions:[]},whenTrue:'{{@a}}',whenFalse:''}]};
    expect(()=>renderTemplate('{{@a}}',{},program)).toThrow('순환');
    expect(()=>validateTemplateProgram({...program,clauses:[...program.clauses,...program.clauses]})).toThrow('식별자');
    expect(renderTemplate('{{constructor}}',{}).text).toBe('[누락: constructor]');
  });
  it('bounds repeated substitutions and expanded condition output',()=>{
    expect(()=>renderTemplate('{x}'.repeat(10001),{x:'a'})).toThrow('치환하는 값');
    const program={...defaultTemplateProgram(),clauses:[{id:'a',label:'a',condition:{join:'and' as const,conditions:[]},whenTrue:'{x}{x}',whenFalse:''}]};
    expect(()=>renderTemplate('{{@a}}',{x:'a'.repeat(3*1024*1024)},program)).toThrow('4MB');
  });
});

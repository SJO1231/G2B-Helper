import {describe,it,expect} from 'vitest';
import {calendarDays,moveCalendarPeriod,noteSaveValues,notesOnDate,visibleNotes,noteLabel} from '../apps/extension/features/Notes';
import type {TableRow} from '../packages/contracts/src/index';
const row=(id:string,values:Record<string,unknown>):TableRow=>({__rowId:id,__storeVersion:1,...values});
const draft={title:'업무 메모',body:'원본 유지',screenKey:'',start:'2026-09-28',end:'2026-09-29',important:false,urgent:true,completed:false};

describe('SQL 메모·일정 팝업의 문맥과 날짜',()=>{
 it('공통과 같은 화면만 표시하며 관리 보기에서 다른 화면을 명시적으로 포함한다',()=>{
  const rows=[row('common',{screenKey:''}),row('same',{screenKey:'screen-a'}),row('other',{screenKey:'screen-b'}),row('legacy',{})];
  expect(visibleNotes(rows,'screen-a').map(row=>row.__rowId)).toEqual(['common','same','legacy']);
  expect(visibleNotes(rows,'').map(row=>row.__rowId)).toEqual(['common','legacy']);
  expect(visibleNotes(rows,'screen-a',true)).toEqual(rows);
 });
 it('윤년·연도 경계와 월말 이동을 지역 날짜로 처리한다',()=>{
  expect(calendarDays('2024-02-29','day')).toEqual(['2024-02-29']);
  expect(calendarDays('2024-02-29','week')).toEqual(['2024-02-26','2024-02-27','2024-02-28','2024-02-29','2024-03-01','2024-03-02','2024-03-03']);
  const days=calendarDays('2026-01-31','month');expect(days).toHaveLength(42);expect(days[0]).toBe('2025-12-29');expect(new Set(days).size).toBe(42);
  expect(moveCalendarPeriod('2026-01-31','month',1)).toBe('2026-02-01');
  expect(moveCalendarPeriod('2026-01-01','month',-1)).toBe('2025-12-01');
 });
 it('기간 일정은 양 끝 날짜를 포함하고 단일 일정도 표시한다',()=>{
  const rows=[row('period',{start:'2026-09-28T09:00:00+09:00',end:'2026-09-30T18:00:00+09:00'}),row('single',{start:'2026-09-29'}),row('other',{start:'2026-10-01'})];
  expect(notesOnDate(rows,'2026-09-28').map(row=>row.__rowId)).toEqual(['period']);
  expect(notesOnDate(rows,'2026-09-29').map(row=>row.__rowId)).toEqual(['period','single']);
  expect(notesOnDate(rows,'2026-09-30').map(row=>row.__rowId)).toEqual(['period']);
 });
 it('제목·중요도 수정 시 기존 시간·시간대와 업무 참조를 덮어쓰지 않는다',()=>{
  const original=row('appointment',{start:'2026-09-28T09:30:00+09:00',end:'2026-09-29T14:00:00+09:00',sourceId:'dataset.work',rowId:'work-row'});
  const values=noteSaveValues('schedules',draft,original);
  expect(values.start).toBe(original.start);expect(values.end).toBe(original.end);
  expect(values).not.toHaveProperty('sourceId');expect(values).not.toHaveProperty('rowId');
  expect(values.important).toBe(false);expect(values.urgent).toBe(true);
  expect(original.start).toBe('2026-09-28T09:30:00+09:00');
 });
 it('빈 초안은 저장하고 존재하지 않는 날짜·역전된 기간은 거부한다',()=>{
  expect(noteSaveValues('memos',{...draft,title:' ',body:''})).toMatchObject({title:'',body:'',trashed:false,color:'yellow'});
  expect(noteSaveValues('memos',{...draft,title:' '})).toMatchObject({title:'',body:'원본 유지'});
  expect(noteLabel(row('untitled',{body:'첫 줄\n둘째 줄'}))).toBe('첫 줄');
  expect(noteLabel(row('titled',{title:'명시 제목',body:'첫 줄'}))).toBe('명시 제목');
  expect(()=>noteSaveValues('schedules',{...draft,start:'2026-02-30'})).toThrow('시작일');
  expect(()=>noteSaveValues('schedules',{...draft,end:'2026-09-27'})).toThrow('시작일');
  expect(noteSaveValues('memos',draft)).not.toHaveProperty('start');
 });
});

import {noteScreenKey,matchesNoteScreen,sortNotes,calendarSelection} from '../apps/extension/features/notes-model';
describe('스티커 저장·화면·휴지통 계약',()=>{
 it('업무 화면키는 URL·areaCd·depth1·depth2만 사용하고 동적 screenId를 제외한다',()=>{
  const context={url:'https://g2b.go.kr/work',pointInfo:{areaCd:'14',depth1:'01001',depth2:'01114',depth3:'x',screenId:'random'}};
  const key=noteScreenKey(context);expect(key).toBe(JSON.stringify([context.url,'14','01001','01114']));
  expect(noteScreenKey({...context,pointInfo:{...context.pointInfo,screenId:'changed',depth3:'other'}})).toBe(key);
  expect(matchesNoteScreen(JSON.stringify([context.url,'14','01001','01114','old-depth','old-id']),key)).toBe(true);
  expect(noteScreenKey({...context,requiresScreenSelection:true})).toBe('');
  expect(matchesNoteScreen(context.url,key)).toBe(true);
  expect(matchesNoteScreen('https://other.test/',key)).toBe(false);
 });
 it('휴지통은 기본목록과 달력에서 제외하지만 저장 내용·색상은 보존한다',()=>{
  const value=noteSaveValues('memos',{...draft,color:'green',trashed:true});expect(value).toMatchObject({body:draft.body,color:'green',trashed:true});
  const rows=[row('live',{body:'a'}),row('trash',{trashed:true,start:'2026-09-28'})];
  expect(visibleNotes(rows,'',true).map(r=>r.__rowId)).toEqual(['live']);expect(notesOnDate(rows,'2026-09-28')).toEqual([]);
 });
 it('중요가 먼저 나오며 무제목은 첫 줄로 정렬하고 원본 순서를 바꾸지 않는다',()=>{
  const rows=[row('normal',{body:'가나다'}),row('important',{title:'하나',important:true}),row('second',{body:'나무'})];
  expect(sortNotes(rows,'title').map(r=>r.__rowId)).toEqual(['important','normal','second']);expect(rows[0].__rowId).toBe('normal');
 });
 it('여러 날짜 토글과 Shift 구간을 날짜순으로 선택한다',()=>{
  expect(calendarSelection(['2026-09-28'],'2026-09-30',true,'2026-09-28')).toEqual(['2026-09-28','2026-09-29','2026-09-30']);
  expect(calendarSelection(['2026-09-28','2026-09-30'],'2026-09-28',false)).toEqual(['2026-09-30']);
 });
});

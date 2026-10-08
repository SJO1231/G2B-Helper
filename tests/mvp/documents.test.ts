import { describe, expect, it } from 'vitest';
import { documentItems, screenDocumentItems } from '../../apps/mvp/integrations';
import { RecordView } from '../../apps/mvp/record-view';
import type { MvpSettings, ProcurementRecord } from '../../apps/mvp/contracts';

const settings:MvpSettings={theme:'light',extractionMode:'tables',hideEmptyColumns:true,hideUnmappedColumns:false,dictionary:{keys:{ctrtNo:'표시용 계약번호'},values:{}},launchers:[],userColumns:{contract:['memo']}};
const record=(id:string):ProcurementRecord=>({recordId:id,storeVersion:1,stage:'contract',identity:[id,'01'],fields:{ctrtNo:id,ctrtChgOrd:'01',memo:'source',amount:'12345678901234567890.0001',zero:0,flag:false,blank:''},userValues:{memo:'user'},children:[{key:'items',label:'물품',kind:'items',rows:[{id:'0001'}]}],source:{url:'https://www.g2b.go.kr/',framePath:'top',areaCd:'14',depth1:'01570',depth2:'01571'},rawJson:'{}',capturedAt:'2026-10-03T00:00:00Z'});
describe('document input snapshot',()=>{
 it('uses recognized screen observations with the same parent/child content as DB input',()=>{
  const original=record('0001');original.userValues={};
  const items=screenDocumentItems([original]);
  const view=new RecordView([original],'contract',settings);
  const [dbItem]=documentItems([{sourceIndex:0,row:view.toRow(original)}],{kind:'db',records:[original],recordIds:['0001'],view});
  expect(items[0]).toEqual({...dbItem,userValues:{}});
  expect(dbItem.userValues).toEqual({memo:'',종결:false,종결금액:'',지정일:'',선금보증금액:'',선금보증기한:''});
  expect(items[0].fields).toMatchObject({zero:0,flag:false,blank:'',amount:'12345678901234567890.0001'});
  expect(items[0].identity).toEqual(['0001','01']);expect(items[0].children[0].rows[0].id).toBe('0001');
  items[0].children[0].rows[0].id='changed';expect(original.children[0].rows[0].id).toBe('0001');
 });
 it('preserves distinct sources and leaves rejected recognition empty',()=>{
  const a=record('0001'),b=record('0002');b.source.framePath='frame2';b.fields.zero=2;
  const items=screenDocumentItems([a,b]);expect(items.map(i=>i.identity[0])).toEqual(['0001','0002']);
  expect(items.map(i=>i.fields.zero)).toEqual([0,2]);expect(items[1].source.framePath).toBe('frame2');
  expect(screenDocumentItems([])).toEqual([]);
 });
 it('keeps more than 100 recognition candidates available for a smaller selection',()=>{
  expect(screenDocumentItems(Array.from({length:101},(_,i)=>record(String(i)))).length).toBe(101);
 });
 it('snapshots 101 DB or extracted candidates without imposing the request limit before selection',()=>{
  const records=Array.from({length:101},(_,i)=>record(String(i))),view=new RecordView(records,'contract',settings);
  const selected=records.map((record,sourceIndex)=>({sourceIndex,row:view.toRow(record)}));
  const db=documentItems(selected,{kind:'db',records,recordIds:records.map(r=>r.recordId),view});
  const screen=documentItems(selected,{kind:'screen',view:{key:'A',label:'A',rows:[]},stage:'contract'});
  expect(db.length).toBe(101);expect(db[100].identity).toEqual(['100','01']);expect(screen[100].fields.ctrtNo).toBe('100');
 });
 it('uses original DB identity after sorting, the stored source values and same-name user values separately (#42)',()=>{
  const records=[record('0001'),record('0002')],view=new RecordView(records,'contract',settings),row=view.toRow(records[1]);row.memo='edited source';row[view.userNames.get('memo')!]='edited user';
  const [item]=documentItems([{sourceIndex:1,row}],{kind:'db',records,recordIds:['0001','0002'],view});
  expect(item.identity).toEqual(['0002','01']);expect(item.fields).toMatchObject({ctrtNo:'0002',memo:'source',zero:0,flag:false,blank:'',amount:'12345678901234567890.0001'});expect(item.userValues.memo).toBe('edited user');expect(item.children).toEqual(records[1].children);expect(item.fields).not.toHaveProperty('표시용 계약번호');
  item.children[0].rows[0].id='changed';expect(records[1].children[0].rows[0].id).toBe('0001');expect(records[1].fields.memo).toBe('source');
 });
 it('passes the current extracted table without joining other tables or using display labels',()=>{
  const row={ctrtNo:'0001',ctrtChgOrd:'01',flag:false,zero:0,amount:'12345678901234567890.01',blank:'',nested:[{id:'001'}]};
  const [item]=documentItems([{sourceIndex:7,row}],{kind:'screen',stage:'contract',view:{key:'frame2::A',label:'A',rows:[],source:{url:'https://www.g2b.go.kr/',framePath:'frame2',areaCd:'14',depth1:'01570',depth2:'01571'}}});
  expect(item.fields).toEqual(row);expect(item.source).toMatchObject({framePath:'frame2',tableKey:'frame2::A'});expect(item.children).toEqual([]);item.fields.zero=1;expect(row.zero).toBe(0);
 });
 it('rejects no selection and mismatched DB row mapping',()=>{
  expect(()=>documentItems([],{kind:'screen',view:{key:'A',label:'A',rows:[]},stage:'contract'})).toThrow();
  const records=[record('0001')];expect(()=>documentItems([{sourceIndex:2,row:{}}],{kind:'db',records,recordIds:['0001'],view:new RecordView(records,'contract',settings)})).toThrow();
 });
});

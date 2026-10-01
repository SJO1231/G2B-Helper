import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({request:vi.fn(),validateHwpx:vi.fn(),validateResolved:vi.fn(),resolve:vi.fn()}));
vi.mock('../plugins/core/gateway',()=>({request:mocks.request}));
vi.mock('../plugins/hwpx/index',()=>({validateHwpxTemplate:mocks.validateHwpx,validateResolvedHwpxTemplate:mocks.validateResolved,resolveHwpxTemplate:mocks.resolve}));
import {sqlDocuments} from '../apps/extension/document-storage';

type Document={namespace:string;documentId:string;storeVersion:number;value:any};
let documents:Document[],beforePut:(()=>void)|undefined;
const master=():Document=>({namespace:'hwpx-templates',documentId:'master',storeVersion:3,value:{name:'원본',masterZip:'sample-base64',anchors:[]}});
beforeEach(()=>{
 vi.clearAllMocks();documents=[];beforePut=undefined;
 mocks.resolve.mockImplementation((documentId:string,graph:Document[])=>({template:graph.find(entry=>entry.documentId===documentId)!.value}));
 mocks.request.mockImplementation(async(command:string,payload:any)=>{
  if(command==='extension.document.list')return structuredClone(documents.filter(entry=>entry.namespace===payload.namespace));
  if(command==='extension.document.put'){
   beforePut?.();
   const existing=documents.find(entry=>entry.namespace===payload.namespace&&entry.documentId===payload.documentId);
   if((existing?.storeVersion??null)!==payload.storeVersion)throw Error('STALE_VERSION');
   if(payload.expectedDocumentIds&&JSON.stringify([...payload.expectedDocumentIds].sort())!==JSON.stringify(documents.filter(entry=>entry.namespace===payload.namespace).map(entry=>entry.documentId).sort()))throw Error('STALE_VERSION: document set');
   for(const reference of payload.expectedReferences||[])if(documents.find(entry=>entry.documentId===reference.documentId&&entry.namespace===payload.namespace)?.storeVersion!==reference.storeVersion)throw Error('STALE_VERSION: reference');
   const saved={namespace:payload.namespace,documentId:payload.documentId,storeVersion:(existing?.storeVersion??0)+1,value:structuredClone(payload.value)};
   documents=[...documents.filter(entry=>entry!==existing),saved];return structuredClone(saved);
  }
  if(command==='extension.document.remove'){
   const existing=documents.find(entry=>entry.namespace===payload.namespace&&entry.documentId===payload.documentId);
   if(existing?.storeVersion!==payload.storeVersion)throw Error('STALE_VERSION');
   documents=documents.filter(entry=>entry!==existing);return {removed:payload.documentId};
  }
  throw Error(command);
 });
});

describe('SQL extension document adapter',()=>{
 it('텍스트 템플릿을 SQL 명령으로 저장·재조회하고 문자열을 그대로 보존한다',async()=>{
  const value={name:'견적 0001',body:'단가 35608652.5\n{{name}}\n0 false'};
  const saved=await sqlDocuments.putDocument('templates','text-1',null,value);
  expect(saved.value).toEqual(value);expect(await sqlDocuments.listDocuments('templates')).toEqual([saved]);
  const updated=await sqlDocuments.putDocument('templates','text-1',saved.storeVersion,{...value,body:'변경'});
  expect(updated.storeVersion).toBeGreaterThan(saved.storeVersion);
  await expect(sqlDocuments.putDocument('templates','text-1',saved.storeVersion,value)).rejects.toThrow('STALE_VERSION');
  expect((await sqlDocuments.listDocuments<any>('templates'))[0].value.body).toBe('변경');
 });
 it('텍스트 이름·본문과 프로그램이 잘못되면 SQL 저장을 호출하지 않는다',async()=>{
  await expect(sqlDocuments.putDocument('templates','bad',null,{name:'',body:'내용'})).rejects.toThrow('이름');
  await expect(sqlDocuments.putDocument('templates','bad',null,{name:'ok',body:42})).rejects.toThrow('본문');
  await expect(sqlDocuments.putDocument('templates','bad',null,{name:'ok',body:'text',program:{version:99}})).rejects.toThrow();
  expect(mocks.request).not.toHaveBeenCalled();
 });
 it('HWPX 전체 후보 그래프 검증 후 기존 문서 ID와 모든 참조 버전을 Native로 보낸다',async()=>{
  documents=[master(),{namespace:'hwpx-templates',documentId:'other',storeVersion:7,value:{name:'다른 원본',masterZip:'other',anchors:[]}}];
  const child={name:'파생',baseTemplateId:'master',anchors:[]};
  await sqlDocuments.putDocument('hwpx-templates','child',null,child,[{documentId:'master',storeVersion:3}]);
  const call=mocks.request.mock.calls.find(([command])=>command==='extension.document.put')!;
  expect(call[1].expectedDocumentIds).toEqual(['master','other']);
  expect(call[1].expectedReferences).toEqual([{documentId:'master',storeVersion:3},{documentId:'other',storeVersion:7}]);
  expect(mocks.validateResolved).toHaveBeenCalledTimes(3);
 });
 it('관찰한 마스터가 이미 바뀌었으면 저장 전에 중단한다',async()=>{
  documents=[master()];
  await expect(sqlDocuments.putDocument('hwpx-templates','child',null,{baseTemplateId:'master'},[{documentId:'master',storeVersion:2}])).rejects.toThrow('참조 템플릿');
  expect(mocks.request.mock.calls.every(([command])=>command==='extension.document.list')).toBe(true);
 });
 it('목록 조회와 저장 사이 마스터 변경·새 파생 추가를 Native CAS가 거부한다',async()=>{
  documents=[master()];beforePut=()=>{documents[0].storeVersion++;};
  await expect(sqlDocuments.putDocument('hwpx-templates','child',null,{baseTemplateId:'master'})).rejects.toThrow('reference');
  expect(documents.some(document=>document.documentId==='child')).toBe(false);
  documents=[master()];beforePut=()=>{documents.push({namespace:'hwpx-templates',documentId:'new-other',storeVersion:1,value:{baseTemplateId:'master'}});};
  await expect(sqlDocuments.putDocument('hwpx-templates','child',null,{baseTemplateId:'master'})).rejects.toThrow('document set');
  expect(documents.some(document=>document.documentId==='child')).toBe(false);
 });
 it('참조 목록 대기 중 호출자가 원본 입력을 변경해도 검증한 스냅샷을 저장한다',async()=>{
  documents=[master()];const value={name:'처음',baseTemplateId:'master',anchors:[{id:'a'}]};
  const pending=sqlDocuments.putDocument('hwpx-templates','child',null,value);
  value.name='나중';value.anchors.push({id:'b'});
  const saved=await pending;
  expect(saved.value).toEqual({name:'처음',baseTemplateId:'master',anchors:[{id:'a'}]});
 });
 it('검증 실패한 하위 파생이 있으면 마스터 갱신을 저장하지 않는다',async()=>{
  documents=[master(),{namespace:'hwpx-templates',documentId:'child',storeVersion:1,value:{baseTemplateId:'master',broken:true}}];
  mocks.validateResolved.mockImplementation((template:any)=>{if(template.broken)throw Error('invalid child anchor');});
  await expect(sqlDocuments.putDocument('hwpx-templates','master',3,{...master().value,name:'갱신'})).rejects.toThrow('invalid child anchor');
  expect(mocks.request.mock.calls.some(([command])=>command==='extension.document.put')).toBe(false);
 });
});

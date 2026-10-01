import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalDocument, PrototypeServices } from '../bookmarklet/contracts';
import type { DocumentStore } from './document-store';
import { useUnsavedChanges } from '../bookmarklet/lifecycle';
import { canonicalJson } from '../bookmarklet/capture-identity';
import { openHwpx, listHwpxTargets, renderHwpxStructure, generateHwpx, exportHwpx, bytesToBase64, base64ToBytes, resolveHwpxTemplate, getHwpxResources, type HwpxInsertion, type HwpxArchive, type HwpxTemplate, type HwpxTarget, type HwpxAnchorBinding } from '../../plugins/hwpx/index';
import { HwpxInsertionEditor } from './HwpxInsertionEditor';
import { defaultTemplateProgram, type TemplateProgram } from '../../plugins/template/index';
import { TemplateProgramEditor } from '../../plugins/template-ui/index';
import { download } from '../../plugins/files/index';

function downloadArchive(name:string,bytes:Uint8Array){const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:'application/hwp+zip'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function HwpxView({archive,select,selectedId}:{archive:HwpxArchive;select:(target:HwpxTarget)=>void;selectedId?:string}){
  const container=useRef<HTMLDivElement>(null),callback=useRef(select);callback.current=select;
  useEffect(()=>{if(!container.current)return;const element=renderHwpxStructure(archive,target=>callback.current(target));container.current.replaceChildren(element);return()=>element.remove();},[archive]);
  useEffect(()=>{for(const element of Array.from(container.current?.querySelectorAll<HTMLElement>('[data-hwpx-target]')??[]))element.classList.toggle('selected-anchor',element.dataset.hwpxTarget===selectedId);},[selectedId,archive]);
  return <div className="hwpx-viewer" ref={container}/>;
}
export function HwpxPanel({services,documents}:{services:PrototypeServices;documents:DocumentStore}){
  const {listDocuments,putDocument,removeDocument}=documents;
  const [entries,setEntries]=useState<LocalDocument<HwpxTemplate>[]>([]),[editing,setEditing]=useState<LocalDocument<HwpxTemplate>|null>(null),[baseId,setBaseId]=useState<string|undefined>(),[baseSnapshot,setBaseSnapshot]=useState<LocalDocument<HwpxTemplate>[]>([]);
  const [name,setName]=useState('새 HWPX 양식'),[archive,setArchive]=useState<HwpxArchive|null>(null),[masterZip,setMasterZip]=useState(''),[anchors,setAnchors]=useState<HwpxAnchorBinding[]>([]),[program,setProgram]=useState<TemplateProgram>(defaultTemplateProgram);
  const [selected,setSelected]=useState<HwpxTarget|null>(null),[anchorId,setAnchorId]=useState<string|undefined>(),[anchorName,setAnchorName]=useState(''),[expression,setExpression]=useState(''),[search,setSearch]=useState(''),[preview,setPreview]=useState<HwpxArchive|null>(null),[warnings,setWarnings]=useState<string[]>([]),[previewSelection,setPreviewSelection]=useState('');
  const [insertion,setInsertion]=useState<HwpxInsertion|undefined>();
  const operationBusy=useRef(false),operationSequence=useRef(0);
  const [bindingDirty,setBindingDirty]=useState(false);const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);useUnsavedChanges(dirty||busy);
  useEffect(()=>()=>{operationSequence.current++;},[]);
  const beginOperation=()=>{if(operationBusy.current)return undefined;operationBusy.current=true;setBusy(true);return ++operationSequence.current;};
  const finishOperation=(sequence:number)=>{if(sequence===operationSequence.current){operationBusy.current=false;setBusy(false);}};
  const report=(error:unknown)=>services.notify('실패: '+(error instanceof Error?error.message:String(error)));
  async function refresh(){try{setEntries(await listDocuments<HwpxTemplate>('hwpx-templates'));}catch(error){report(error);}}
  useEffect(()=>{void refresh();},[]);
  const values=services.selection?.values??{},fields=Object.keys(values).filter(field=>!field.startsWith('__')),columns=fields.map(field=>({field,label:field}));
  const targets=useMemo(()=>archive?listHwpxTargets(archive):[],[archive]),visibleTargets=targets.filter(target=>target.text.includes(search));
  const resources=useMemo(()=>{if(!archive)return undefined;try{return getHwpxResources(archive);}catch{return undefined;}},[archive]);
  const select=(target:HwpxTarget,binding?:HwpxAnchorBinding)=>{if(bindingDirty&&!confirm('앵커 입력을 버리고 다른 위치를 선택할까요?'))return;setBindingDirty(false);const anchor=binding??anchors.find(candidate=>candidate.target.id===target.id);setSelected(target);setAnchorId(anchor?.id);setAnchorName(anchor?.name??'앵커 '+(anchors.length+1));setExpression(anchor?.expression??'');setInsertion(anchor?.insertion);};
  const invalidate=()=>{setDirty(true);setPreview(null);};
  const canDiscard=()=>!dirty||confirm('저장하지 않은 HWPX 템플릿 변경을 버릴까요?');
  async function openEntry(id:string){if(operationBusy.current||!canDiscard())return;const sequence=beginOperation();if(sequence===undefined)return;try{const fresh=await listDocuments<HwpxTemplate>('hwpx-templates');if(sequence!==operationSequence.current)return;const entry=fresh.find(candidate=>candidate.documentId===id);if(!entry)return;const resolved=resolveHwpxTemplate(id,fresh),value=resolved.template;setEntries(fresh);setEditing(entry);setBaseId(entry.value.baseTemplateId);setBaseSnapshot(fresh);setName(value.name);setMasterZip(value.masterZip!);setArchive(openHwpx(base64ToBytes(value.masterZip!),value.filename));setAnchors(value.anchors);setProgram(value.program);setPreview(null);setSelected(null);setBindingDirty(false);setWarnings([]);setDirty(false);}catch(error){report(error);}finally{finishOperation(sequence);}}
  function generate(){if(!archive)return;try{if(bindingDirty)throw new Error('앵커 추가·수정 버튼으로 입력을 먼저 반영하세요.');const result=generateHwpx(archive,anchors,values,program);setPreview(result.archive);setWarnings([...result.warnings,...result.archive.warnings]);setPreviewSelection(canonicalJson(values));services.notify('HWPX 적용 미리보기를 생성했습니다. 내용과 경고를 확인한 뒤 다운로드하세요.');}catch(error){setPreview(null);report(error);}}
  function dependencies(id:string,source:LocalDocument<HwpxTemplate>[]){const result:{documentId:string;storeVersion:number}[]=[];let current:string|undefined=id;for(let depth=0;current&&depth<21;depth++){const entry=source.find(candidate=>candidate.documentId===current);if(!entry)throw new Error('파생 원본 템플릿이 없습니다.');result.push({documentId:entry.documentId,storeVersion:entry.storeVersion});current=entry.value.baseTemplateId;}return result;}
  async function save(){if(!archive||operationBusy.current)return;const sequence=beginOperation();if(sequence===undefined)return;try{if(bindingDirty)throw new Error('앵커 추가·수정 버튼으로 입력을 먼저 반영하세요.');setBusy(true);let value:HwpxTemplate={name:name.trim(),filename:archive.filename,masterZip,anchors,program},references:{documentId:string;storeVersion:number}[]|undefined;
    if(baseId){const base=resolveHwpxTemplate(baseId,baseSnapshot).template;value={name:name.trim(),filename:archive.filename,baseTemplateId:baseId,anchors:anchors.filter(anchor=>canonicalJson(anchor)!==canonicalJson(base.anchors.find(candidate=>candidate.id===anchor.id))),excludedAnchorIds:base.anchors.filter(anchor=>!anchors.some(candidate=>candidate.id===anchor.id)).map(anchor=>anchor.id),program};references=dependencies(baseId,baseSnapshot);}
    const saved=await putDocument('hwpx-templates',editing?.documentId??crypto.randomUUID(),editing?.storeVersion??null,value,references);setEditing(saved);setDirty(false);await refresh();services.notify('HWPX 템플릿을 저장했습니다. 원본 파일과 앵커 연결을 함께 보관했습니다.');
  }catch(error){report(error);}finally{finishOperation(sequence);}}
  return <fieldset disabled={busy} aria-busy={busy} className="feature-fieldset"><div className="hwpx-layout"><section className="panel"><h2>HWPX 뷰어와 템플릿</h2>
    <p className="muted">문단·표 셀을 선택하고 DB 열이나 조건 문구를 연결합니다. 이 뷰어는 문서 구조를 보여줍니다. 한글의 페이지 배치·글꼴·도형을 완전히 재현하는 화면은 아닙니다.</p>
    <div className="row"><input type="file" accept=".hwpx" aria-label="HWPX 원본 파일" onChange={async event=>{const file=event.target.files?.[0];if(!file||operationBusy.current||!canDiscard())return;const sequence=beginOperation();if(sequence===undefined)return;try{if(file.size>50*1024*1024)throw new Error('HWPX 파일은 50MB 이하로 사용하세요.');const bytes=new Uint8Array(await file.arrayBuffer());if(sequence!==operationSequence.current)return;const opened=openHwpx(bytes,file.name);setArchive(opened);setMasterZip(bytesToBase64(bytes));setName(file.name.replace(/\.hwpx$/i,''));setEditing(null);setBaseId(undefined);setBaseSnapshot([]);setAnchors([]);setProgram(defaultTemplateProgram());setSelected(null);setBindingDirty(false);setPreview(null);setWarnings(opened.warnings);setDirty(true);services.notify('HWPX를 열었습니다. 문단이나 셀을 클릭해 앵커를 지정하세요.');}catch(error){report(error);}finally{finishOperation(sequence);}}}/>
      <select aria-label="HWPX 템플릿 선택" value={editing?.documentId??''} onChange={event=>{void openEntry(event.target.value);}}><option value="">저장된 템플릿 선택</option>{entries.map(entry=><option key={entry.documentId} value={entry.documentId}>{entry.value.name}{entry.value.baseTemplateId?' · 파생':' · 마스터'}</option>)}</select><button onClick={()=>void refresh()}>HWPX 목록 새로고침</button></div>
    <div className="row"><input aria-label="HWPX 템플릿 이름" value={name} onChange={event=>{setName(event.target.value);invalidate();}}/><button className="primary" disabled={!archive||busy} onClick={()=>void save()}>HWPX 템플릿 저장</button>
      {editing&&<><button onClick={()=>{setBaseId(editing.documentId);setBaseSnapshot(entries);setEditing(null);setName(previous=>previous+' 파생');invalidate();services.notify('원본을 참조하는 파생 템플릿입니다. 저장하면 별도 양식이 됩니다.');}}>파생 템플릿 만들기</button><button disabled={busy} onClick={async()=>{if(operationBusy.current||!confirm('이 HWPX 템플릿을 삭제할까요?'))return;const sequence=beginOperation();if(sequence===undefined)return;try{await removeDocument('hwpx-templates',editing.documentId,editing.storeVersion);if(sequence!==operationSequence.current)return;setEditing(null);setArchive(null);setDirty(false);await refresh();}catch(error){report(error);}finally{finishOperation(sequence);}}}>HWPX 템플릿 삭제</button></>}
      <span className="muted">{baseId?'파생 · 원본 참조':'마스터'} · 앵커 {anchors.length}개{dirty?' · 저장 전':''}</span></div>
    <div className="row"><button disabled={!archive} onClick={()=>{setPreview(null);}}>원본 구조</button><button disabled={!archive} onClick={generate}>HWPX 적용 미리보기</button>
      <button disabled={!preview||previewSelection!==canonicalJson(values)} onClick={()=>{try{downloadArchive(name+'.hwpx',exportHwpx(preview!));services.notify('HWPX 다운로드를 요청했습니다. 원본 파일은 유지됩니다.');}catch(error){report(error);}}}>생성 HWPX 다운로드</button>
      <button disabled={!archive} onClick={()=>{const current=preview??archive;download(name+'-sections.json',JSON.stringify(current!.sections,null,2));}}>본문 XML 내보내기</button></div>
    {preview&&previewSelection!==canonicalJson(values)&&<p className="error">DB 선택이 바뀌었습니다. 적용 미리보기를 다시 생성하세요.</p>}
    {warnings.length>0&&<details><summary>문서 경고 · {warnings.length}개</summary><p className="muted">{warnings.join('\n')}</p></details>}
    {preview&&<p className="muted">생성 미리보기에서는 앵커를 지정하지 않습니다. 위치를 바꾸려면 원본 구조로 돌아가세요.</p>}
    {archive?<HwpxView archive={preview??archive} selectedId={preview?undefined:selected?.id} select={target=>{if(preview){services.notify('원본 구조 버튼을 누른 뒤 앵커 위치를 지정하세요.');return;}select(target);}}/>:<div className="welcome">HWPX 원본을 선택하거나 저장한 템플릿을 여세요.</div>}
  </section><aside className="panel"><h2>앵커와 DB 열 연결</h2><p className="muted">{services.selection?.datasetName??'DB에서 레코드를 선택하면 연결할 열을 볼 수 있습니다.'}</p>
    {selected&&<div className="anchor-editor"><p>{selected.kind==='table-cell'?'표 셀':selected.kind==='text'?'텍스트 구간':'문단'} · <code>{selected.part}</code></p><pre>{selected.text||'(빈 문단)'}</pre>{selected.reason&&<p className="error">{selected.reason}</p>}
      <label>앵커 이름<input aria-label="HWPX 앵커 이름" value={anchorName} onChange={event=>{setAnchorName(event.target.value);setBindingDirty(true);setDirty(true);}}/></label>
      <label>연결할 DB 열<select aria-label="HWPX 연결 열" value="" onChange={event=>{setExpression('{{'+event.target.value+'}}');setBindingDirty(true);invalidate();}}><option value="">열을 선택하세요</option>{fields.map(field=><option value={field} key={field}>{field}</option>)}</select></label>
      <HwpxInsertionEditor insertion={insertion} values={values} resources={resources} onChange={value=>{setInsertion(value);setBindingDirty(true);invalidate();}}/>
      {insertion?.kind!=='table-after'&&<label>넣을 내용·치환식<textarea aria-label="HWPX 앵커 출력" value={expression} onChange={event=>{setExpression(event.target.value);setBindingDirty(true);invalidate();}}/></label>}
      <button disabled={(!insertion&&!selected.writable)||!anchorName.trim()} onClick={()=>{const binding={id:anchorId??crypto.randomUUID(),name:anchorName.trim(),target:selected,expression,insertion};setAnchors(previous=>previous.some(anchor=>anchor.id===binding.id)?previous.map(anchor=>anchor.id===binding.id?binding:anchor):[...previous,binding]);setAnchorId(binding.id);setBindingDirty(false);invalidate();services.notify('앵커 연결을 편집 버퍼에 반영했습니다. 템플릿 저장으로 확정하세요.');}}>{anchorId?'앵커 연결 수정':'앵커 추가'}</button>
      {anchorId&&<button onClick={()=>{setAnchorId(undefined);setAnchorName('앵커 '+(anchors.length+1));setBindingDirty(true);invalidate();}}>같은 위치에 별도 앵커 만들기</button>}
    </div>}
    <div className="anchor-list">{anchors.map(anchor=><div className="row" key={anchor.id}><button onClick={()=>select(anchor.target,anchor)}>{anchor.name}</button><code>{anchor.insertion?.kind==='table-after'?'배열 표':anchor.insertion?'새 문단 · '+anchor.expression:anchor.expression}</code><button aria-label={anchor.name+' 앵커 삭제'} onClick={()=>{if(bindingDirty&&!confirm('편집 중인 앵커 입력을 버릴까요?'))return;setAnchors(previous=>previous.filter(candidate=>candidate.id!==anchor.id));setSelected(null);setBindingDirty(false);invalidate();}}>×</button></div>)}</div>
    <TemplateProgramEditor program={program} columns={columns} onChange={value=>{setProgram(value);invalidate();}} onInsert={token=>{setExpression(previous=>previous+token);setBindingDirty(true);invalidate();}}/>
    <details><summary>문단·표 셀 검색</summary><input aria-label="HWPX 위치 검색" value={search} onChange={event=>setSearch(event.target.value)}/><div className="hwpx-target-list">{visibleTargets.slice(0,250).map(target=><button key={target.id} onClick={()=>select(target)}>{target.kind==='table-cell'?'셀':target.kind==='text'?'텍스트':'문단'} · {target.text.slice(0,100)||'(빈 문단)'}</button>)}</div><p className="muted">{visibleTargets.length}개 · 처음 250개 표시</p></details>
    <p className="muted">새 문단·직사각 표는 본문 문단 뒤에 추가합니다. 원본의 문단·글자 서식과 선택한 테두리를 참조하며, 외부 문서의 서식 병합·병합 셀·중첩 표 생성은 후속 범위입니다.</p>
  </aside></div></fieldset>;
}

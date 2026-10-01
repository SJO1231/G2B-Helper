import { useEffect, useState } from 'react';
import type { LocalDocument, PrototypeServices, PrototypeTemplate } from '../bookmarklet/contracts';
import { useUnsavedChanges } from '../bookmarklet/lifecycle';
import type { DocumentStore } from './document-store';
import { defaultTemplateProgram, renderTemplate, type TemplateProgram } from '../../plugins/template/index';
import { TemplateProgramEditor } from '../../plugins/template-ui/index';
import { download } from '../../plugins/files/index';

export function TemplatesPanel({ services,documents }: { services: PrototypeServices;documents:DocumentStore }) {
  const {listDocuments,putDocument,removeDocument}=documents;
  const [entries,setEntries]=useState<LocalDocument<PrototypeTemplate>[]>([]),[editing,setEditing]=useState<LocalDocument<PrototypeTemplate>|null>(null);
  const [name,setName]=useState('업무 메모 양식'),[body,setBody]=useState('# {{제목}}\n\n{{내용}}'),[preview,setPreview]=useState(false),[program,setProgram]=useState<TemplateProgram>(defaultTemplateProgram);
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);useUnsavedChanges(dirty);
  const report=(error:unknown)=>services.notify('실패: '+(error instanceof Error?error.message:String(error)));
  async function refresh(){try{setEntries(await listDocuments<PrototypeTemplate>('templates'));}catch(error){report(error);}}
  useEffect(()=>{void refresh();},[]);
  const values=services.selection?.values??{},fields=Object.keys(values).filter(field=>!field.startsWith('__')),columns=fields.map(field=>({field,label:field}));
  let generated={text:'',warnings:[] as string[]},problem='';
  try{generated=renderTemplate(body,values,program);}catch(error){problem=error instanceof Error?error.message:String(error);}
  const insert=(token:string)=>{setBody(previous=>previous+token);setDirty(true);};
  return <div className="two-pane"><section className="panel"><h2>텍스트·MD 템플릿</h2>
    <p className="muted">선택 레코드의 열과 JSON 경로를 연결합니다. 조건은 AND/OR로 구성하고 충족·불충족 문구를 지정할 수 있습니다.</p>
    <div className="row"><select aria-label="텍스트 템플릿 선택" value={editing?.documentId??''} onChange={event=>{if(dirty&&!confirm('저장하지 않은 템플릿 변경을 버릴까요?'))return;const entry=entries.find(candidate=>candidate.documentId===event.target.value);setEditing(entry??null);setName(entry?.value.name??'새 양식');setBody(entry?.value.body??'');setProgram(entry?.value.program??defaultTemplateProgram());setDirty(false);}}>
      <option value="">새 템플릿</option>{entries.map(entry=><option key={entry.documentId} value={entry.documentId}>{entry.value.name}</option>)}</select>
      <input aria-label="템플릿 이름" value={name} onChange={event=>{setName(event.target.value);setDirty(true);}}/>
      <button className="primary" disabled={busy} onClick={async()=>{try{setBusy(true);const value={name:name.trim(),body,program};if(!value.name)throw new Error('템플릿 이름을 입력하세요.');const saved=await putDocument('templates',editing?.documentId??crypto.randomUUID(),editing?.storeVersion??null,value);setEditing(saved);setDirty(false);await refresh();services.notify('텍스트 템플릿을 저장했습니다.');}catch(error){report(error);}finally{setBusy(false);}}}>템플릿 저장</button>
      {editing&&<button disabled={busy} onClick={async()=>{if(!confirm('이 템플릿을 삭제할까요?'))return;try{await removeDocument('templates',editing.documentId,editing.storeVersion);setEditing(null);setDirty(false);await refresh();}catch(error){report(error);}}}>삭제</button>}
    </div>
    <div className="row"><button className={!preview?'active':''} onClick={()=>setPreview(false)}>편집</button><button className={preview?'active':''} onClick={()=>setPreview(true)}>적용 미리보기</button>
      <button disabled={!!problem} onClick={()=>download(name+'.md',generated.text,'text/markdown;charset=utf-8')}>MD 다운로드</button>
      <button disabled={!!problem} onClick={async()=>{try{await navigator.clipboard.writeText(generated.text);services.notify('생성한 텍스트를 복사했습니다.');}catch(error){report(error);}}}>생성 내용 복사</button>
    </div>
    {problem&&<p role="alert" className="error">{problem}</p>}{generated.warnings.length>0&&<p className="muted">{generated.warnings.join(' · ')}</p>}
    {preview?<pre className="template-preview">{generated.text}</pre>:<textarea className="template-editor" aria-label="템플릿 본문" value={body} onChange={event=>{setBody(event.target.value);setDirty(true);}}/>}
    <TemplateProgramEditor program={program} columns={columns} onChange={value=>{setProgram(value);setDirty(true);}} onInsert={insert}/>
    <details><summary>치환 문법과 기존 기안 양식</summary><p className="muted">{'{{열 이름}}, {{JSON열.경로}}, {오늘+2}, {품명:대체:기존:변경}, {품명:1:3}, {=단가*수량}을 지원합니다. 기존 [같음:종류:물품]…[/같음], [다름:상태:취소]…[/다름]도 사용할 수 있습니다. 계산은 사칙연산만 허용합니다.'}</p></details>
  </section><section className="panel"><h2>선택 레코드의 열</h2><p className="muted">{services.selection?.datasetName??'DB에서 레코드를 먼저 선택하세요.'}</p>
    {fields.map(field=><button className="field-chip" key={field} onClick={()=>insert('{{'+field+'}}')}>{field}<small>{values[field]==null?'':typeof values[field]==='object'?JSON.stringify(values[field]):String(values[field])}</small></button>)}
  </section></div>;
}

import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { renderTemplate, validateTemplateProgram, type TemplateProgram } from '../template/index';
import { getPath } from '../core/index';
import { resourceCatalog, validateInsertion, insertionParagraph, insertionStyle, createIdAllocator, checkXmlValue, prepareInsertion, type HwpxInsertion, type HwpxResourceCatalog } from './insertion';
export type { HwpxInsertion, HwpxResourceCatalog } from './insertion';

const MAX_ZIP=50*1024*1024, MAX_EXPANDED=150*1024*1024, MAX_XML=20*1024*1024;
const PARA='http://www.hancom.co.kr/hwpml/2011/paragraph';
export interface HwpxArchive { filename:string; entries:Record<string,Uint8Array>; stored:string[]; sections:{part:string;xml:string}[]; warnings:string[]; }
export interface HwpxTarget { id:string; part:string; path:number[]; kind:'paragraph'|'table-cell'|'text'; text:string; writable:boolean; reason?:string; sectionFingerprint?:string; }
export interface HwpxAnchorBinding { id:string; name:string; target:HwpxTarget; expression:string; insertion?:HwpxInsertion; }
export interface HwpxTemplate { name:string; filename:string; masterZip?:string; baseTemplateId?:string; anchors:HwpxAnchorBinding[]; excludedAnchorIds?:string[]; program:TemplateProgram; }
const crcTable=Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes:Uint8Array):number { let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0; }

/** Inspect size, names and local/central agreement before allocating inflated payloads. */
export function inspectHwpxZip(bytes:Uint8Array):{name:string;size:number;crc:number;method:number}[] {
  if(bytes.length<22||bytes.length>MAX_ZIP)throw new Error('HWPX ZIP은 50MB 이하로 사용하세요.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),read16=(offset:number)=>view.getUint16(offset,true),read32=(offset:number)=>view.getUint32(offset,true);
  let end=-1;for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(read32(offset)===0x06054b50&&offset+22+read16(offset+20)===bytes.length){end=offset;break;}
  if(end<0)throw new Error('ZIP 끝 정보가 손상되었습니다.');
  const count=read16(end+10),directory=read32(end+16),length=read32(end+12);
  if(read16(end+4)||read16(end+6)||count!==read16(end+8)||!count||count>4000||count===65535||directory+length!==end)throw new Error('분할·ZIP64 또는 지원하지 않는 ZIP 구조입니다.');
  const entries:{name:string;size:number;crc:number;method:number}[]=[],names=new Set<string>();let cursor=directory,total=0;
  for(let index=0;index<count;index++){
    if(cursor+46>end||read32(cursor)!==0x02014b50)throw new Error('ZIP 항목 정보가 손상되었습니다.');
    const flags=read16(cursor+8),method=read16(cursor+10),compressed=read32(cursor+20),size=read32(cursor+24),nameLength=read16(cursor+28),extra=read16(cursor+30),comment=read16(cursor+32),local=read32(cursor+42);
    if(cursor+46+nameLength+extra+comment>end||size===0xffffffff||compressed===0xffffffff||local===0xffffffff||read16(cursor+34)||flags&1||![0,8].includes(method))throw new Error('암호화·ZIP64·지원하지 않는 압축 항목입니다.');
    const name=strFromU8(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(!name||names.has(name)||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.includes(':')||name.split('/').some(part=>part==='..'||part==='.')||['__proto__','constructor','prototype'].includes(name))throw new Error('ZIP에 반복되거나 잘못된 항목 경로가 있습니다.');
    if(local+30>directory||read32(local)!==0x04034b50||read16(local+8)!==method||read16(local+6)!==flags)throw new Error('ZIP 로컬 항목 정보가 일치하지 않습니다.');
    const localName=read16(local+26),localExtra=read16(local+28),start=local+30+localName+localExtra;
    if(start+compressed>directory||strFromU8(bytes.subarray(local+30,local+30+localName))!==name)throw new Error('ZIP 항목의 범위·이름이 일치하지 않습니다.');
    total+=size;if(total>MAX_EXPANDED||(/\.xml$/i.test(name)&&size>MAX_XML))throw new Error('HWPX 압축 해제 크기가 허용 범위를 넘습니다.');
    if(index===0&&name!=='mimetype')throw new Error('HWPX의 첫 항목은 mimetype이어야 합니다.');
    names.add(name);entries.push({name,size,crc:read32(cursor+16),method});cursor+=46+nameLength+extra+comment;
  }
  if(cursor!==end)throw new Error('ZIP 항목 개수와 길이가 일치하지 않습니다.');return entries;
}
export function parseHwpxXml(xml:string,part:string):XMLDocument {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error(`${part}: DTD·외부 엔터티를 포함한 XML은 지원하지 않습니다.`);
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length||!doc.documentElement)throw new Error(`${part}: XML 구문이 잘못되었습니다.`);
  if(doc.getElementsByTagName('*').length>200000)throw new Error(`${part}: XML 요소가 너무 많습니다.`);return doc;
}
function xmlText(bytes:Uint8Array):string { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
function fingerprint(text:string):string {let hash=14695981039346656037n;for(let index=0;index<text.length;index++)hash=BigInt.asUintN(64,(hash^BigInt(text.charCodeAt(index)))*1099511628211n);return hash.toString(16).padStart(16,'0');}
function elements(root:Element,name:string):Element[] { return Array.from(root.getElementsByTagNameNS('*',name)); }
function isPara(node:Element,name:string):boolean { return node.localName===name&&node.namespaceURI===PARA; }
function paragraphText(paragraph:Element):string {
  const walk=(node:Node):string=>node.nodeType===Node.TEXT_NODE?node.nodeValue??'':node instanceof Element?isPara(node,'p')&&node!==paragraph?'':isPara(node,'tab')?'\t':isPara(node,'lineBreak')?'\n':Array.from(node.childNodes).map(walk).join(''):'';
  return Array.from(paragraph.children).filter(node=>isPara(node,'run')).map(run=>Array.from(run.children).filter(node=>isPara(node,'t')).map(walk).join('')).join('');
}
function pathOf(node:Element,root:Element):number[]{const path:number[]=[];let current=node;while(current!==root){const parent=current.parentElement;if(!parent)throw new Error('XML 위치의 부모가 없습니다.');path.unshift(Array.from(parent.children).indexOf(current));current=parent;}return path;}
function atPath(root:Element,path:number[]):Element { let node=root;for(const index of path){if(!Number.isInteger(index)||index<0||!node.children[index])throw new Error('앵커의 XML 위치가 달라졌습니다.');node=node.children[index];}return node; }
function targetText(node:Element,kind:HwpxTarget['kind']):string { return kind==='text'?node.textContent??'':kind==='paragraph'?paragraphText(node):elements(node,'p').filter(paragraph=>paragraph.namespaceURI===PARA).map(paragraphText).join('\n'); }
function writable(node:Element,kind:HwpxTarget['kind']):string|undefined {
  if(kind==='text')return node.children.length?'탭·인라인 요소가 있는 텍스트는 직접 치환을 지원하지 않습니다.':undefined;
  if(kind==='table-cell'&&elements(node,'tbl').length)return '중첩 표가 있는 셀은 개별 문단을 선택하세요.';
  const paragraphs=kind==='paragraph'?[node]:elements(node,'p').filter(paragraph=>paragraph.namespaceURI===PARA);
  if(!paragraphs.length)return '텍스트 문단이 없는 대상입니다.';
  for(const paragraph of paragraphs){
    if(elements(paragraph,'tbl').length||elements(paragraph,'pic').length||elements(paragraph,'equation').length)return '표·그림·수식이 있는 문단은 텍스트 전용 문단을 선택하세요.';
    const runs=Array.from(paragraph.children).filter(child=>isPara(child,'run'));
    if(!runs.length||runs.some(run=>!Array.from(run.children).some(child=>isPara(child,'t'))||Array.from(run.children).some(child=>!isPara(child,'t'))))return '컨트롤이나 객체가 있는 문단은 직접 치환을 지원하지 않습니다.';
    if(runs.flatMap(run=>Array.from(run.children)).some(text=>text.children.length))return '탭·인라인 요소가 있는 텍스트는 직접 치환을 지원하지 않습니다.';
  }return undefined;
}
export function listHwpxTargets(archive:HwpxArchive):HwpxTarget[] {
  return archive.sections.flatMap(({part,xml})=>{
    const root=parseHwpxXml(xml,part).documentElement,sectionFingerprint=fingerprint(xml);
    return Array.from(root.getElementsByTagName('*')).filter(node=>isPara(node,'p')||isPara(node,'tc')||isPara(node,'t')).map(node=>{
      const path=pathOf(node,root),kind=isPara(node,'t')?'text' as const:isPara(node,'p')?'paragraph' as const:'table-cell' as const,reason=writable(node,kind);
      return {id:part+'#'+path.join('.'),part,path,kind,text:targetText(node,kind),writable:!reason,reason,sectionFingerprint};
    });
  });
}
function validationIssues(archive:HwpxArchive):Set<string> {
  const issues=new Set<string>(),header=archive.entries['Contents/header.xml'];if(!header){issues.add('header.xml 없음');return issues;}
  const root=parseHwpxXml(xmlText(header),'Contents/header.xml').documentElement,catalog=new Map<string,Set<string>>();
  for(const [attribute,kind] of [['charPrIDRef','charPr'],['paraPrIDRef','paraPr'],['styleIDRef','style'],['borderFillIDRef','borderFill']])catalog.set(attribute,new Set(elements(root,kind).map(node=>node.getAttribute('id')??'')));
  for(const section of archive.sections){
    const doc=parseHwpxXml(section.xml,section.part),ids=new Set<string>();
    for(const node of Array.from(doc.getElementsByTagName('*'))){
      if(isPara(node,'p')){const id=node.getAttribute('id');if(id&&ids.has(id))issues.add(`${section.part}: 문단 id 중복 ${id}`);if(id)ids.add(id);}
      for(const [attribute,values] of catalog){const ref=node.getAttribute(attribute);if(ref!==null&&!values.has(ref))issues.add(`${section.part}: ${attribute}=${ref} 참조 없음`);}
      if(isPara(node,'tbl')){const rows=Array.from(node.children).filter(child=>isPara(child,'tr')),count=Number(node.getAttribute('rowCnt'));if(Number.isFinite(count)&&count!==rows.length)issues.add(`${section.part}: 표 행 수 불일치`);}
    }
  }return issues;
}
export function openHwpx(bytes:Uint8Array,filename:string):HwpxArchive {
  const infos=inspectHwpxZip(bytes),entries=unzipSync(bytes);
  for(const info of infos){const content=entries[info.name];if(!content||content.length!==info.size||crc32(content)!==info.crc)throw new Error(`${info.name}: 압축 크기·CRC 검증에 실패했습니다.`);}
  if(strFromU8(entries.mimetype)!=='application/hwp+zip')throw new Error('HWPX mimetype이 다릅니다.');
  const sections=Object.keys(entries).filter(name=>/^Contents\/section\d+\.xml$/i.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(part=>({part,xml:xmlText(entries[part])}));
  if(!sections.length)throw new Error('Contents/section*.xml이 없습니다.');
  for(const section of sections){const root=parseHwpxXml(section.xml,section.part).documentElement;if(root.localName!=='sec'||!root.namespaceURI?.includes('hancom.co.kr/hwpml/'))throw new Error('지원하는 HWPX section XML이 아닙니다.');}
  const archive:HwpxArchive={filename,entries,stored:infos.filter(info=>info.method===0).map(info=>info.name),sections,warnings:[]};
  archive.warnings=[...validationIssues(archive)].slice(0,40).map(issue=>'원본 검사: '+issue);return archive;
}
export function renderHwpxStructure(archive:HwpxArchive,onSelect?:(target:HwpxTarget)=>void):HTMLElement {
  const view=document.createElement('div');view.className='hwpx-structure';const targets=new Map(listHwpxTargets(archive).map(target=>[target.id,target]));
  for(const section of archive.sections){
    const root=parseHwpxXml(section.xml,section.part).documentElement,article=document.createElement('article'),heading=document.createElement('h3');heading.textContent=section.part;article.append(heading);
    function show(node:Element):HTMLElement|undefined {
      const target=targets.get(section.part+'#'+pathOf(node,root).join('.'));
      if(isPara(node,'tbl')){const table=document.createElement('table');for(const row of Array.from(node.children).filter(child=>isPara(child,'tr'))){const tr=document.createElement('tr');for(const cell of Array.from(row.children).filter(child=>isPara(child,'tc'))){const td=show(cell);if(td)tr.append(td);}table.append(tr);}return table;}
      if(isPara(node,'tc')){const cell=document.createElement('td'),span=elements(node,'cellSpan')[0];cell.colSpan=Math.max(1,Math.min(100,Number(span?.getAttribute('colSpan'))||1));cell.rowSpan=Math.max(1,Math.min(100,Number(span?.getAttribute('rowSpan'))||1));if(target&&onSelect){const select=document.createElement('button');select.className='hwpx-cell-selector';select.textContent='셀 선택';select.addEventListener('click',event=>{event.stopPropagation();onSelect(target);});cell.append(select);}for(const child of Array.from(node.children)){const shown=show(child);if(shown)cell.append(shown);}if(target)decorate(cell,target);return cell;}
      if(isPara(node,'p')){const paragraph=document.createElement('div');paragraph.className='hwpx-paragraph';for(const run of Array.from(node.children).filter(child=>isPara(child,'run')))for(const textNode of Array.from(run.children).filter(child=>isPara(child,'t'))){const text=document.createElement('span');text.textContent=textNode.textContent||'\u00a0';const textTarget=targets.get(section.part+'#'+pathOf(textNode,root).join('.'));if(textTarget)decorate(text,textTarget);paragraph.append(text);}if(!paragraph.childElementCount)paragraph.append(document.createTextNode('\u00a0'));for(const table of elements(node,'tbl').filter(table=>!table.parentElement?.closest('tbl')||table.parentElement.closest('tbl')===node)){const shown=show(table);if(shown)paragraph.append(shown);}const unsupported=['pic','equation','rect','ellipse','ole'].filter(kind=>elements(node,kind).length);if(unsupported.length){const note=document.createElement('small');note.textContent='[객체: '+unsupported.join(', ')+']';paragraph.append(note);}if(target)decorate(paragraph,target);return paragraph;}
      const group=document.createElement('div');for(const child of Array.from(node.children)){const shown=show(child);if(shown)group.append(shown);}return group.childElementCount?group:undefined;
    }
    function decorate(element:HTMLElement,target:HwpxTarget){element.dataset.hwpxTarget=target.id;element.classList.add('hwpx-target');element.title=(target.kind==='table-cell'?'표 셀':target.kind==='text'?'텍스트 구간':'문단')+(target.reason?' · '+target.reason:' · 클릭해서 앵커 지정');if(onSelect){element.tabIndex=0;element.addEventListener('click',event=>{event.stopPropagation();onSelect(target);});element.addEventListener('keydown',event=>{if(event.key==='Enter'){event.stopPropagation();onSelect(target);}});}}
    for(const child of Array.from(root.children)){const shown=show(child);if(shown)article.append(shown);}view.append(article);
  }return view;
}
export function getHwpxResources(archive:HwpxArchive):HwpxResourceCatalog {
  const header=archive.entries['Contents/header.xml'];if(!header)throw new Error('문서 서식 자원 header.xml이 없습니다.');return resourceCatalog(parseHwpxXml(xmlText(header),'Contents/header.xml').documentElement);
}
export function applyHwpxReplacements(archive:HwpxArchive,replacements:{target:HwpxTarget;value:string}[]):HwpxArchive { return applyHwpxEdits(archive,replacements); }
interface HwpxEdit {target:HwpxTarget;value:string;insertion?:HwpxInsertion;tableRows?:string[][];}
function applyHwpxEdits(archive:HwpxArchive,replacements:HwpxEdit[],validateOnly=false):HwpxArchive {
  if(replacements.length>1000)throw new Error('앵커는 1,000개 이하로 적용하세요.');
  const documents=new Map(archive.sections.map(section=>[section.part,parseHwpxXml(section.xml,section.part)])),resolved:(HwpxEdit&{node:Element;addition?:Element[]})[]=[];
  const signatures=new Map(archive.sections.map(section=>[section.part,fingerprint(section.xml)])),allocateId=createIdAllocator(documents.values());
  let generatedElements=0,outputCharacters=0;
  for(const edit of replacements){const {target,value,insertion,tableRows}=edit;
    checkXmlValue(value);outputCharacters+=value.length+(tableRows??[]).reduce((sum,row)=>sum+row.reduce((length,cell)=>length+cell.length,0),0);if(outputCharacters>8*1024*1024)throw new Error('한 문서의 새 출력은 8MB 이하로 사용하세요.');
    const doc=documents.get(target.part);if(!doc)throw new Error('앵커 section이 없습니다.');const node=atPath(doc.documentElement,target.path);
    if(target.sectionFingerprint&&target.sectionFingerprint!==signatures.get(target.part))throw new Error('앵커의 원본 section이 변경되었습니다. 위치와 서식을 다시 지정하세요.');
    if(!isPara(node,target.kind==='text'?'t':target.kind==='paragraph'?'p':'tc')||targetText(node,target.kind)!==target.text)throw new Error('앵커 원문·종류가 달라졌습니다. 원본에서 다시 지정하세요.');
    if(insertion){
      validateInsertion(insertion);const catalog=getHwpxResources(archive);insertionStyle(node,catalog);
      if(insertion.kind==='table-after'&&!catalog.borderFill.includes(insertion.borderFillId))throw new Error('표 테두리 자원이 원본에 없습니다.');
      const addition=validateOnly?[]:prepareInsertion(node,insertion,catalog,allocateId,value,tableRows);
      generatedElements+=addition.reduce((sum,element)=>sum+1+element.getElementsByTagName('*').length,0);if(generatedElements>100000)throw new Error('추가할 문서 구조가 너무 큽니다.');
      resolved.push({...edit,node:insertionParagraph(node),addition});continue;
    }
    const reason=writable(node,target.kind);if(reason)throw new Error(reason);
    if(resolved.some(previous=>!previous.insertion&&(previous.node===node||previous.node.contains(node)||node.contains(previous.node))))throw new Error('같은 위치 또는 부모·자식이 겹치는 앵커가 있습니다.');
    const paragraphs=target.kind==='text'||target.kind==='paragraph'?[node]:elements(node,'p').filter(paragraph=>paragraph.namespaceURI===PARA);
    if(value.includes('\n')&&value.split('\n').length!==paragraphs.length)throw new Error('줄 수를 바꾸는 치환은 별도 문단 삽입이 필요합니다. 기존 문단 수에 맞게 입력하세요.');
    resolved.push({...edit,node});
  }
  if(validateOnly)return archive;
  const changed=new Set<string>(),tails=new Map<Element,Element>();
  for(const {node,value,target,insertion,addition} of resolved){
    if(insertion){let tail=tails.get(node)??node;for(const element of addition!){tail.after(element);tail=element;changed.add(target.part);}tails.set(node,tail);continue;}
    if(target.kind==='text'){node.textContent=value;changed.add(target.part);continue;}
    const paragraphs=target.kind==='paragraph'?[node]:elements(node,'p').filter(paragraph=>paragraph.namespaceURI===PARA),lines=value.includes('\n')?value.split('\n'):[value,...paragraphs.slice(1).map(()=> '')];
    paragraphs.forEach((paragraph,index)=>{const slots=elements(paragraph,'t').filter(text=>text.namespaceURI===PARA);let cursor=0;slots.forEach((slot,position)=>{const count=[...(slot.textContent??'')].length,characters=[...lines[index]];slot.textContent=position===slots.length-1?characters.slice(cursor).join(''):characters.slice(cursor,cursor+count).join('');cursor+=count;});});changed.add(target.part);
  }
  const entries={...archive.entries},sections=archive.sections.map(section=>{
    if(!changed.has(section.part))return section;const doc=documents.get(section.part)!;
    for(const stale of Array.from(doc.getElementsByTagNameNS(PARA,'linesegarray')))stale.remove();
    const xml=new XMLSerializer().serializeToString(doc);parseHwpxXml(xml,section.part);const bytes=strToU8(xml);if(bytes.length>MAX_XML)throw new Error('생성된 본문 XML이 20MB를 초과했습니다.');entries[section.part]=bytes;return {part:section.part,xml};
  });
  const result={...archive,entries,sections,warnings:[...archive.warnings]};
  const baseline=validationIssues(archive),introduced=[...validationIssues(result)].filter(issue=>!baseline.has(issue));if(introduced.length)throw new Error('치환으로 새 문서 오류가 발생했습니다: '+introduced.join('; '));
  if(changed.size){result.warnings.push('수정한 section의 배치 캐시를 제거했습니다. 한글에서 열면 문단 배치가 다시 계산됩니다.');if(Object.keys(entries).some(part=>part.startsWith('Preview/')))result.warnings.push('패키지의 기존 미리보기 이미지는 원본입니다. 생성 문서를 한글에서 다시 저장하면 미리보기가 갱신됩니다.');}return result;
}
export function exportHwpx(archive:HwpxArchive):Uint8Array {
  const zip:Zippable={mimetype:[archive.entries.mimetype,{level:0}]};for(const [name,bytes] of Object.entries(archive.entries))if(name!=='mimetype')zip[name]=[bytes,{level:archive.stored.includes(name)?0:6}];
  const output=zipSync(zip,{mtime:new Date(1980,0,1)});openHwpx(output,archive.filename);return output;
}
export function generateHwpx(archive:HwpxArchive,anchors:HwpxAnchorBinding[],values:Record<string,unknown>,program:TemplateProgram):{archive:HwpxArchive;warnings:string[]} {
  const warnings:string[]=[];let characters=0;
  const render=(expression:string,context:Record<string,unknown>,name:string)=>{const result=renderTemplate(expression,context,program);characters+=result.text.length;if(characters>8*1024*1024)throw new Error('한 문서의 새 출력은 8MB 이하로 사용하세요.');warnings.push(...result.warnings.map(warning=>name+': '+warning));return result.text;};
  const edits=anchors.map(anchor=>{
    if(anchor.insertion?.kind==='table-after'){
      validateInsertion(anchor.insertion);const {rowsPath,columns}=anchor.insertion,rows=getPath(values,rowsPath);
      if(!Array.isArray(rows))throw new Error(anchor.name+': 선택한 경로가 JSON 배열이 아닙니다.');
      if(rows.length>1000)throw new Error('표 자료는 1,000행 이하로 사용하세요.');
      if(!rows.length)warnings.push(anchor.name+': 빈 배열이므로 표를 추가하지 않았습니다.');
      const tableRows=rows.map(row=>columns.map(column=>render(column.expression,{...values,row},anchor.name)));
      return {target:anchor.target,value:'',insertion:anchor.insertion,tableRows};
    }
    return {target:anchor.target,value:render(anchor.expression,values,anchor.name),insertion:anchor.insertion};
  });
  return {archive:applyHwpxEdits(archive,edits),warnings:[...new Set(warnings)]};
}
export function bytesToBase64(bytes:Uint8Array):string {let text='';for(let start=0;start<bytes.length;start+=32768)text+=String.fromCharCode(...bytes.subarray(start,start+32768));return btoa(text);}
export function base64ToBytes(text:string):Uint8Array {if(text.length>Math.ceil(MAX_ZIP/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text)||text.length%4)throw new Error('HWPX 저장 파일의 Base64 형식이 잘못되었습니다.');const decoded=atob(text);return Uint8Array.from(decoded,char=>char.charCodeAt(0));}
export function validateHwpxTemplate(template:HwpxTemplate):void {
  if(!template||typeof template.name!=='string'||!template.name.trim()||typeof template.filename!=='string'||!Array.isArray(template.anchors)||template.anchors.length>1000)throw new Error('HWPX 템플릿 형식을 확인하세요.');
  if((typeof template.masterZip==='string')===(typeof template.baseTemplateId==='string')||template.baseTemplateId==='')throw new Error('HWPX 마스터 또는 파생 원본을 하나 지정하세요.');
  if(template.masterZip!==undefined){const bytes=base64ToBytes(template.masterZip);inspectHwpxZip(bytes);if(typeof DOMParser!=='undefined')openHwpx(bytes,template.filename);}validateTemplateProgram(template.program);
  if(template.excludedAnchorIds!==undefined&&(!Array.isArray(template.excludedAnchorIds)||template.excludedAnchorIds.some(id=>typeof id!=='string')||new Set(template.excludedAnchorIds).size!==template.excludedAnchorIds.length))throw new Error('파생 템플릿의 제외 앵커 목록을 확인하세요.');
  const ids=new Set<string>();for(const anchor of template.anchors){const target=anchor?.target;if(!anchor||typeof anchor.id!=='string'||!anchor.id||ids.has(anchor.id)||typeof anchor.name!=='string'||!anchor.name.trim()||typeof anchor.expression!=='string'||!target||typeof target.part!=='string'||typeof target.id!=='string'||!['paragraph','table-cell','text'].includes(target.kind)||typeof target.text!=='string'||typeof target.writable!=='boolean'||(target.sectionFingerprint!==undefined&&!/^[0-9a-f]{16}$/.test(target.sectionFingerprint))||!Array.isArray(target.path)||target.path.length>100||target.path.some(index=>!Number.isSafeInteger(index)||index<0))throw new Error('HWPX 앵커 이름·위치·출력을 확인하세요.');if(anchor.insertion)validateInsertion(anchor.insertion);ids.add(anchor.id);}
  if(template.masterZip!==undefined&&typeof DOMParser!=='undefined')validateResolvedHwpxTemplate(template);
}
export function validateResolvedHwpxTemplate(template:HwpxTemplate):void {
  if(!template.masterZip)throw new Error('HWPX 마스터 파일이 없습니다.');
  const archive=openHwpx(base64ToBytes(template.masterZip),template.filename);
  applyHwpxEdits(archive,template.anchors.map(anchor=>({target:anchor.target,value:anchor.insertion?'':anchor.target.text,insertion:anchor.insertion})),true);
}
export function resolveHwpxTemplate(documentId:string,entries:{documentId:string;storeVersion:number;value:HwpxTemplate}[]):{template:HwpxTemplate;versions:string} {
  const visiting=new Set<string>(),versions:string[]=[];
  function resolve(id:string):HwpxTemplate {
    if(visiting.has(id)||visiting.size>20)throw new Error('HWPX 파생 템플릿이 순환하거나 너무 깊습니다.');
    const entry=entries.find(candidate=>candidate.documentId===id);if(!entry)throw new Error('HWPX 파생 템플릿의 원본이 없습니다.');visiting.add(id);versions.push(id+':'+entry.storeVersion);
    const value=entry.value;let result=value;
    if(value.baseTemplateId){const base=resolve(value.baseTemplateId),anchors=new Map(base.anchors.map(anchor=>[anchor.id,anchor]));for(const id of value.excludedAnchorIds??[])anchors.delete(id);for(const anchor of value.anchors)anchors.set(anchor.id,anchor);result={...value,masterZip:base.masterZip,anchors:[...anchors.values()]};}
    visiting.delete(id);return result;
  }
  return {template:resolve(documentId),versions:versions.sort().join('|')};
}

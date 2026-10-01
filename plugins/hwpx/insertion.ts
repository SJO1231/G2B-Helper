/** Declarative additions use resources already present in the same HWPX package. */
export type HwpxInsertion = {kind:'paragraphs-after'} | {
  kind:'table-after'; rowsPath:string[]; columns:{heading:string;expression:string}[];
  widthMm:number; rowHeightMm:number; borderFillId:string; includeHeader:boolean;
};
export interface HwpxResourceCatalog { paraPr:string[]; charPr:string[]; style:string[]; borderFill:string[]; }
const PARA='http://www.hancom.co.kr/hwpml/2011/paragraph';
const HEAD='http://www.hancom.co.kr/hwpml/2011/head';
const matches=(element:Element,name:string)=>element.namespaceURI===PARA&&element.localName===name;
export function resourceCatalog(root:Element):HwpxResourceCatalog {
  return Object.fromEntries(['paraPr','charPr','style','borderFill'].map(kind=>[kind,Array.from(root.getElementsByTagNameNS(HEAD,kind)).map(element=>element.getAttribute('id')??'').filter(Boolean)])) as unknown as HwpxResourceCatalog;
}
export function validateInsertion(insertion:HwpxInsertion):void {
  if(!insertion||!['paragraphs-after','table-after'].includes(insertion.kind))throw new Error('지원하지 않는 HWPX 삽입 방식입니다.');
  if(insertion.kind==='paragraphs-after')return;
  if(!Array.isArray(insertion.rowsPath)||!insertion.rowsPath.length||insertion.rowsPath.length>30||insertion.rowsPath.some(segment=>typeof segment!=='string'||!segment||['__proto__','constructor','prototype'].includes(segment)))throw new Error('표에 넣을 JSON 배열 경로를 지정하세요.');
  if(!Array.isArray(insertion.columns)||!insertion.columns.length||insertion.columns.length>30||insertion.columns.some(column=>!column||typeof column.heading!=='string'||typeof column.expression!=='string'||column.heading.length>1000||column.expression.length>100000))throw new Error('표의 제목과 출력식은 1~30열로 지정하세요.');
  if(!Number.isFinite(insertion.widthMm)||insertion.widthMm<10||insertion.widthMm>500||!Number.isFinite(insertion.rowHeightMm)||insertion.rowHeightMm<1||insertion.rowHeightMm>100||typeof insertion.borderFillId!=='string'||!insertion.borderFillId||typeof insertion.includeHeader!=='boolean')throw new Error('표 너비·행 높이·테두리 자원을 확인하세요.');
}
export function insertionParagraph(node:Element):Element {
  let paragraph:Element|null=node;
  while(paragraph&&!matches(paragraph,'p'))paragraph=paragraph.parentElement;
  if(!paragraph||paragraph.parentElement?.localName!=='sec')throw new Error('새 문단·표 삽입은 본문 최상위 문단을 선택하세요. 표 안의 위치는 지원하지 않습니다.');
  return paragraph;
}
export function insertionStyle(node:Element,catalog:HwpxResourceCatalog):{paraPrIDRef:string;styleIDRef:string;charPrIDRef:string} {
  const paragraph=insertionParagraph(node),run=Array.from(paragraph.children).find(element=>matches(element,'run'));
  const style={paraPrIDRef:paragraph.getAttribute('paraPrIDRef')??'',styleIDRef:paragraph.getAttribute('styleIDRef')??'',charPrIDRef:run?.getAttribute('charPrIDRef')??''};
  for(const [attribute,kind] of [['paraPrIDRef','paraPr'],['styleIDRef','style'],['charPrIDRef','charPr']] as const)if(!catalog[kind].includes(style[attribute]))throw new Error(`선택 문단의 ${attribute}가 원본 자원에 없습니다.`);
  return style;
}
export function createIdAllocator(documents:Iterable<XMLDocument>):()=>string {
  const used=new Set<string>();
  for(const document of documents)for(const element of Array.from(document.getElementsByTagName('*')))for(const attribute of ['id','instid']){const value=element.getAttribute(attribute);if(value!==null)used.add(/^\d+$/.test(value)?BigInt(value).toString():value);}
  let candidate=1;return()=>{while(used.has(String(candidate)))candidate++;if(candidate>0xffffffff)throw new Error('문서 식별자 범위를 초과했습니다.');const id=String(candidate++);used.add(id);return id;};
}
export function checkXmlValue(value:string):void {
  if(typeof value!=='string'||value.length>4*1024*1024||/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))throw new Error('출력 값의 크기 또는 XML 문자를 확인하세요.');
}
export function prepareInsertion(node:Element,insertion:HwpxInsertion,catalog:HwpxResourceCatalog,allocateId:()=>string,value:string,tableRows:string[][]=[]):Element[] {
  validateInsertion(insertion);const style=insertionStyle(node,catalog),document=node.ownerDocument;
  const make=(name:string,attributes:Record<string,string|number>={})=>{const element=document.createElementNS(PARA,'hp:'+name);for(const [key,value]of Object.entries(attributes))element.setAttribute(key,String(value));return element;};
  const paragraph=(text:string)=>{checkXmlValue(text);const p=make('p',{id:allocateId(),paraPrIDRef:style.paraPrIDRef,styleIDRef:style.styleIDRef,pageBreak:0,columnBreak:0,merged:0}),run=make('run',{charPrIDRef:style.charPrIDRef}),t=make('t');t.textContent=text;run.append(t);p.append(run);return p;};
  if(insertion.kind==='paragraphs-after'){checkXmlValue(value);if(!value)return [];const lines=value.replace(/\r\n?/g,'\n').split('\n');if(lines.length>1000)throw new Error('한 앵커에 추가할 문단은 1,000개 이하로 사용하세요.');return lines.map(paragraph);}
  if(!catalog.borderFill.includes(insertion.borderFillId))throw new Error('표 테두리 자원이 원본에 없습니다.');
  if(tableRows.length>1000||tableRows.some(row=>row.length!==insertion.columns.length))throw new Error('표는 1,000행 이하이며 지정 열 수가 같아야 합니다.');
  if(!tableRows.length)return [];
  const rows=insertion.includeHeader?[insertion.columns.map(column=>column.heading),...tableRows]:tableRows;
  if(rows.length*insertion.columns.length>10000||rows.reduce((sum,row)=>sum+row.reduce((total,text)=>total+text.split(/\r\n?|\n/).length,0),0)>10000)throw new Error('새 표는 셀과 문단 각각 10,000개 이하로 사용하세요.');
  const width=Math.round(insertion.widthMm*7200/25.4),height=Math.round(insertion.rowHeightMm*7200/25.4),host=paragraph(''),run=host.firstElementChild!;
  const table=make('tbl',{id:allocateId(),zOrder:0,numberingType:'TABLE',textWrap:'TOP_AND_BOTTOM',textFlow:'BOTH_SIDES',lock:0,dropcapstyle:'None',pageBreak:'CELL',repeatHeader:insertion.includeHeader?1:0,rowCnt:rows.length,colCnt:insertion.columns.length,cellSpacing:0,borderFillIDRef:insertion.borderFillId,noAdjust:0});
  table.append(make('sz',{width,widthRelTo:'ABSOLUTE',height:height*rows.length,heightRelTo:'ABSOLUTE',protect:0}),make('pos',{treatAsChar:1,affectLSpacing:0,flowWithText:1,allowOverlap:0,holdAnchorAndSO:0,vertRelTo:'PARA',horzRelTo:'COLUMN',vertAlign:'TOP',horzAlign:'LEFT',vertOffset:0,horzOffset:0}),make('outMargin',{left:0,right:0,top:0,bottom:0}),make('inMargin',{left:100,right:100,top:50,bottom:50}));
  rows.forEach((row,rowIndex)=>{const tr=make('tr');row.forEach((text,columnIndex)=>{
    const tc=make('tc',{name:'',header:insertion.includeHeader&&rowIndex===0?1:0,hasMargin:1,protect:0,editable:0,dirty:0,borderFillIDRef:insertion.borderFillId});
    const sub=make('subList',{id:'',textDirection:'HORIZONTAL',lineWrap:'BREAK',vertAlign:'TOP',linkListIDRef:0,linkListNextIDRef:0,textWidth:0,textHeight:0,hasTextRef:0,hasNumRef:0});
    checkXmlValue(text);const lines=text.replace(/\r\n?/g,'\n').split('\n');if(lines.length>1000)throw new Error('셀 문단 수가 너무 많습니다.');sub.append(...lines.map(paragraph));
    const cellWidth=Math.floor(width*(columnIndex+1)/row.length)-Math.floor(width*columnIndex/row.length);
    tc.append(sub,make('cellAddr',{colAddr:columnIndex,rowAddr:rowIndex}),make('cellSpan',{colSpan:1,rowSpan:1}),make('cellSz',{width:cellWidth,height}),make('cellMargin',{left:100,right:100,top:50,bottom:50}));tr.append(tc);
  });table.append(tr);});
  run.replaceChildren(table,make('t'));return [host];
}

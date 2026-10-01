import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {zipSync,strToU8} from 'fflate';

await mkdir('artifacts',{recursive:true});
const report={startedAt:new Date().toISOString(),checks:[],errors:[],runtime:'Edge headless; declarative HWPX insertion and actual bookmarklet UI; no Hangul rendering claim'};
report.bookmarkletSha256=createHash('sha256').update(await readFile('dist/bookmarklet/pce-bookmarklet.js')).digest('hex');
const header='<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"><hh:charProperties><hh:charPr id="0"/><hh:charPr id="1"/></hh:charProperties><hh:paraProperties><hh:paraPr id="0"/></hh:paraProperties><hh:styles><hh:style id="0"/></hh:styles><hh:borderFills><hh:borderFill id="1"/></hh:borderFills></hh:head>';
const p=(id,text)=>`<hp:p id="${id}" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>`;
const section=`<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${p('0','같은 문구')}${p('1','같은 문구')}${p('2','마지막 문단')}</hs:sec>`;
const fixture=zipSync({mimetype:[strToU8('application/hwp+zip'),{level:0}],'Contents/header.xml':strToU8(header),'Contents/section0.xml':strToU8(section),'Contents/section1.xml':strToU8(section.replaceAll('id="0"','id="10"').replaceAll('id="1"','id="11"').replaceAll('id="2"','id="12"')),'BinData/unchanged.bin':new Uint8Array([0,255,1]),'META-INF/container.xml':strToU8('<container/>')},{level:0});
const kit=await build({stdin:{contents:"import * as hwpx from '../../plugins/hwpx/index';import * as storage from './storage';import * as model from './dataset-model';import * as template from '../../plugins/template/index';window.pceInsertionTest={...hwpx,...storage,...model,...template};",resolveDir:path.resolve('apps/bookmarklet'),sourcefile:'insertion-test-kit.ts'},bundle:true,platform:'browser',format:'iife',write:false});
const demo=await readFile('dist/bookmarklet/demo.html'),server=createServer((request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.end(demo);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,page;
const encoded=Buffer.from(fixture).toString('base64');
try{
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(15000);page.on('dialog',dialog=>dialog.accept());page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#run').click();await page.getByRole('dialog',{name:'PCE 올인원 프로토타입',exact:true}).waitFor();await page.addScriptTag({content:kit.outputFiles[0].text});
  const result=await page.evaluate(async encoded=>{
    const api=pceInsertionTest,source=api.openHwpx(api.base64ToBytes(encoded),'structure.hwpx'),program=api.defaultTemplateProgram(),targets=api.listHwpxTargets(source).filter(target=>target.part==='Contents/section0.xml'&&target.kind==='paragraph'),[first,second,last]=targets;
    const insertion={kind:'table-after',rowsPath:['품목'],columns:[{heading:'코드',expression:'{{row.코드}}'},{heading:'금액',expression:'{=[row.단가]*[row.수량]}'},{heading:'확인',expression:'{{row.확인}}'}],widthMm:160,rowHeightMm:8,borderFillId:'1',includeHeader:true};
    const values={품목:[{코드:'0001',단가:'35608652.5',수량:'3',확인:false},{코드:'0002',단가:'2.5',수량:0,확인:0}]};
    const anchors=[{id:'a',name:'앞 문단',target:first,expression:'새 문단 A\n새 문단 B',insertion:{kind:'paragraphs-after'}},{id:'b',name:'같은 위치 추가',target:first,expression:'새 문단 C',insertion:{kind:'paragraphs-after'}},{id:'c',name:'뒷 문단',target:second,expression:'둘째만 변경'},{id:'d',name:'배열 표',target:last,expression:'',insertion}];
    const generated=api.generateHwpx(source,anchors,values,program).archive,reopened=api.openHwpx(api.exportHwpx(generated),'generated.hwpx'),doc=api.parseHwpxXml(reopened.sections[0].xml,'section0'),ns='http://www.hancom.co.kr/hwpml/2011/paragraph',table=doc.getElementsByTagNameNS(ns,'tbl')[0],rowNodes=[...table.getElementsByTagNameNS(ns,'tr')],cells=rowNodes.map(row=>[...row.getElementsByTagNameNS(ns,'tc')].map(cell=>({text:[...cell.getElementsByTagNameNS(ns,'t')].map(text=>text.textContent).join('\n'),row:cell.getElementsByTagNameNS(ns,'cellAddr')[0].getAttribute('rowAddr'),col:cell.getElementsByTagNameNS(ns,'cellAddr')[0].getAttribute('colAddr'),width:Number(cell.getElementsByTagNameNS(ns,'cellSz')[0].getAttribute('width')),order:[...cell.children].map(child=>child.localName)})));
    const ids=reopened.sections.flatMap(section=>[...api.parseHwpxXml(section.xml,section.part).getElementsByTagName('*')].filter(element=>element.localName==='p'||element.localName==='tbl').map(element=>element.getAttribute('id')));
    const errors={};const failure=(name,callback)=>{try{callback();errors[name]='accepted';}catch(error){errors[name]=error.message;}};
    const one=override=>[{...anchors[3],...override}];
    failure('badResource',()=>api.generateHwpx(source,one({insertion:{...insertion,borderFillId:'missing'}}),values,program));
    failure('badWidth',()=>api.generateHwpx(source,one({insertion:{...insertion,widthMm:0}}),values,program));
    failure('badArray',()=>api.generateHwpx(source,one({}),{품목:{}},program));
    failure('tooManyRows',()=>api.generateHwpx(source,one({}),{품목:Array.from({length:1001},()=>({}))},program));
    failure('illegalXml',()=>api.generateHwpx(source,[{...anchors[0],expression:'\u0001'}],values,program));
    failure('tooManyParagraphs',()=>api.generateHwpx(source,[{...anchors[0],expression:'x\n'.repeat(1001)}],values,program));
    failure('staleSection',()=>api.generateHwpx({...source,sections:source.sections.map(section=>section.part===first.part?{...section,xml:section.xml.replace('charPrIDRef="0"','charPrIDRef="1"')}:section)},[anchors[0]],values,program));
    const nested=api.listHwpxTargets(reopened).find(target=>target.kind==='text'&&target.text==='0001');
    failure('nestedInsertion',()=>api.generateHwpx(reopened,[{...anchors[0],target:nested}],values,program));
    const empty=api.generateHwpx(source,[anchors[0],anchors[3]],{품목:[]},program),skip=api.generateHwpx(source,[{...anchors[0],expression:'[같음:표시:예]조건 문단[/같음]'}],{표시:'아니오'},program);
    const unchanged=Object.entries(source.entries).filter(([name])=>name!=='Contents/section0.xml').every(([name,bytes])=>bytes.length===reopened.entries[name].length&&bytes.every((byte,index)=>byte===reopened.entries[name][index]));
    const master=await api.putDocument('hwpx-templates','guard-master',null,{name:'관계 마스터',filename:'structure.hwpx',masterZip:encoded,anchors:[],program});
    const child=await api.putDocument('hwpx-templates','guard-child',null,{name:'관계 파생',filename:'structure.hwpx',baseTemplateId:master.documentId,anchors:[],program},[{documentId:master.documentId,storeVersion:master.storeVersion}]);
    await api.putDocument('hwpx-templates','guard-grandchild',null,{name:'관계 손자',filename:'structure.hwpx',baseTemplateId:child.documentId,anchors:[anchors[0]],program},[{documentId:child.documentId,storeVersion:child.storeVersion},{documentId:master.documentId,storeVersion:master.storeVersion}]);
    const before=JSON.stringify(await api.exportPrototypeBackup());
    const changed=api.applyHwpxReplacements(source,[{target:last,value:'마스터 본문 변경'}]);let descendantError='';
    try{await api.putDocument('hwpx-templates',master.documentId,master.storeVersion,{...master.value,masterZip:api.bytesToBase64(api.exportHwpx(changed))});}catch(error){descendantError=error.message;}
    const after=JSON.stringify(await api.exportPrototypeBackup());
    // exportedAt is intentionally excluded from the state comparison.
    const state=text=>{const parsed=JSON.parse(text);delete parsed.exportedAt;return JSON.stringify(parsed);};
    return {text:[...doc.documentElement.children].slice(0,6).map(paragraph=>[...paragraph.getElementsByTagNameNS(ns,'t')].map(text=>text.textContent).join('')),cells,tableRows:table.getAttribute('rowCnt'),tableColumns:table.getAttribute('colCnt'),width:Number(table.getElementsByTagNameNS(ns,'sz')[0].getAttribute('width')),uniqueIds:new Set(ids).size===ids.length,unchanged,sourceIntact:source.sections[0].xml.includes('마지막 문단')&&!source.sections[0].xml.includes('새 문단 A'),deterministic:api.generateHwpx(source,anchors,values,program).archive.sections[0].xml===generated.sections[0].xml,errors,emptyTableCount:api.listHwpxTargets(empty.archive).filter(target=>target.kind==='table-cell').length,skipUnchanged:skip.archive.sections[0].xml===source.sections[0].xml,descendantError,rollback:state(before)===state(after),cacheGone:!reopened.sections[0].xml.includes('linesegarray')};
  },encoded);
  assert.deepEqual(result.text,['같은 문구','새 문단 A','새 문단 B','새 문단 C','둘째만 변경','마지막 문단']);assert.equal(result.uniqueIds,true);assert.equal(result.deterministic,true);
  report.checks.push('all anchors resolve on the immutable source before insertion; identical text and multiple insertion order remain correct','new paragraph/table ids are unique across sections and repeated generation is deterministic');
  assert.equal(result.tableRows,'3');assert.equal(result.tableColumns,'3');assert.deepEqual(result.cells.map(row=>row.map(cell=>cell.text)),[['코드','금액','확인'],['0001','106825957.5','false'],['0002','0','0']]);
  for(const [rowIndex,row]of result.cells.entries()){assert.equal(row.reduce((sum,cell)=>sum+cell.width,0),result.width);for(const [columnIndex,cell]of row.entries()){assert.equal(cell.row,String(rowIndex));assert.equal(cell.col,String(columnIndex));assert.deepEqual(cell.order,['subList','cellAddr','cellSpan','cellSz','cellMargin']);}}
  report.checks.push('new rectangular tables have exact row/column addresses, child order, full width coverage and preserved codes, false, zero and decimals');
  assert.equal(result.unchanged,true);assert.equal(result.sourceIntact,true);assert.equal(result.cacheGone,true);assert.equal(result.emptyTableCount,0);assert.equal(result.skipUnchanged,true);
  report.checks.push('source and untouched package entries remain byte-identical; empty array and false condition add no structure');
  for(const [name,message]of Object.entries(result.errors))assert.notEqual(message,'accepted',name);report.checks.push('invalid resources, geometry, JSON source, output bounds, XML controls, stale section and nested insertion are rejected');
  assert.match(result.descendantError,/관계 손자/);assert.equal(result.rollback,true);report.checks.push('master edits that invalidate a grandchild abort the entire transaction including the store version');

  const references=['tests/fixtures/template_v1.hwpx','examples/quickstart-101/templates/구매요청서.hwpx','tests/corpus/real/form_purchase_v1.hwpx','tests/corpus/real/form_purchase_v2.hwpx','tests/corpus/real/spec_revision_2026.hwpx'];
  for(const relative of references){
    const bytes=await readFile(path.join('E:/PROGRAM/hwpxfiller/source_repo',relative));
    const checked=await page.evaluate(({encoded,filename})=>{
      const api=pceInsertionTest,source=api.openHwpx(api.base64ToBytes(encoded),filename),resources=api.getHwpxResources(source),target=api.listHwpxTargets(source).find(target=>target.kind==='paragraph'&&target.path.length===1);
      if(!target)throw new Error('본문 문단이 없습니다.');
      const anchors=[{id:'p',name:'추가 문단',target,expression:'PCE 구조 삽입 검증',insertion:{kind:'paragraphs-after'}}];
      if(resources.borderFill.length)anchors.push({id:'t',name:'추가 표',target,expression:'',insertion:{kind:'table-after',rowsPath:['rows'],columns:[{heading:'코드',expression:'{{row.코드}}'},{heading:'값',expression:'{{row.값}}'}],widthMm:120,rowHeightMm:8,borderFillId:resources.borderFill[0],includeHeader:true}});
      const generated=api.generateHwpx(source,anchors,{rows:[{코드:'0001',값:false},{코드:'0002',값:'35608652.5'}]},api.defaultTemplateProgram()).archive,reopened=api.openHwpx(api.exportHwpx(generated),filename);
      const unchanged=Object.entries(source.entries).filter(([name])=>name!==target.part).every(([name,bytes])=>bytes.length===reopened.entries[name].length&&bytes.every((byte,index)=>byte===reopened.entries[name][index]));
      return {paragraph:api.listHwpxTargets(reopened).some(target=>target.text==='PCE 구조 삽입 검증'),table:anchors.length===2,unchanged};
    },{encoded:bytes.toString('base64'),filename:path.basename(relative)});
    assert.equal(checked.paragraph,true);assert.equal(checked.unchanged,true);report.checks.push('reference structure insertion/reopen: '+relative+'; paragraph'+(checked.table?' and table':' only (no border resource)'));
  }

  await page.evaluate(()=>pceInsertionTest.createLocalDataset('구조 삽입 자료',[{문서명:'삽입 검증',품목:[{코드:'0001',단가:'35608652.5',수량:'3',확인:false,'literal.key':'DOT-01',literal:{key:'WRONG'}},{코드:'0002',단가:'2.5',수량:0,확인:0,'literal.key':'DOT-02',literal:{key:'WRONG'}}]}]));
  await page.getByRole('button',{name:'DB',exact:true}).click();await page.locator('.dataset-list button').filter({hasText:'구조 삽입 자료'}).click();await page.locator('.tabulator-cell[tabulator-field="문서명"]').first().click();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'HWPX 문서',exact:true}).click();
  await page.evaluate(()=>{const original=File.prototype.arrayBuffer;const gate=new Promise(resolve=>{window.pceReleaseFile=()=>{File.prototype.arrayBuffer=original;resolve();};});File.prototype.arrayBuffer=async function(){await gate;return original.call(this);};});
  await page.getByLabel('HWPX 원본 파일').setInputFiles({name:'structure.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from(fixture)});
  assert.equal(await page.getByLabel('HWPX 템플릿 선택').isDisabled(),true);assert.equal(await page.getByLabel('HWPX 템플릿 이름').isDisabled(),true);await page.evaluate(()=>window.pceReleaseFile());
  await page.getByTestId('prototype-status').filter({hasText:'HWPX를 열었습니다'}).waitFor();assert.equal(await page.getByLabel('HWPX 템플릿 선택').isEnabled(),true);report.checks.push('slow file reads lock template selection and editing until the active operation completes');
  await page.locator('.hwpx-paragraph').filter({hasText:'같은 문구'}).first().click();await page.getByLabel('HWPX 앵커 이름').fill('추가 문단');await page.getByLabel('HWPX 앵커 동작').selectOption('paragraphs-after');await page.getByLabel('HWPX 앵커 출력').fill('문서 {{문서명}}\n검토 완료');await page.getByRole('button',{name:'앵커 추가',exact:true}).click();
  await page.getByRole('button',{name:'같은 위치에 별도 앵커 만들기',exact:true}).click();await page.getByLabel('HWPX 앵커 이름').fill('품목 표');await page.getByLabel('HWPX 앵커 동작').selectOption('table-after');await page.getByLabel('HWPX 표 배열').selectOption(JSON.stringify(['품목']));
  await page.getByLabel('HWPX 표 2열 제목').fill('금액');await page.getByLabel('HWPX 표 2열 출력').fill('{=[row.단가]*[row.수량]}');await page.getByRole('button',{name:'앵커 추가',exact:true}).click();await page.getByLabel('HWPX 템플릿 이름').fill('구조 추가 마스터');await page.getByRole('button',{name:'HWPX 템플릿 저장',exact:true}).click();await page.getByTestId('prototype-status').filter({hasText:'HWPX 템플릿을 저장했습니다'}).waitFor();
  await page.getByRole('button',{name:'HWPX 적용 미리보기',exact:true}).click();await page.locator('.hwpx-viewer').getByText('문서 삽입 검증',{exact:true}).waitFor();await page.locator('.hwpx-viewer').getByText('106825957.5',{exact:true}).waitFor();
  await page.locator('.hwpx-viewer').getByText('DOT-01',{exact:true}).waitFor();report.checks.push('automatically mapped literal-dot JSON keys remain distinct from colliding nested paths in the generated table');
  await page.locator('.hwpx-viewer').getByText('문서 삽입 검증',{exact:true}).click();await page.getByTestId('prototype-status').filter({hasText:'원본 구조 버튼'}).waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'생성 HWPX 다운로드',exact:true}).click()]);assert.equal(download.suggestedFilename(),'구조 추가 마스터.hwpx');await download.saveAs('artifacts/hwpx-insertion-synthetic.hwpx');await page.screenshot({path:'artifacts/bookmarklet-hwpx-insertion.png',fullPage:true});
  report.checks.push('visual anchor editor saves paragraph and JSON-array table operations, previews and downloads the generated HWPX','generated preview cannot silently bind a shifted source anchor');
  const saved=await page.evaluate(async()=>{const entries=await pceInsertionTest.listDocuments('hwpx-templates');return entries.find(entry=>entry.value.name==='구조 추가 마스터');});
  await page.getByRole('button',{name:'닫기',exact:true}).click();await page.locator('#pce-bookmarklet-panel').waitFor({state:'detached'});await page.locator('#run').click();await page.getByRole('button',{name:'DB',exact:true}).click();await page.locator('.dataset-list button').filter({hasText:'구조 삽입 자료'}).click();await page.locator('.tabulator-cell[tabulator-field="문서명"]').first().click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'HWPX 문서',exact:true}).click();await page.getByLabel('HWPX 템플릿 선택').selectOption(saved.documentId);await page.getByRole('button',{name:'HWPX 적용 미리보기',exact:true}).click();await page.locator('.hwpx-viewer').getByText('106825957.5',{exact:true}).waitFor();
  assert.equal(await page.locator('.hwpx-viewer').getByText('검토 완료',{exact:true}).count(),1);report.checks.push('reopened stored insertion template regenerates once without accumulating previous output');
  assert.deepEqual(report.errors,[]);report.finishedAt=new Date().toISOString();await writeFile('artifacts/bookmarklet-hwpx-insertion-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=String(error.stack??error);if(page)await page.screenshot({path:'artifacts/bookmarklet-hwpx-insertion-failure.png',fullPage:true}).catch(()=>{});await writeFile('artifacts/bookmarklet-hwpx-insertion-verification.json',JSON.stringify(report,null,2));throw error;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}

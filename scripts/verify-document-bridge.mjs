// Synthetic development verification: real Native framed process + real Studio + real files.
// Chrome extension message delivery/capture are substituted; no user profile or operating DB is used.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),studio=path.resolve(root,'../Hwpx Studio lite');
const artifacts=path.join(root,'artifacts/document-bridge'), runDirectory=path.join(artifacts,randomUUID());fs.mkdirSync(runDirectory,{recursive:true});
const {createApp}=await import(pathToFileURL(path.join(studio,'src/server.ts')));
const {demo}=await import(pathToFileURL(path.join(studio,'src/demo.ts')));
const {parseDocument,openPackage,walkParagraphs,validateDocument}=await import(pathToFileURL(path.join(studio,'vendor/hwpx-engine/index.ts')));
const previousEvidence=path.join(artifacts,'integration.json');
if(fs.existsSync(previousEvidence)&&JSON.parse(fs.readFileSync(previousEvidence,'utf8')).passed===false)fs.copyFileSync(previousEvidence,path.join(artifacts,'failure-'+Date.now()+'.json'));
const evidence={checks:[],pageErrors:[],files:[],screenshots:[],limitation:'Synthetic documents and isolated databases. Browser extension capture/message transport substituted; real installed extension, G2B session and business template acceptance not exercised.'};
const check=async(name,fn)=>{await fn();evidence.checks.push({name,status:'passed'});console.log('PASS '+name);};
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
const close=s=>new Promise(resolve=>s?.listening?s.close(resolve):resolve());
const app=createApp(path.join(runDirectory,'studio.sqlite'));await listen(app);
const studioPort=app.address().port,base='http://127.0.0.1:'+studioPort;
const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
const outputDirectory=path.join(runDirectory,'생성 문서');
const project=demo();project.name='Helper 연결 합성 예시';
project.markdown+='\n\n번호: {{문서번호}} / 차수: {{변경차수}} / 수량: {{수량}} / 확인: {{확인값}}';
project.fields=Object.entries({사업명:'ctrtNm',계약금액:'ctrtAmt',계약방법:'method',납품장소:'place',문서번호:'ctrtNo',변경차수:'ctrtChgOrd',수량:'qty',확인값:'flag'}).map(([name,column],i)=>({id:'field-'+i,name,column,kind:'field',approved:true,format:'text',values:[],targets:[],evidence:'Synthetic integration fixture',confidence:1}));
const revision=await post('/api/save',{project});
const fields={ctrtNo:'0000123',ctrtChgOrd:'01',ctrtNm:'합성 선택 자료 A',ctrtAmt:'12345678901234567890.00001',method:'일반경쟁',place:'합성 장소',qty:0,flag:false,blank:'',중소기업:false,직접생산:false};
const other={...fields,ctrtNo:'0000999',ctrtNm:'선택하지 않은 자료 B'};
const pointInfo={areaCd:'14',depth1:'01570',depth2:'01571'};
const capture={url:'https://www.g2b.go.kr/',framePath:'top',pointInfo,tables:{계약목록:[fields,other]}};
const native=spawn(path.join(root,'.venv/Scripts/python.exe'),['-B','native/mvp_host.py','--database',path.join(runDirectory,'helper.sqlite')],{cwd:root,env:{...process.env,G2B_STUDIO_PORT:String(studioPort)},windowsHide:true,stdio:['pipe','pipe','pipe']});
let bytes=Buffer.alloc(0),pending=new Map(),nativeError='',browser,page,queue=Promise.resolve();
native.stderr.on('data',chunk=>{nativeError+=chunk;});
native.stdout.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);while(bytes.length>=4&&bytes.length>=4+bytes.readUInt32LE(0)){const size=bytes.readUInt32LE(0),reply=JSON.parse(bytes.subarray(4,4+size).toString());bytes=bytes.subarray(4+size);const waiter=pending.get(reply.requestId);if(waiter){pending.delete(reply.requestId);waiter.resolve(reply);}}});
native.on('exit',code=>{for(const p of pending.values())p.reject(new Error('Native exited '+code+' '+nativeError));pending.clear();});
const envelope=message=>{const result=queue.then(()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(message.requestId);reject(new Error('Native timeout'));},140000);pending.set(message.requestId,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});const body=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);native.stdin.write(Buffer.concat([header,body]));}));queue=result.catch(()=>{});return result;};
const rpc=async(command,payload={},requestId=randomUUID())=>{const result=await envelope({protocolVersion:1,requestId,command,payload});assert.ok(!result.error,JSON.stringify(result.error));return result.result;};
const item=values=>({stage:'contract',identity:[values.ctrtNo,values.ctrtChgOrd],fields:values,userValues:{},children:[],source:{...pointInfo,url:capture.url,framePath:'top'}});
const request=values=>({profileId:'contract-test',sourceKind:'screen',items:[item(values)]});
const text=file=>{const data=fs.readFileSync(file);assert.equal(validateDocument(data).errors.length,0);evidence.files.push({path:file,sha256:createHash('sha256').update(data).digest('hex')});return parseDocument(openPackage(data)).sections.flatMap(s=>[...walkParagraphs(s.paragraphs)].map(p=>p.logicalText)).join('\n');};
const web=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const filename=path.resolve(root,'dist/mvp-extension','.'+name);if(!filename.startsWith(path.join(root,'dist/mvp-extension')+path.sep))throw new Error('Invalid path');const data=fs.readFileSync(filename);res.writeHead(200,{'Content-Type':({'.html':'text/html','.css':'text/css','.js':'text/javascript'})[path.extname(filename)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});await listen(web);
let documentCalls=[],delayReply=0,lostReplies=0,currentCapture=capture,captureError='';
try {
 const executablePath=[chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f=>fs.existsSync(f));assert.ok(executablePath);
 browser=await chromium.launch({executablePath,headless:true});const context=await browser.newContext({viewport:{width:1250,height:900}});
 page=await context.newPage();page.on('pageerror',e=>evidence.pageErrors.push(String(e)));
 await check('Studio profile setup through its actual UI',async()=>{
  await page.goto(base);await page.getByText('Helper 연결',{exact:true}).click();
  await page.locator('#helper-profile-id').fill('contract-test');await page.locator('#helper-profile-label').fill('계약 합성 예시');
  await expect(page.locator('#helper-revision option[value="'+revision.id+'"]')).toHaveCount(1);
  await page.locator('#helper-revision').selectOption(String(revision.id));await page.locator('#helper-output-directory').fill(outputDirectory);
  await page.locator('#save-helper-profile').click();await expect(page.locator('#helper-profile-status')).toContainText('계약 합성 예시');
  await page.screenshot({path:path.join(artifacts,'studio-connection.png'),fullPage:true});evidence.screenshots.push('studio-connection.png');
 });
 let settings=await rpc('mvp.settings.read');settings.settings.documentProfiles={contract:'contract-test'};
 settings.settings.dictionary.keys.ctrtNo='보기 이름 변경';await rpc('mvp.settings.save',settings);
 await context.exposeFunction('__nativeBridge',async(message)=>{
  if(message.kind==='mvp.capture')return captureError?{error:captureError}:{result:currentCapture};
  if(message.kind==='mvp.rpc'){if(message.envelope.command==='mvp.document.generate')documentCalls.push(structuredClone(message.envelope));const response=await envelope(message.envelope);if(message.envelope.command==='mvp.document.generate'){if(delayReply)await new Promise(r=>setTimeout(r,delayReply));if(lostReplies>0){lostReplies--;throw new Error('Synthetic transport response loss');}}return response;}
  return {result:{tabId:1}};
 });
 await context.addInitScript(()=>{window.chrome={runtime:{id:'synthetic-test',sendMessage:message=>window.__nativeBridge(message)}};});
 const origin='http://127.0.0.1:'+web.address().port,grid='.shell > .grid-area .mvp-grid';
 const goto=async(mode)=>{await page.goto(origin+'/main.html?mode='+mode+'&sourceTabId=1&stage=contract');await expect(page.locator(grid+' .mvp-grid-count')).toContainText('2 / 2');};
 const selectRow=async()=>{await page.locator(grid+' .tabulator-table .tabulator-row .tabulator-cell').filter({hasText:/^0000123$/}).click();};
 const openGenerate=async()=>{await page.locator('.shell > .toolbar').getByRole('button',{name:'생성',exact:true}).click();const d=page.locator('dialog[open]');await expect(d).toContainText('서식: 계약 합성 예시');await expect(d.getByLabel('연결할 서식')).toHaveCount(0);return d;};
 const paths=async()=>fs.readdirSync(outputDirectory).filter(f=>f.endsWith('.hwpx')).map(f=>path.join(outputDirectory,f));
 let screenText;
 await check('Document entry immediately opens the recognized screen selection',async()=>{
  await page.goto(origin+'/main.html?mode=document&sourceTabId=1');
  const d=page.locator('dialog[open]');await expect(d).toContainText('서식: 계약 합성 예시');
  await expect(d.getByRole('checkbox')).toHaveCount(2);await expect(d.getByLabel('자료 1 선택',{exact:true})).toBeChecked();
  await expect(page.locator(grid)).toHaveCount(0);
  await page.screenshot({path:path.join(artifacts,'document-entry.png'),fullPage:true});
  await d.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'자료 다시 선택',exact:true}).click();await expect(page.locator('dialog[open]')).toBeVisible();
 });
 await check('Screen selection → Native → Studio → valid HWPX, no Helper DB write',async()=>{
  await goto('extract');await page.locator(grid+' .tabulator-table .tabulator-row').nth(2).locator('.tabulator-cell:not(.tabulator-row-header)').first().click();await page.locator('.shell > .toolbar').getByRole('button',{name:'생성',exact:true}).click();await expect(page.locator('.shell .status')).toContainText('선택');
  await selectRow();const d=await openGenerate();await d.getByRole('button',{name:'생성',exact:true}).dblclick();await expect(d).toContainText('1건 저장 완료',{timeout:60000});
  assert.equal(documentCalls.length,1);assert.deepEqual(documentCalls[0].payload.items[0].fields,fields);assert.equal(documentCalls[0].payload.items[0].source.url,capture.url);
  assert.deepEqual(await rpc('mvp.records',{stage:'contract'}),[]);assert.equal((await paths()).length,1);
  screenText=text((await paths())[0]);for(const value of ['12345678901234567890.00001','합성 선택 자료 A'])assert.ok(screenText.includes(value),value);
  const valueLine='번호: 0000123 / 차수: 01 / 수량: 0 / 확인: false';
  const assertValuePlacement=value=>assert.equal(value.split('\n').filter(line=>line===valueLine).length,1,'Preserve each value in its named field paragraph');
  assertValuePlacement(screenText);
  assert.throws(()=>assertValuePlacement(screenText.replace(valueLine,valueLine.replace('차수: 01','차수: 1'))),'Reject sequence coercion even when the identifier contains 01');
  assert.throws(()=>assertValuePlacement(screenText.replace(valueLine,valueLine.replace('수량: 0','수량: '))),'Reject missing zero even when the identifier contains zeros');
  assert.ok(!screenText.includes(other.ctrtNm));await page.screenshot({path:path.join(artifacts,'helper-generated.png'),fullPage:true});evidence.screenshots.push('helper-generated.png');
 });
 const observations=[fields,other].map(row=>({...item(row),rawJson:JSON.stringify({pointInfo:{...pointInfo,...row},tables:{}}),capturedAt:'2026-10-03T00:00:00Z'}));
 const preview=await rpc('mvp.preview',{observations});await rpc('mvp.apply',{observations,token:preview.token,decisions:[]});const before=await rpc('mvp.records',{stage:'contract'});
 await check('DB selection uses the same raw-key mapping and identical document content',async()=>{
  await goto('db');await selectRow();const d=await openGenerate();await d.getByRole('button',{name:'생성',exact:true}).click();await expect(d).toContainText('1건 저장 완료',{timeout:60000});
  const payload=documentCalls.at(-1).payload;assert.equal(payload.sourceKind,'db');assert.deepEqual(payload.items[0].fields,fields);
  const generated=(await paths()).find(f=>!evidence.files.some(e=>e.path===f));assert.ok(generated);assert.equal(text(generated),screenText);
  assert.deepEqual(await rpc('mvp.records',{stage:'contract'}),before);
 });
 await check('Same request replay is idempotent; changed input cannot reuse its ID',async()=>{
  const call=documentCalls[0],replayed=await envelope(call);assert.equal(replayed.result.status,'success');assert.equal((await paths()).length,2);
  const changed=structuredClone(call);changed.payload.items[0].fields.ctrtNm='변경';const reply=await envelope(changed);assert.ok(reply.error);assert.equal((await paths()).length,2);
 });
 await check('Busy dialog cannot close; lost response survives dialog reopening with the same request ID',async()=>{
  await goto('extract');await selectRow();const d=await openGenerate(),start=documentCalls.length,count=(await paths()).length;
  delayReply=500;lostReplies=2;await d.getByRole('button',{name:'생성',exact:true}).click();await expect(d.getByRole('button',{name:'닫기',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(d).toBeVisible();await expect(d.getByRole('button',{name:'같은 요청 다시 시도',exact:true})).toBeEnabled({timeout:60000});
  assert.equal(documentCalls.length,start+2);assert.equal(documentCalls[start].requestId,documentCalls[start+1].requestId);assert.equal((await paths()).length,count+1);
  await d.getByRole('button',{name:'닫기',exact:true}).click();await page.locator('.shell > .toolbar').getByRole('button',{name:'생성',exact:true}).click();
  const reopened=page.locator('dialog[open]');await expect(reopened).toContainText('이전 요청');delayReply=0;
  await reopened.getByRole('button',{name:'같은 요청 다시 시도',exact:true}).click();await expect(reopened).toContainText('1건 저장 완료',{timeout:60000});
  assert.equal(documentCalls.at(-1).requestId,documentCalls[start].requestId);assert.equal((await paths()).length,count+1);
 });
 await check('Missing profile asks once and saves the selected connection',async()=>{
  const current=await rpc('mvp.settings.read');current.settings.documentProfiles={};await rpc('mvp.settings.save',current);
  await goto('extract');await selectRow();await page.locator('.shell > .toolbar').getByRole('button',{name:'생성',exact:true}).click();const d=page.locator('dialog[open]');
  await d.getByLabel('연결할 서식').selectOption('contract-test');await d.getByRole('button',{name:'서식 연결 저장',exact:true}).click();await expect(d).toContainText('서식: 계약 합성 예시');
  assert.equal((await rpc('mvp.settings.read')).settings.documentProfiles.contract,'contract-test');
 });
 await check('Missing fields, nested data and existing destination return actionable failures',async()=>{
  const missing={...fields};delete missing.ctrtNm;
  for(const data of [missing,{...fields,nested:{value:1}}]){const result=await rpc('mvp.document.generate',request(data));assert.equal(result.status,'needs-input');assert.ok(result.results[0].message);}
  const id=randomUUID(),destination=path.join(outputDirectory,'g2b-'+createHash('sha256').update(id).digest('hex')+'-1.hwpx');fs.writeFileSync(destination,'existing user file',{flag:'wx'});
  const failed=await rpc('mvp.document.generate',request(fields),id);assert.equal(failed.status,'error');assert.equal(fs.readFileSync(destination,'utf8'),'existing user file');
  assert.deepEqual(await rpc('mvp.records',{stage:'contract'}),before);
 });
 await check('Recognized screen selection uses the common dialog and generates the same HWPX as DB',async()=>{
  await page.goto(origin+'/main.html?mode=document&sourceTabId=1');const d=page.locator('dialog[open]');await expect(d).toContainText('서식: 계약 합성 예시');
  await d.getByLabel('자료 2 선택',{exact:true}).uncheck();await d.getByLabel('자료 1 선택',{exact:true}).uncheck();await expect(d.getByRole('button',{name:'생성',exact:true})).toBeDisabled();
  await d.getByLabel('자료 1 선택',{exact:true}).check();
  await page.setViewportSize({width:420,height:650});await page.screenshot({path:path.join(artifacts,'document-entry-narrow.png'),fullPage:true});
  assert.ok(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await d.getByRole('button',{name:'생성',exact:true}).dblclick();await expect(d).toContainText('1건 저장 완료',{timeout:60000});
  const payload=documentCalls.at(-1).payload;assert.equal(payload.items.length,1);assert.deepEqual(payload.items[0].fields,fields);
  // Read the path returned for this request, rather than an arbitrary earlier retry file.
  const result=await envelope(documentCalls.at(-1));assert.equal(text(result.result.results[0].path),screenText);
  assert.deepEqual(await rpc('mvp.records',{stage:'contract'}),before);await page.setViewportSize({width:1250,height:900});
 });
 await check('Unmatched screen and capture errors open DB with a visible explanation',async()=>{
  currentCapture={...capture,pointInfo:{areaCd:'unknown',depth1:'unknown',depth2:'unknown'}};
  await page.goto(origin+'/main.html?mode=document&sourceTabId=1');await expect(page.locator('.shell > .titlebar strong')).toHaveText('DB');await expect(page.locator('.shell .status')).toContainText('DB에서 자료를 선택');
  await expect(page.locator('dialog[open]')).toHaveCount(0);await selectRow();const d=await openGenerate();await expect(d.getByRole('checkbox')).toHaveCount(1);
  await page.screenshot({path:path.join(artifacts,'document-db-selection.png'),fullPage:true});
  captureError='Synthetic capture unavailable';await page.goto(origin+'/main.html?mode=document&sourceTabId=1');await expect(page.locator('.shell > .titlebar strong')).toHaveText('DB');await expect(page.locator('.shell .status')).toContainText('화면을 읽지 못했습니다');
  captureError='';currentCapture=capture;
 });
 await check('Recognized detail keeps child rows and shows unsupported nesting without a false success',async()=>{
  currentCapture={...capture,pointInfo:{...pointInfo,...fields,depth3:'01579'},tables:{items:[{ctrtItemSqno:'001',qty:0,flag:false}]}};
  await page.goto(origin+'/main.html?mode=document&sourceTabId=1');const d=page.locator('dialog[open]');await expect(d).toContainText('서식: 계약 합성 예시');await expect(d.getByRole('checkbox')).toHaveCount(1);
  await d.getByRole('button',{name:'생성',exact:true}).click();await expect(d).toContainText('확인이 필요합니다');await expect(d).not.toContainText('저장 완료');
  assert.deepEqual(documentCalls.at(-1).payload.items[0].children[0].rows,currentCapture.tables.items);currentCapture=capture;
 });
 await check('More than 100 candidates require an explicit bounded selection',async()=>{
  currentCapture={...capture,tables:{계약목록:Array.from({length:101},(_,i)=>({...fields,ctrtNo:String(i).padStart(7,'0')}))}};
  await page.goto(origin+'/main.html?mode=document&sourceTabId=1');const d=page.locator('dialog[open]');await expect(d).toContainText('서식: 계약 합성 예시');await expect(d.getByRole('checkbox')).toHaveCount(101);await expect(d.getByRole('button',{name:'생성',exact:true})).toBeDisabled();
  await d.getByLabel('자료 101 선택',{exact:true}).check();await expect(d.getByRole('button',{name:'생성',exact:true})).toBeEnabled();currentCapture=capture;
 });
 await check('Studio unavailable returns failure, never a saved result',async()=>{
  await close(app);const result=await envelope({protocolVersion:1,requestId:randomUUID(),command:'mvp.document.generate',payload:request(fields)});assert.equal(result.error.code,'STUDIO_UNAVAILABLE');
  await page.goto(origin+'/main.html?mode=document&sourceTabId=1');const d=page.locator('dialog[open]');await expect(d.getByRole('button',{name:'연결 다시 확인',exact:true})).toBeVisible();await expect(d.getByRole('button',{name:'생성',exact:true})).toBeDisabled();await expect(d).not.toContainText('저장 완료');
 });
 assert.deepEqual(evidence.pageErrors,[]);evidence.passed=true;
} catch(error){evidence.passed=false;evidence.error=String(error.stack||error);if(page&&!page.isClosed())await page.screenshot({path:path.join(artifacts,'integration-failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally {fs.writeFileSync(path.join(artifacts,'integration.json'),JSON.stringify(evidence,null,2));await browser?.close();native.stdin.end();native.kill();await close(web);await close(app);}
console.log('Document bridge integration: '+evidence.checks.length+' passed');

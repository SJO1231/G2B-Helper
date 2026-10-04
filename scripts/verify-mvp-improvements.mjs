// Isolated UI + actual Native framing/SQLite. Never use the user's DB, ports or registry.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'artifacts/mvp-improvements');
fs.mkdirSync(output,{recursive:true});
const run=fs.mkdtempSync(path.join(output,'run-')),report={checks:[],pageErrors:[],limitation:'Synthetic data, isolated actual Native/SQLite, real built UI. Extension session transport is substituted; installed Chrome/Edge/G2B and real user registry are unverified.'};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
const compiled=await build({entryPoints:[path.join(root,'apps/mvp/pending-write.ts')],bundle:true,write:false,format:'esm',platform:'node'});
const {createPendingWrites}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const executable=path.join(root,'dist/mvp-host/feedback/G2BHelperHost/G2BHelperHost.exe');
assert.ok(fs.existsSync(executable),'Build the current Native executable before integration verification.');report.nativeExecutable=path.relative(root,executable);
const host=spawn(executable,['--database',path.join(run,'helper.sqlite')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
let bytes=Buffer.alloc(0),waiting=new Map(),stderr='',chain=Promise.resolve();
host.stderr.on('data',d=>stderr+=d);
host.stdout.on('data',data=>{bytes=Buffer.concat([bytes,data]);while(bytes.length>=4&&bytes.length>=4+bytes.readUInt32LE(0)){const size=bytes.readUInt32LE(0),response=JSON.parse(bytes.subarray(4,4+size).toString());bytes=bytes.subarray(4+size);const entry=waiting.get(response.requestId);if(entry){waiting.delete(response.requestId);entry.resolve(response);}}});
host.on('exit',code=>{for(const entry of waiting.values())entry.reject(new Error('Native exited '+code+' '+stderr));waiting.clear();});
const raw=request=>{const operation=chain.then(()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(request.requestId);reject(new Error('Native timeout'));},20000);waiting.set(request.requestId,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});const body=Buffer.from(JSON.stringify(request)),head=Buffer.alloc(4);head.writeUInt32LE(body.length);host.stdin.write(Buffer.concat([head,body]));}));chain=operation.catch(()=>{});return operation;};
const rpc=async(command,payload={})=>{const response=await raw({protocolVersion:1,requestId:randomUUID(),command,payload});assert.ok(!response.error,JSON.stringify(response.error));return response.result;};
const state={};const storage={get:async()=>structuredClone(state),set:async value=>Object.assign(state,structuredClone(value)),remove:async key=>{delete state[key];}};
let delayCommand='',rejectSettings=false,loseWrite=false,loseStatus=false,writeCount=0;
const transport=async envelope=>{
 if(envelope.command===delayCommand)await new Promise(resolve=>setTimeout(resolve,600));
 if(rejectSettings&&envelope.command==='mvp.settings.save'){rejectSettings=false;return {protocolVersion:1,requestId:envelope.requestId,error:{code:'SYNTHETIC',message:'합성 저장 거절'}};}
 if(loseStatus&&envelope.command==='mvp.request.status'){loseStatus=false;throw new Error('합성 조회 응답 단절');}
 const result=await raw(envelope);
 if(envelope.command==='mvp.edit')writeCount++;
 if(loseWrite&&envelope.command==='mvp.edit'){loseWrite=false;loseStatus=true;throw new Error('합성 저장 응답 단절');}
 return result;
};
let client=createPendingWrites(storage,transport);
const web=http.createServer((req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}const file=path.resolve(root,'dist/mvp-extension','.'+name);if(!file.startsWith(path.join(root,'dist/mvp-extension')+path.sep))throw new Error('path');res.writeHead(200,{'Content-Type':({'.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript'})[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+web.address().port;
let browser,page;
try{
 const fields={ctrtNo:'000123',ctrtChgOrd:'01',quantity:0,checked:false,ctrtAmt:'12345678901234567890.00001'};
 const source={url:'https://www.g2b.go.kr/',areaCd:'14',depth1:'01570',depth2:'01571',framePath:'top'};
 const observation={stage:'contract',identity:['000123','01'],fields,children:[],source,rawJson:JSON.stringify({pointInfo:{...fields,areaCd:'14',depth1:'01570',depth2:'01571'},tables:{}}),capturedAt:new Date().toISOString()};
 const preview=await rpc('mvp.preview',{observations:[observation]});await rpc('mvp.apply',{observations:preview.observations,token:preview.token,decisions:[]});
 let record=(await rpc('mvp.records',{stage:'contract'}))[0];await rpc('mvp.edit',{records:[{...record,fields:{...record.fields,quantity:7}}]});
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.newContext({viewport:{width:1300,height:900}});
 await context.exposeBinding('helperMessage',async(_binding,message)=>{
  if(message.kind==='mvp.pending.read')return {result:await client.read()??null};
  if(message.kind==='mvp.pending.recover')return {result:await client.recover(message.requestId,message.retry===true)};
  if(message.kind==='mvp.rpc'){try{return await client.request(message.envelope);}catch(error){return {protocolVersion:1,requestId:message.envelope.requestId,error:{code:'NATIVE_TRANSPORT',message:String(error)}};}}
  throw new Error('Unsupported synthetic message '+message.kind);
 });
 await context.addInitScript(()=>{window.chrome={runtime:{id:'synthetic-improvements',sendMessage:message=>window.helperMessage(message)}};});
 page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(String(error)));page.setDefaultTimeout(8000);
 const url=base+'/main.html?mode=db&stage=contract';
 const settings=()=>page.locator('dialog.settings-dialog');
 const openShared=async()=>{await page.getByRole('button',{name:'설정',exact:true}).click();await settings().getByRole('button',{name:'공유 설정',exact:true}).click();};
 const pkg={schema:'g2b-helper-shared-settings',schemaVersion:1,label:'합성 공유',version:'1',exportedAt:new Date().toISOString(),data:{dictionary:{keys:{quantity:'수량'},values:{}},columnTypes:{},columnFormats:{},columnLocks:{},screenRules:null}};
 const importDraft=async()=>{await settings().getByLabel('공유 설정 JSON 가져오기').setInputFiles({name:'shared.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pkg))});await settings().getByRole('button',{name:'선택한 변경 적용',exact:true}).click();};
 const quantityCell=async()=>{const field=await page.locator('.shell .tabulator-header .tabulator-col').evaluateAll(nodes=>nodes.find(n=>n.getAttribute('title')==='quantity'||n.querySelector('.mvp-grid-column-title > span')?.textContent==='quantity'||n.querySelector('.mvp-grid-column-title > span')?.textContent==='수량')?.getAttribute('tabulator-field'));assert.ok(field);return page.locator(`.shell .tabulator-table .tabulator-row .tabulator-cell[tabulator-field="${field}"]`).first();};
 await check('source/effective correction is marked and can be inspected',async()=>{await page.goto(url);await page.getByRole('button',{name:'quantity 정정값 확인',exact:true}).click();const dialog=page.locator('dialog').filter({hasText:'정정값 확인'});await expect(dialog.locator('pre')).toHaveText(['0','7']);await dialog.getByRole('button',{name:'닫기',exact:true}).click();await page.screenshot({path:path.join(output,'correction-mark.png')});});
 await check('reset uses actual Native source and clears mark without changing raw identifiers',async()=>{await page.getByRole('button',{name:'quantity 정정값 확인',exact:true}).click();await page.getByRole('button',{name:'정정 취소 · 수집값 사용',exact:true}).click();await expect(page.getByRole('button',{name:'quantity 정정값 확인',exact:true})).toHaveCount(0);record=(await rpc('mvp.records',{stage:'contract'}))[0];assert.equal(record.fields.quantity,0);assert.equal(record.fields.checked,false);assert.equal(record.fields.ctrtNo,'000123');assert.deepEqual(record.overrides,{});});
 await check('shared import cancel leaves SQLite settings unchanged',async()=>{const before=await rpc('mvp.settings.read');await openShared();await importDraft();await settings().getByRole('button',{name:'닫기',exact:true}).click();assert.deepEqual(await rpc('mvp.settings.read'),before);});
 await check('failed settings save retains imported draft for retry',async()=>{await openShared();await importDraft();rejectSettings=true;await settings().getByRole('button',{name:'저장',exact:true}).click();await expect(settings()).toContainText('작성한 설정은 유지됩니다');await expect(settings()).toContainText('합성 공유 (1)');assert.equal((await rpc('mvp.settings.read')).settings.dictionary.keys.quantity,undefined);});
 await check('settings save blocks close/Escape and persists shared history',async()=>{delayCommand='mvp.settings.save';await settings().getByRole('button',{name:'저장',exact:true}).click();await expect(settings().getByRole('button',{name:'닫기',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(settings()).toBeVisible();await expect(settings()).toHaveCount(0);delayCommand='';const stored=(await rpc('mvp.settings.read')).settings;assert.equal(stored.dictionary.keys.quantity,'수량');assert.equal(stored.sharedSettings.history.length,1);});
 await check('shared restoration previews then restores only applied changes',async()=>{await openShared();await settings().getByRole('button',{name:'되돌리기 미리보기',exact:true}).click();await settings().getByRole('button',{name:'선택한 변경 적용',exact:true}).click();await settings().getByRole('button',{name:'저장',exact:true}).click();await expect(settings()).toHaveCount(0);assert.equal((await rpc('mvp.settings.read')).settings.dictionary.keys.quantity,undefined);});
 await check('saving rows fences input while preserving the captured edit',async()=>{const cell=await quantityCell();await cell.dblclick();const editor=page.getByLabel('셀 편집',{exact:true});await editor.fill('8');await editor.press('Enter');delayCommand='mvp.edit';await page.locator('.export-actions').getByRole('button',{name:'저장',exact:true}).click();await expect(page.locator('.shell > .grid-area')).toHaveJSProperty('inert',true);await expect(page.getByRole('button',{name:'quantity 정정값 확인',exact:true})).toBeVisible();await expect(page.locator('.shell > .grid-area')).toHaveJSProperty('inert',false);delayCommand='';const stored=(await rpc('mvp.records',{stage:'contract'}))[0];assert.equal(stored.fields.quantity,8);assert.equal(stored.sourceFields.quantity,0);assert.equal(stored.overrides.quantity,8);});
 await check('lost reply survives a new view and recovers receipt without another write',async()=>{const cell=await quantityCell();await cell.dblclick();const editor=page.getByLabel('셀 편집',{exact:true});await editor.fill('9');await editor.press('Enter');loseWrite=true;const before=writeCount;await page.locator('.export-actions').getByRole('button',{name:'저장',exact:true}).click();await expect(page.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();assert.ok(await client.read());client=createPendingWrites(storage,transport);const next=await context.newPage();await next.goto(url);await next.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(next.locator('dialog')).toContainText('이전 요청이 저장된 것을 확인했습니다.');assert.equal(writeCount,before+1);assert.equal(await client.read(),undefined);const stored=(await rpc('mvp.records',{stage:'contract'}))[0];assert.equal(stored.fields.quantity,9);assert.equal(stored.sourceFields.quantity,0);await next.screenshot({path:path.join(output,'recovered-save.png')});await next.close();});
 assert.deepEqual(report.pageErrors,[]);assert.ok(report.checks.length>=8);report.passed=true;
}finally{await browser?.close();host.stdin.end();await new Promise(resolve=>web.close(resolve));fs.writeFileSync(path.join(output,'integration.json'),JSON.stringify(report,null,2));}
console.log('Verified improvements UI/Native integration: '+report.checks.length+' checks');

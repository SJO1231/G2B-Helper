// Development-only regression: in-memory source bundle, synthetic extension transport.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'artifacts/mvp-legacy');
await fs.mkdir(output,{recursive:true});
const built=await build({absWorkingDir:root,entryPoints:['apps/mvp/main.ts'],outfile:path.join(output,'main.js'),bundle:true,format:'esm',target:'chrome138',platform:'browser',write:false,loader:{'.woff':'file','.woff2':'file','.ttf':'file','.svg':'file','.png':'file'},assetNames:'assets/[name]-[hash]'});
const files=new Map(built.outputFiles.map(file=>['/'+path.relative(output,file.path).replaceAll('\\','/'),file.contents]));
files.set('/main.html',await fs.readFile(path.join(root,'apps/mvp/index.html')));
const report={checks:[],pageErrors:[],limitation:'Current product source served from memory. Extension messaging is synthetic; no installed extension, operating DB, registry or distribution output is changed.'};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://127.0.0.1').pathname,body=files.get(name);res.writeHead(body?200:404,{'Content-Type':name.endsWith('.html')?'text/html;charset=utf-8':name.endsWith('.css')?'text/css':'application/javascript'});res.end(body);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const initial=()=>({theme:'light',extractionMode:'tables',hideEmptyColumns:true,hideEmptyTables:true,hideUnmappedColumns:false,dictionary:{keys:{ctrtNo:'계약번호',ctrtNm:'계약명'},values:{}},launchers:[],shortcuts:{}});
const capture={url:'https://www.g2b.go.kr/',framePath:'top',pointInfo:{areaCd:'14',depth1:'01570',depth2:'01571'},tables:{contracts:[{ctrtNo:'0000123',ctrtChgOrd:'01',ctrtNm:'합성 자료'}]}};
async function scenario(name,action,deferred=1){
 const page=await browser.newPage({viewport:{width:1000,height:800}});
 page.setDefaultTimeout(4000);page.on('pageerror',error=>report.pageErrors.push(String(error)));
 let stored=initial(),version=1;const requests=[],waiting=[];
 await page.exposeFunction('legacyMessage',async request=>{
  if(request.kind==='mvp.capture')return {result:structuredClone(capture)};
  if(request.kind==='mvp.pending.read')return {result:null};
  const envelope=request.envelope;
  const reply=result=>({protocolVersion:1,requestId:envelope.requestId,result});
  if(envelope.command==='mvp.settings.read')return reply({settings:structuredClone(stored),storeVersion:version});
  assert.equal(envelope.command,'mvp.settings.save');
  requests.push(structuredClone(envelope));
  if(requests.length<=deferred){
   const rejection=await new Promise(resolve=>waiting.push(resolve));
   if(rejection)return {protocolVersion:1,requestId:envelope.requestId,error:{code:'SYNTHETIC',message:'합성 자동 저장 거절'}};
  }
  assert.equal(envelope.payload.storeVersion,version);
  stored=structuredClone(envelope.payload.settings);version++;
  return reply({settings:structuredClone(stored),storeVersion:version});
 });
 await page.addInitScript(()=>{window.chrome={runtime:{id:'synthetic-legacy',sendMessage:message=>window.legacyMessage(message)}};});
 const settings=()=>page.locator('.settings-dialog');
 const editDraft=async()=>{await settings().getByRole('button',{name:'키 사전',exact:true}).click();const row=settings().locator('tr').filter({has:page.getByRole('cell',{name:'ctrtNm',exact:true})});await row.getByLabel('표시명',{exact:true}).fill('설정에서 바꾼 계약명');await row.getByLabel('표시명',{exact:true}).press('Tab');};
 const release=reject=>{assert.equal(waiting.length,1,'Expected an in-flight auto save');waiting.shift()(reject);};
 const rename=async(label,value)=>{const header=page.locator('.tabulator-header .tabulator-col').filter({has:page.locator('.mvp-grid-column-title > span').filter({hasText:new RegExp('^'+label+'$')})});await header.click({button:'right'});await page.locator('.tabulator-menu-item').filter({hasText:/^표시명 설정$/}).click();await page.getByLabel('열 표시명',{exact:true}).fill(value);await page.getByRole('button',{name:'적용',exact:true}).click();};
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/main.html?mode=extract');
  const header=page.locator('.tabulator-header .tabulator-col').filter({has:page.locator('.mvp-grid-column-title > span').filter({hasText:/^계약번호$/})});await expect(header).toBeVisible();
  await header.click({button:'right'});await page.locator('.tabulator-menu-item').filter({hasText:/^표시명 설정$/}).click();
  await page.getByLabel('열 표시명',{exact:true}).fill('표에서 바꾼 번호');await page.getByRole('button',{name:'적용',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(1);
  await action({page,settings,editDraft,release,rename,requests,getStored:()=>stored});
  report.checks.push({name,passed:true});console.log('PASS '+name);
 }catch(error){report.checks.push({name,passed:false,error:String(error)});console.log('FAIL '+name+': '+error.message);await page.screenshot({path:path.join(output,'failure-'+Date.now()+'.png')});}
 finally{for(const resolve of waiting)resolve(true);await page.close();}
}
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 await scenario('delayed auto save cannot overwrite the settings draft',async({page,settings,editDraft,release,requests,getStored})=>{
  await page.getByRole('button',{name:'설정',exact:true}).click();
  const early=await settings().count();if(early)await editDraft();
  release(false);await expect(settings()).toBeVisible();if(!early)await editDraft();
  await page.screenshot({path:path.join(output,'settings-draft.png')});
  await settings().getByRole('button',{name:'저장',exact:true}).click();await expect(settings()).toHaveCount(0);
  assert.equal(requests[1].payload.settings.dictionary.keys.ctrtNm,'설정에서 바꾼 계약명');
  assert.equal(getStored().dictionary.keys.ctrtNo,'표에서 바꾼 번호');
 });
 await scenario('cancel discards only the settings draft after the earlier save',async({page,settings,editDraft,release,getStored})=>{
  await page.getByRole('button',{name:'설정',exact:true}).click();
  release(false);await expect(settings()).toBeVisible();await editDraft();
  await settings().getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'설정',exact:true}).click();await settings().getByRole('button',{name:'키 사전',exact:true}).click();
  const field=key=>settings().locator('tr').filter({has:page.getByRole('cell',{name:key,exact:true})}).getByLabel('표시명',{exact:true});
  await expect(field('ctrtNo')).toHaveValue('표에서 바꾼 번호');await expect(field('ctrtNm')).toHaveValue('계약명');
  assert.equal(getStored().dictionary.keys.ctrtNm,'계약명');
 });
 await scenario('rejected auto save leaves confirmed settings available to edit',async({page,settings,editDraft,release,getStored})=>{
  await page.getByRole('button',{name:'설정',exact:true}).click();
  release(true);await expect(settings()).toBeVisible();await editDraft();
  await settings().getByRole('button',{name:'저장',exact:true}).click();await expect(settings()).toHaveCount(0);
  assert.equal(getStored().dictionary.keys.ctrtNo,'계약번호');
  assert.equal(getStored().dictionary.keys.ctrtNm,'설정에서 바꾼 계약명');
 });
 await scenario('settings waits for auto saves queued while opening',async({page,settings,editDraft,release,rename,requests,getStored})=>{
  await page.getByRole('button',{name:'설정',exact:true}).click();await expect(settings()).toHaveCount(0);
  await rename('계약명','표에서 바꾼 계약명');release(false);
  await expect.poll(()=>requests.length).toBe(2);await expect(settings()).toHaveCount(0);
  release(false);await expect(settings()).toBeVisible();await editDraft();
  await settings().getByRole('button',{name:'저장',exact:true}).click();await expect(settings()).toHaveCount(0);
  assert.equal(requests[2].payload.settings.dictionary.keys.ctrtNm,'설정에서 바꾼 계약명');
  assert.equal(getStored().dictionary.keys.ctrtNo,'표에서 바꾼 번호');
 },2);
}finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 report.passed=report.checks.length===4&&report.checks.every(check=>check.passed)&&report.pageErrors.length===0;
 await fs.writeFile(path.join(output,report.passed?'result.json':'failure-'+Date.now()+'.json'),JSON.stringify(report,null,2)+'\n');
}
assert.equal(report.passed,true,JSON.stringify(report));

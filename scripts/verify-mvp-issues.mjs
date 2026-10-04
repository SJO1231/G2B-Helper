// GitHub #2/#3: actual built UI, synthetic JSON and an isolated ephemeral browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'artifacts/mvp-issues');
await fs.mkdir(output,{recursive:true});
const report={checks:[],errors:[],focusMeasurements:[],limitation:'Real built UI with synthetic demo/import data. Focus paint bounds use computed outlines and clipping ancestors; screenshots require visual review. No installed extension, user DB or registry is changed.'};
const server=http.createServer(async(req,res)=>{
 try{const name=new URL(req.url,'http://127.0.0.1').pathname.slice(1);
  if(!['main.html','main.js','main.css'].includes(name)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':{html:'text/html;charset=utf-8',js:'text/javascript',css:'text/css'}[name.split('.').pop()]});
  res.end(await fs.readFile(path.join(root,'dist/mvp-extension',name)));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:850},acceptDownloads:true});
page.setDefaultTimeout(4000);page.on('pageerror',error=>report.errors.push(String(error)));
const check=async(name,fn)=>{try{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:String(error)});console.log('FAIL '+name+': '+error.message);}};
const settings=()=>page.locator('.settings-dialog');
const header=label=>page.locator('.tabulator-header .tabulator-col').filter({has:page.locator('.mvp-grid-column-title > span').filter({hasText:new RegExp('^'+label+'$')})});
const open=async()=>{await page.getByRole('button',{name:'설정',exact:true}).click();await expect(settings()).toBeVisible();};
const shared=async()=>{await open();await settings().getByRole('button',{name:'공유 설정',exact:true}).click();};
const close=()=>settings().getByRole('button',{name:'닫기',exact:true}).click();
const pkg={schema:'g2b-helper-shared-settings',schemaVersion:1,label:'LongName'.repeat(12),version:'1',exportedAt:'2026-10-04T00:00:00Z',data:{dictionary:{keys:{issueOnly:'긴 표시값'.repeat(100)},values:{}},columnTypes:{},columnFormats:{},columnLocks:{},screenRules:null}};
const upload=()=>settings().getByLabel('공유 설정 JSON 가져오기',{exact:true}).setInputFiles({name:'long-settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pkg))});
const contained=async()=>{
 const result=await settings().locator('.settings-content').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,items:[...el.querySelectorAll('input,button,select')].filter(x=>x.getClientRects().length).map(x=>({label:x.getAttribute('aria-label')||x.textContent,left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right})),left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}));
 assert.ok(result.scroll<=result.client+1,JSON.stringify(result));
 for(const item of result.items)assert.ok(item.left>=result.left-1&&item.right<=result.right+1,JSON.stringify(item));
};
// Element boxes can fit while an outward keyboard-focus outline is clipped.
// Compare the outline's outer paint bounds with every clipping ancestor.
const measureFocus=async(target,scenario)=>{
 const result=await target.evaluate(el=>{
  const rect=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom});
  const style=getComputedStyle(el),box=rect(el.getBoundingClientRect());
  const width=parseFloat(style.outlineWidth)||0,offset=parseFloat(style.outlineOffset)||0;
  const extent=width+offset,paint={left:box.left-extent,right:box.right+extent,top:box.top-extent,bottom:box.bottom+extent};
  const clips=[];
  for(let ancestor=el.parentElement;ancestor;ancestor=ancestor.parentElement){
   const css=getComputedStyle(ancestor),clipX=['auto','scroll','hidden','clip'].includes(css.overflowX),clipY=['auto','scroll','hidden','clip'].includes(css.overflowY);
   if(!clipX&&!clipY)continue;
   const r=ancestor.getBoundingClientRect(),clip={left:r.left+ancestor.clientLeft,top:r.top+ancestor.clientTop,right:r.left+ancestor.clientLeft+ancestor.clientWidth,bottom:r.top+ancestor.clientTop+ancestor.clientHeight};
   clips.push({ancestor:ancestor.className||ancestor.tagName,clipX,clipY,clip,clipped:{left:clipX&&paint.left<clip.left-.25,right:clipX&&paint.right>clip.right+.25,top:clipY&&paint.top<clip.top-.25,bottom:clipY&&paint.bottom>clip.bottom+.25}});
  }
  return{label:el.getAttribute('aria-label')||el.textContent,focused:document.activeElement===el,focusVisible:el.matches(':focus-visible'),outline:{width,offset,style:style.outlineStyle,color:style.outlineColor},box,paint,clips};
 });
 const clipped=result.clips.some(clip=>Object.values(clip.clipped).some(Boolean));
 const screenshot=`focus-${scenario}-${clipped?'before':'final'}.png`;
 report.focusMeasurements.push({scenario,viewport:page.viewportSize(),...result,screenshot});
 await page.screenshot({path:path.join(output,screenshot)});
 return result;
};
const focusFits=result=>{
 assert.ok(result.focused&&result.focusVisible,'Keyboard focus-visible was not established: '+JSON.stringify(result));
 assert.ok(result.outline.width>0&&!['none','hidden'].includes(result.outline.style)&&result.outline.color!=='rgba(0, 0, 0, 0)','Visible keyboard-focus outline required: '+JSON.stringify(result));
 for(const clip of result.clips)assert.ok(!Object.values(clip.clipped).some(Boolean),'Focus paint clipped: '+JSON.stringify(result));
};
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/main.html?mode=extract`);
 await expect(page.locator('.tabulator-row').first()).toBeVisible();
 await check('new extraction hides empty columns/tables but retains zero/false',async()=>{
  await expect(page.locator('.tab-list').getByRole('button',{name:'빈표',exact:true})).toHaveCount(0);
  await expect(header('빈열')).toHaveCount(1);await expect(header('빈열')).toBeHidden();
  await expect(header('수량')).toBeVisible();
  await expect(header('완료')).toBeVisible();
 });
 await check('raw JSON retains the hidden empty table and column',async()=>{
  await page.getByRole('button',{name:'원본 JSON',exact:true}).click();
  await expect(page.locator('.raw-view')).toContainText('빈표');await expect(page.locator('.raw-view')).toContainText('빈열');
  await page.locator('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 });
 await check('explicitly disabling hide restores empty table and column',async()=>{
  await open();await settings().getByLabel('빈 열 숨김',{exact:true}).uncheck();await settings().getByLabel('빈 테이블 숨김',{exact:true}).uncheck();
  await settings().getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.locator('.tab-list').getByRole('button',{name:'빈표',exact:true})).toBeVisible();
  await expect(header('빈열')).toBeVisible();
 });
 await shared();
 await check('shared controls stay inside the dialog when entering and typing',async()=>{
  for(const width of [1000,600,450,300]){
   await page.setViewportSize({width,height:850});
   const name=settings().getByLabel('공유 설정 이름',{exact:true});await name.fill('입력 검사');await name.press('End');await name.press('a');
   assert.deepEqual(await name.evaluate(el=>[el.selectionStart,el.selectionEnd]),[6,6]);
   await contained();
  }
 });
 await check('keyboard focus paint stays inside all clipping edges at wide and narrow widths',async()=>{
  const results=[];
  for(const width of [1000,600,450,300]){
   await page.setViewportSize({width,height:850});
   const name=settings().getByLabel('공유 설정 이름',{exact:true});
   await name.click();await name.press('Tab');await page.keyboard.press('Shift+Tab');
   results.push(await measureFocus(name,`name-${width}`));
   await name.press('Tab');
   const version=settings().getByLabel('공유 설정 버전',{exact:true});results.push(await measureFocus(version,`version-${width}`));
   await version.press('Tab');
   const exportButton=settings().getByRole('button',{name:'JSON 내보내기',exact:true});results.push(await measureFocus(exportButton,`export-${width}`));
   await exportButton.press('Tab');
   const file=settings().getByLabel('공유 설정 JSON 가져오기',{exact:true});results.push(await measureFocus(file,`file-${width}`));
  }
  // A long preview supplies real scrolling so both vertical clipping edges
  // can be checked without injecting styles or changing the product DOM.
  await upload();await expect(settings().locator('.shared-settings-preview table')).toBeVisible();
  const choice=settings().locator('.shared-settings-preview select').first();
  await choice.focus();await choice.press('ArrowDown');
  for(const edge of ['top','bottom']){
   await choice.evaluate((el,edge)=>{
    const content=el.closest('.settings-content'),box=el.getBoundingClientRect(),clip=content.getBoundingClientRect();
    content.scrollTop+=edge==='top'?box.top-(clip.top+content.clientTop):box.bottom-(clip.top+content.clientTop+content.clientHeight);
   },edge);
   results.push(await measureFocus(choice,`preview-${edge}-300`));
  }
  // Keep all failing measurements/screenshots before asserting the regression.
  for(const result of results)focusFits(result);
 });
 await upload();await expect(settings().locator('.shared-settings-preview table')).toBeVisible();
 await check('long import heading/preview fits a narrow settings dialog',async()=>{await contained();});
 await page.screenshot({path:path.join(output,'shared-preview.png')});
 await settings().getByRole('button',{name:'선택한 변경 적용',exact:true}).click();
 await check('long applied-history text fits without pushing controls outside',contained);
 await page.screenshot({path:path.join(output,'shared-history.png')});
 await check('closing settings discards the shared draft',async()=>{
  await close();await shared();await expect(settings().locator('.shared-settings-history')).toContainText('저장된 공유 설정 적용 이력이 없습니다.');
 });
 await check('saving shared draft keeps the applied history',async()=>{
  await upload();await settings().getByRole('button',{name:'선택한 변경 적용',exact:true}).click();await settings().getByRole('button',{name:'저장',exact:true}).click();
  await shared();await expect(settings().getByRole('button',{name:'되돌리기 미리보기',exact:true})).toBeVisible();
 });
 assert.deepEqual(report.errors,[]);assert.ok(report.checks.length===9);
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
 report.passed=report.errors.length===0&&report.checks.length===9&&report.checks.every(x=>x.passed);
 const serialized=JSON.stringify(report,null,2);await fs.writeFile(path.join(output,'result.json'),serialized);
 if(!report.passed)await fs.writeFile(path.join(output,`failure-${Date.now()}.json`),serialized);
}
if(!report.passed)throw new Error('Issue verification failed; see artifacts/mvp-issues/result.json');
console.log('Verified issues #2/#3: '+report.checks.length+' checks');

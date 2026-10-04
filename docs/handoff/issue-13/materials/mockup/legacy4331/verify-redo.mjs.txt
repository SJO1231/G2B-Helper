// Development validation only; no product or distribution writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),file=path.join(dir,'index.html'),out=path.join(dir,'evidence/redo');
await fs.mkdir(out,{recursive:true});
const html=await fs.readFile(file,'utf8'),report={htmlSha256:createHash('sha256').update(html).digest('hex'),checks:[],pageErrors:[],consoleErrors:[],externalRequests:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:2172,height:950}});page.setDefaultTimeout(4000);
page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text())});
page.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url())});
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS '+name)};
const shot=name=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
const settings=()=>page.locator('#settings');
const open=async()=>{await page.locator('#openSettings').click();await expect(settings()).toBeVisible()};
const tab=id=>settings().locator('[data-settings-main="'+id+'"]').click();
const save=()=>settings().locator('#saveSettings').click();
const cancel=()=>settings().locator('[data-close="settings"]').click();
const stage=id=>page.locator('#sampleStage').selectOption(id);
const mode=id=>page.locator('[data-mode="'+id+'"]').click();
const flags=async(screen,db)=>{await open();await settings().locator('#draftHideScreen').setChecked(screen);await settings().locator('#draftHideDb').setChecked(db);await save()};
const allColumns=async()=>{await open();for(const key of ['hideEmptyColumns','hideUnmappedColumns'])await settings().locator('[data-original="'+key+'"]').uncheck();await save()};
try{
 await check('Baseline style, one HTML and sample-only boundaries',async()=>{
  assert.ok(html.includes((await fs.readFile(path.join(root,'apps/mvp/style.css'),'utf8')).trimEnd()));
  assert.ok(!/(?:src|href)=["'](?:https?:|\/\/)/i.test(html));
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage)\s*[.(]/.test(html));
  assert.match(html,/시안 · 샘플 데이터/);
 });
 await page.goto(pathToFileURL(file).href);
 await check('Original title, buttons, tabs, 92px dates and same-line footer',async()=>{
  assert.deepEqual(await page.locator('.export-actions button').allTextContents(),['원본 JSON','JSON','CSV','Excel','생성','저장']);
  assert.deepEqual(await page.locator('#shell>.titlebar button').evaluateAll(bs=>bs.map(b=>b.getAttribute('aria-label'))),['설정','닫기']);
  assert.equal(await page.locator('#shell>.titlebar').evaluate(e=>e.getBoundingClientRect().height),34);
  assert.equal(await page.locator('#startDate').evaluate(e=>e.getBoundingClientRect().width),92);
  await expect(page.locator('#saveRows')).toBeDisabled();await expect(page.locator('#sidebar')).toBeHidden();
  const boxes=await page.locator('#message,#counts').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().top));assert.equal(boxes[0],boxes[1]);
 });
 await allColumns();
 for(const [id,name] of Object.entries({receipt:'data_map_1790068571914.txt',bid:'data_map_1789115253930.txt',contract:'data_map_1789116164232.txt'})){
  const source=JSON.parse(await fs.readFile(path.join(root,'참고자료',name),'utf8'));
  await stage(id);
  await check(id+': actual table IDs and every field; no invented extraction tabs',async()=>{
   const nonempty=Object.entries(source.tables).filter(([,rows])=>rows.length).map(([key])=>key).sort();
   assert.deepEqual((await page.locator('#stageTabs [data-table]').evaluateAll(es=>es.map(e=>e.dataset.table))).sort(),nonempty);
   for(const tableId of nonempty){
    await page.locator('#stageTabs [data-table="'+tableId+'"]').click();
    const fields=[...new Set(source.tables[tableId].flatMap(r=>Object.keys(r)))].sort();
    assert.deepEqual((await page.locator('#grid thead th[title]').evaluateAll(es=>es.map(e=>e.title))).sort(),fields);
   }
  });
  await check(id+': original JSON retains table/pointInfo schema and source values',async()=>{
   await page.locator('#rawJson').click();
   const data=JSON.parse(await page.locator('#informationBody pre').textContent());
   assert.deepEqual(Object.keys(data.tables).sort(),Object.keys(source.tables).sort());
   assert.deepEqual(Object.keys(data.pointInfo).sort(),Object.keys(source.pointInfo).sort());
   for(const [tableId,rows] of Object.entries(source.tables)){
    if(!rows.length)assert.equal(data.tables[tableId].length,0);
    else assert.deepEqual(Object.keys(data.tables[tableId][0]).sort(),[...new Set(rows.flatMap(r=>Object.keys(r)))].sort());
   }
   await page.locator('#information [data-close]').click();
  });
 }
 await shot('01-contract-extract-wide');
 await check('Empty table option and pointInfo scope work and cancel restores settings',async()=>{
  await stage('bid');await open();
  await settings().locator('[data-original="hideEmptyTables"]').uncheck();
  await settings().locator('[data-original="extractionMode"]').selectOption('all');await save();
  await expect(page.locator('#stageTabs [data-table]')).toHaveCount(4);
  await page.locator('#stageTabs [data-table="$pointInfo:top"]').click();await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  await open();await settings().locator('[data-original="extractionMode"]').selectOption('tables');await cancel();
  await expect(page.locator('#stageTabs [data-table="$pointInfo:top"]')).toHaveCount(1);
  await open();await settings().locator('[data-original="hideEmptyTables"]').check();await settings().locator('[data-original="extractionMode"]').selectOption('tables');await save();
 });
 await check('Column properties hide/show each source field without dropping values',async()=>{
  await stage('contract');const before=await page.locator('#grid thead th[title]').count();
  await page.locator('#properties').click();await page.locator('[data-column-visible="ctrtNo"]').uncheck();
  assert.equal(await page.locator('#grid thead th[title]').count(),before-1);
  await page.locator('#showAllColumns').click();assert.equal(await page.locator('#grid thead th[title]').count(),before);
  await page.locator('#propertyPopover [data-close-popover]').click();
 });
 await page.locator('#variant').selectOption('proposal');await mode('result');await stage('contract');
 await check('Independent duplicate switches and changed rows remain visible',async()=>{
  assert.equal(await page.locator('#grid tbody tr').count(),6);
  assert.equal(await page.locator('#grid .badge.changed').count(),2);
  const changed = await page.evaluate(()=>samples.contract.filter(r=>r.outcome==='changed').map(r=>({key:[r.fields.ctrtNo,r.fields.ctrtChgOrd],dbKey:[r.dbFields.ctrtNo,r.dbFields.ctrtChgOrd],amount:r.fields.ctrtAmt,dbAmount:r.dbFields.ctrtAmt})));
  for(const row of changed){assert.deepEqual(row.key,row.dbKey);assert.notEqual(row.amount,row.dbAmount);}
  await flags(false,true);assert.equal(await page.locator('#grid tbody tr').count(),7);
  await flags(true,false);assert.equal(await page.locator('#grid tbody tr').count(),8);
  await flags(false,false);assert.equal(await page.locator('#grid tbody tr').count(),9);
  await flags(true,true);assert.equal(await page.locator('#grid tbody tr').count(),6);
 });
 await shot('02-result-wide');
 await mode('db');await stage('contract');
 await check('DB keeps receipt/bid/contract tabs and representative item/detail fields',async()=>{
  assert.deepEqual(await page.locator('#stageTabs [data-stage]').allTextContents(),['접수','공고','계약','검수내역']);
  await expect(page.locator('#grid [data-items]').first()).toContainText('외 1건');
  await page.locator('#grid [data-items]').first().click();
  const source=JSON.parse(await fs.readFile(path.join(root,'참고자료/data_map_1790068650885.txt'),'utf8'));
  const fields=[...new Set(source.tables.mf_wfm_container_tacCtrt_contents_content2_body_grdCtrtLis.flatMap(r=>Object.keys(r)))];
  const displayed=await page.locator('#itemGrid th[title]').evaluateAll(es=>es.map(e=>e.title));
  for(const field of fields)assert.ok(displayed.includes(field),field);
  await expect(page.locator('#itemGrid [data-field="itemIdnfNo"]').first()).toHaveText('00001234');
  await expect(page.locator('#itemGrid [data-field="isChecked"]').first()).toHaveText('false');
  await shot('03-items-wide');await page.locator('#items [data-close]').first().click();
 });
 await check('Leading zeros, exact decimal, empty, zero and false stay distinct',async()=>{
  const actual=await page.evaluate(()=>({ord:samples.contract[0].fields.ctrtChgOrd,large:samples.contract.find(r=>r.id==='contract-5').fields.ctrtAmt,zero:samples.contract.find(r=>r.id==='contract-2').items[0].ctrtQty,no:samples.contract[0].items[0].itemIdnfNo,empty:samples.contract.find(r=>r.id==='contract-4').fields.dmstUntyGrpNm,flag:samples.contract[0].items[0].isChecked}));
  assert.deepEqual(actual,{ord:'01',large:'9007199254740993.25',zero:0,no:'00001234',empty:'',flag:false});
  await expect(page.locator('#grid [data-row="contract-5"] [data-field="ctrtAmt"]')).toHaveText('9,007,199,254,740,993.25');
 });
 await check('Column filter reset preserves search and original completion controls',async()=>{
  await page.locator('#search').fill('모니터');
  await page.locator('#grid th[title="ctrtNo"] [data-filter]').click();
  await page.locator('#columnTerm').fill('missing');await page.locator('#applyColumn').click();await expect(page.locator('#grid tbody tr')).toHaveCount(0);
  await page.locator('#resetFilters').click();await expect(page.locator('#search')).toHaveValue('모니터');await expect(page.locator('#grid tbody tr')).toHaveCount(1);
  await page.locator('#search').fill('');await page.locator('#grid [data-row="contract-0"]').click();
  await page.locator('#finishSelected').click();await expect(page.locator('#saveRows')).toBeEnabled();await page.locator('#saveRows').click();await expect(page.locator('#saveRows')).toBeDisabled();
  await expect(page.locator('#message')).toContainText('시안 내부');
 });
 await shot('04-db-wide');
 await check('Existing seven settings tabs and sample new settings remain available',async()=>{
  await open();assert.deepEqual(await settings().locator('[data-settings-main]').allTextContents(),['일반','키 사전','값 사전','수집 화면','단축키','문서 연결','공유 설정']);
  await tab('collection');assert.deepEqual(await settings().locator('[data-setting]').allTextContents(),['화면','표','업무키','관계']);
  await settings().locator('[data-setting="key"]').click();const keys=await settings().locator('[data-key]:checked').evaluateAll(es=>es.map(e=>e.dataset.key));assert.deepEqual(keys,['ctrtNo','ctrtChgOrd']);
  await settings().locator('[data-key="ctrtDt"]').check();await cancel();
  await open();await tab('collection');await settings().locator('[data-setting="key"]').click();await expect(settings().locator('[data-key="ctrtDt"]')).not.toBeChecked();await cancel();
 });
 await check('Relation candidate connect/unlink is draft-only and cancellable',async()=>{
  await open();await tab('collection');await settings().locator('[data-setting="relation"]').click();
  const first=settings().locator('[data-relation]').first();const before=await first.textContent();await first.click();assert.notEqual(await settings().locator('[data-relation]').first().textContent(),before);
  await shot('05-relations-wide');await cancel();
  await open();await tab('collection');await settings().locator('[data-setting="relation"]').click();assert.equal(await settings().locator('[data-relation]').first().textContent(),before);await cancel();
 });
 await check('Sidebar opens only on request and shares editor with full manager',async()=>{
  await expect(page.locator('#sidebar')).toBeHidden();await page.locator('#toggleSidebar').click();await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#sidebarBody')).toContainText('납품 장소 확인');await shot('06-sidebar-wide');
  await page.locator('#quickNote').click();await page.locator('#editName').fill('cancelled');await page.locator('#editor [data-close]').first().click();
  await page.locator('#manageAll').click();await expect(page.locator('#managerList')).not.toContainText('cancelled');
  await page.locator('#managerAdd').click();await page.locator('#editName').fill('새 일반 메모');await page.locator('#editContent').fill('샘플 내용');await page.locator('#editForm [type=submit]').click();await expect(page.locator('#managerList')).toContainText('새 일반 메모');
  await page.locator('[data-manager="schedule"]').click();await page.locator('#managerAdd').click();await page.locator('#editName').fill('샘플 일정');await page.locator('#editDate').fill('2026-10-20');await page.locator('#editForm [type=submit]').click();await expect(page.locator('#managerList')).toContainText('2026-10-20');
  await shot('07-manager-wide');await page.locator('#manager [data-close]').first().click();
 });
 await page.setViewportSize({width:375,height:812});
 await check('Narrow layout: table scroll, settings scroll and sidebar fit',async()=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await shot('08-sidebar-narrow');await page.locator('#closeSidebar').click();await shot('09-db-narrow');
  await open();await tab('collection');await shot('10-settings-narrow');
  const box=await settings().boundingBox();assert.ok(box.x>=0&&box.x+box.width<=375);
  await cancel();
 });
 await check('Reload resets sample edits; default additions can be reviewed separately',async()=>{
  await page.reload();await expect(page.locator('#variant')).toHaveValue('original');await expect(page.locator('#sidebar')).toBeHidden();await expect(page.locator('#saveRows')).toBeDisabled();
  await mode('db');await expect(page.locator('#stageTabs [data-stage]')).toHaveCount(3);
 });
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.externalRequests,[]);
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error);await shot('failure-'+Date.now());process.exitCode=1;console.error(error);}
finally{await fs.writeFile(path.join(out,report.status==='passed'?'result.json':'failure-'+Date.now()+'.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({status:report.status,checks:report.checks.length,pageErrors:report.pageErrors,consoleErrors:report.consoleErrors,externalRequests:report.externalRequests}));}

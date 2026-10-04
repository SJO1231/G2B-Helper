// Development preview/check only. The deliverable remains one standalone HTML.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const folder=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(folder,'../..'),file=path.join(folder,'index.html');
if(process.argv.includes('--baseline')){
 const output=path.join(folder,'evidence');await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:850}});page.setDefaultTimeout(1500);await page.goto(pathToFileURL(file).href);
 const report={htmlSha256:createHash('sha256').update(await fs.readFile(file)).digest('hex'),checks:[],kind:'Existing UI/representative item acceptance before restoration'};
 for(const [name,check] of [
  ['Representative item name and additional item count are visible',()=>expect(page.locator('#grid [data-items]').first()).toContainText(/.+ 외 1건/)],
  ['Original export/generate/save control order is retained',async()=>assert.deepEqual(await page.locator('.export-actions button').allTextContents(),['원본 JSON','JSON','CSV','Excel','생성','저장'])],
  ['Extraction uses original table tabs instead of DB business tabs',()=>expect(page.locator('#stageTabs [data-stage]')).toHaveCount(0)]
 ]){try{await check();report.checks.push({name,passed:true});}catch(error){report.checks.push({name,passed:false,error:String(error)});}}
 await page.screenshot({path:path.join(output,'before-restoration.png'),fullPage:true});await browser.close();
 report.status=report.checks.every(c=>c.passed)?'passed':'failed';await fs.writeFile(path.join(output,'before-restoration.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(report.status==='failed')process.exitCode=1;
}else if(process.argv.includes('--stop-preview')){
 // Only the listener owned by this exact preview script may be stopped.
 const result=execFileSync('powershell.exe',['-NoProfile','-Command',String.raw`$connections = @(Get-NetTCPConnection -State Listen -LocalPort 4331 -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' }); foreach ($connection in $connections) { $previewPid = $connection.OwningProcess; $previewProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$previewPid"; if ($previewProcess.Name -ne 'node.exe' -or $previewProcess.CommandLine -notmatch 'artifacts[\\/]mvp-feature-mockup[\\/]verify\.mjs\s+--(?:serve|preview-server)') { throw 'Refusing to stop a process not owned by this preview script' }; Stop-Process -Id $previewPid -ErrorAction Stop; Write-Output "Stopped owned preview listener $previewPid" }`],{encoding:'utf8',windowsHide:true});console.log(result||'No owned preview listener.');
}else if(process.argv.includes('--serve')){
 // Wait for readiness within the harness deadline; keep the requested localhost preview alive.
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--preview-server'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 const ready=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(new Error('Preview readiness timed out'));},8000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);reject(new Error('Preview exited before readiness: '+code));});
  child.once('message',message=>{clearTimeout(timer);if(message.kind==='preview-ready')resolve(message);else reject(new Error(message.error||'Preview startup failed'));});
 });
 child.disconnect();child.unref();console.log(JSON.stringify(ready));
}else if(process.argv.includes('--preview-server')){
 const server=http.createServer(async(req,res)=>{if(req.url==='/'||req.url==='/index.html'){try{const content=await fs.readFile(file);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(500);res.end('Preview file unavailable');}}else if(req.url==='/favicon.ico'){res.writeHead(204);res.end();}else{res.writeHead(404);res.end();}});
 server.listen(4331,'127.0.0.1',()=>{if(process.send)process.send({kind:'preview-ready',url:'http://127.0.0.1:4331/',pid:process.pid});});
 server.on('error',error=>{if(process.send)process.send({kind:'preview-error',error:String(error)});});
 await new Promise((resolve,reject)=>{server.on('error',reject);process.on('SIGINT',()=>server.close(resolve));process.on('SIGTERM',()=>server.close(resolve));});
}else{
 const output=path.join(folder,'evidence');await fs.mkdir(output,{recursive:true});
 const html=await fs.readFile(file,'utf8'),report={htmlSha256:createHash('sha256').update(html).digest('hex'),checks:[],pageErrors:[],consoleErrors:[],externalRequests:[],limitation:'Standalone synthetic UI only. Original controls retained in both variants; new feature placement is a proposal. No real collection, comparison, DB, generation, export, notifications, Native or packaging.'};
 let browser,page;
 const check=async(name,fn)=>{try{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:String(error)});if(page)await page.screenshot({path:path.join(output,'restoration-failure-'+Date.now()+'.png')});throw error;}};
 const shot=async name=>page.screenshot({path:path.join(output,'restoration-'+name+'.png'),fullPage:true});
 const settings=()=>page.locator('#settings'),openSettings=async()=>{await page.locator('#openSettings').click();await expect(settings()).toBeVisible();};
 const mainTab=async id=>settings().locator('[data-settings-main="'+id+'"]').click();
 const subTab=async id=>settings().locator('[data-setting="'+id+'"]').click();
 const cancelSettings=async()=>settings().locator('[data-close="settings"]').click();
 const applySettings=async()=>settings().locator('#saveSettings').click();
 const collection=async id=>{await openSettings();await mainTab('collection');if(id)await subTab(id);};
 const stage=async id=>page.locator('#sampleStage').selectOption(id);
 const mode=async id=>page.locator('[data-mode="'+id+'"]').click();
 const select=async id=>page.locator('#grid [data-row="'+id+'"]').click();
 const count=async n=>expect(page.locator('#grid tbody tr')).toHaveCount(n);
 const flags=async(screen,db)=>{await openSettings();await page.locator('#draftHideScreen').setChecked(screen);await page.locator('#draftHideDb').setChecked(db);await applySettings();};
 const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'document width must fit viewport');
 try{
  await check('One HTML without dependencies, persistent storage or transport',async()=>{
   assert.ok(!/(?:src|href)=["'](?:https?:|\/\/)/i.test(html));
   assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage)\s*[.(]/.test(html));assert.match(html,/시안 · 샘플 데이터/);
  });
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  page=await browser.newPage({viewport:{width:2172,height:950}});page.setDefaultTimeout(4000);
  page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url());});
  await page.goto(pathToFileURL(file).href);
  await check('Original export/generate/save order, compact title and date controls are retained',async()=>{
   await expect(page.locator('#variant')).toHaveValue('original');
   assert.deepEqual(await page.locator('.export-actions button').allTextContents(),['원본 JSON','JSON','CSV','Excel','생성','저장']);
   assert.deepEqual(await page.locator('#shell > .titlebar button').evaluateAll(bs=>bs.map(b=>b.getAttribute('aria-label'))),['설정','닫기']);
   assert.equal(await page.locator('#shell > .titlebar').evaluate(el=>el.getBoundingClientRect().height),34);
   assert.equal(await page.locator('#startDate').evaluate(el=>el.getBoundingClientRect().width),92);
   await expect(page.locator('#saveRows')).toBeDisabled();await expect(page.locator('#dateKey')).toHaveValue('');
   await page.locator('#previousYear').click();await expect(page.locator('#startDate')).toHaveValue('2025.07.01');await page.locator('#nextYear').click();await expect(page.locator('#endDate')).toHaveValue('2026.12.31');
  });
  await check('Extraction retains table tabs rather than DB business tabs; representative item names visible',async()=>{
   await expect(page.locator('#stageTabs [data-stage]')).toHaveCount(0);await expect(page.locator('#stageTabs [data-table]')).toHaveCount(3);
   await count(9);await expect(page.locator('#grid [data-items]').first()).toContainText(/.+ 외 1건/);
   await expect(page.locator('#grid [data-items]').first()).toContainText('액정모니터');await expect(page.locator('#sidebar')).toBeHidden();await expect(page.locator('#toggleSidebar')).toBeHidden();await shot('00-original');
  });
  await check('Seven original settings tabs and screen condition controls exist in both variants',async()=>{
   for(const variant of ['original','proposal']){
    await page.locator('#variant').selectOption(variant);await openSettings();
    assert.deepEqual(await settings().locator('#settingsMainTabs button').allTextContents(),['일반','키 사전','값 사전','수집 화면','단축키','문서 연결','공유 설정']);
    await expect(settings().getByLabel('테마',{exact:true})).toBeVisible();await expect(settings().getByLabel('추출 범위',{exact:true})).toBeVisible();await expect(settings().getByText('빈 열 숨김',{exact:true})).toBeVisible();
    if(variant==='original')await shot('11-original-settings');await mainTab('collection');if(variant==='proposal')await subTab('screen');await expect(page.locator('#defaultRules')).toBeChecked();await expect(page.locator('[data-rule-key="areaCd"]')).toHaveCount(6);await cancelSettings();
   }
  });
  await check('Data map table IDs, screen codes and displayed source keys match references',async()=>{
   const filenames=(await fs.readdir(path.join(root,'참고자료'))).filter(n=>/^data_map.*\.txt$/.test(n)),maps=await Promise.all(filenames.map(async n=>JSON.parse(await fs.readFile(path.join(root,'참고자료',n),'utf8'))));
   const keys=new Set(maps.flatMap(d=>[...Object.keys(d.pointInfo||{}),...Object.values(d.tables||{}).flatMap(rows=>Array.isArray(rows)?rows.flatMap(r=>Object.keys(r)):[])]));
   const configs=await page.evaluate(()=>Object.entries(stages).filter(([,c])=>c.file).map(([id,c])=>({id,file:c.file,tableId:c.tableId,code:c.screenCode,keys:c.key,columns:[...c.columns,...c.itemColumns].map(c=>c[0])})));
   for(const c of configs){const map=maps[filenames.indexOf(c.file)];assert.ok(map,c.file);assert.ok(Object.hasOwn(map.tables,c.tableId),c.tableId);assert.deepEqual([map.pointInfo.areaCd,map.pointInfo.depth1,map.pointInfo.depth2,map.pointInfo.depth3||''],c.code);for(const key of [...c.keys,...c.columns])assert.ok(keys.has(key),c.id+' '+key);}
   report.referenceFiles=configs.map(c=>c.file);assert.equal(configs.length,3);
  });
  await check('Proposal duplicate flags default on; independent toggles preserve changed rows',async()=>{
   await count(6);await openSettings();await expect(page.locator('#draftHideScreen')).toBeChecked();await expect(page.locator('#draftHideDb')).toBeChecked();await cancelSettings();await shot('01-proposal');
   await flags(false,true);await count(7);await expect(page.locator('[data-table="repeat"]')).toBeVisible();
   await flags(false,false);await count(9);await flags(true,false);await count(8);await expect(page.locator('[data-table="repeat"]')).toHaveCount(0);
   await flags(true,true);await count(6);await expect(page.locator('#grid .badge.changed')).toHaveCount(2);await expect(page.locator('#counts')).toContainText('중복 숨김 3건');
   await mode('result');await count(6);await mode('db');await count(10);await expect(page.locator('#grid .badge.existing')).toHaveCount(2);await mode('extract');
  });
  await check('Receipt/bid/contract details retain leading zeros, zero, false, empty and exact decimal values',async()=>{
   for(const id of ['receipt','bid','contract']){
    await stage(id);await count(6);await expect(page.locator('#grid tbody tr').first()).toContainText('01');
    await expect(page.locator('#grid')).toContainText('9,007,199,254,740,993.25');await expect(page.locator('#grid [data-items]').first()).toContainText(/.+ 외 1건/);
    await page.locator('#grid [data-row="'+id+'-2"] [data-items]').click();await expect(page.locator('#itemGrid')).toContainText('00001238');await expect(page.locator('#itemGrid tbody tr')).toHaveCount(2);
    await expect(page.locator('#itemGrid').getByRole('cell',{name:'0',exact:true})).toHaveCount(2);
    if(id==='contract')await expect(page.locator('#itemGrid').getByRole('cell',{name:'false',exact:true})).toHaveCount(2);
    if(id==='contract')await shot('12-items-detail');await page.locator('#items [data-close="items"]').first().click();
   }
   const cells=await page.locator('#grid [data-row="contract-4"] td').allTextContents();assert.equal(cells[5],'');
   await page.locator('[data-table="items"]').click();await count(12);await page.locator('[data-table="main"]').click();
   await page.getByRole('button',{name:'표 속성',exact:true}).click();await page.locator('#showRaw').check();await expect(page.locator('#grid thead')).toContainText('ctrtNo');await page.getByRole('button',{name:'속성 닫기'}).click();await shot('02-source-items');
  });
  await check('Column filter reset preserves search; original tab action order and user columns retained',async()=>{
   await page.locator('#search').fill('UPS');await count(1);await page.getByRole('button',{name:'변경차수 열 필터',exact:true}).click();await page.locator('#columnTerm').fill('02');await page.locator('#applyColumn').click();await count(0);
   await page.locator('#resetFilters').click();await count(1);await expect(page.locator('#search')).toHaveValue('UPS');await page.locator('#search').fill('');
   await mode('db');assert.deepEqual(await page.locator('.tab-actions > button').allTextContents(),['종결','사용자 열 숨김','열 필터 해제','']);
   await expect(page.locator('#completionFilter')).toBeVisible();await expect(page.locator('#grid thead')).toContainText('미종결금액');
   await page.locator('#hiddenUser').click();await expect(page.locator('#grid thead')).not.toContainText('미종결금액');await page.locator('#hiddenUser').click();
   await select('contract-0');await page.locator('#finishSelected').click();await expect(page.locator('#saveRows')).toBeEnabled();await page.locator('#saveRows').click();await expect(page.locator('#message')).toContainText('실제 DB 저장은 수행하지 않습니다.');
   await page.locator('#completionFilter').selectOption('closed');await count(2);await page.locator('#completionFilter').selectOption('all');await mode('extract');
  });
  await check('Existing dictionary, shortcuts, document and shared tabs have editable mock controls',async()=>{
   await openSettings();await mainTab('dictionary');await expect(page.locator('select[data-dict-field="type"]').first().locator('option')).toHaveCount(7);await settings().getByLabel('ctrtNo 표시명',{exact:true}).fill('계약 식별번호');
   await mainTab('shortcuts');await settings().getByLabel('런처 추가창 단축키',{exact:true}).press('Alt+Shift+L');await expect(settings().getByLabel('런처 추가창 단축키',{exact:true})).toHaveValue('Alt+Shift+L');
   await mainTab('documents');await expect(settings().locator('[data-document]')).toHaveCount(3);await mainTab('shared');await page.locator('#sharedImport').click();await expect(page.locator('#sharedPreview')).toContainText('샘플 설정 적용 미리보기');await page.locator('#sharedCancel').click();await expect(page.locator('#sharedPreview')).toBeEmpty();await applySettings();
   await expect(page.locator('#grid thead')).toContainText('계약 식별번호');await openSettings();await mainTab('dictionary');await settings().getByLabel('ctrtNo 표시명',{exact:true}).fill('계약번호');await applySettings();
  });
  await check('Settings drafts survive tab changes; close/Escape cancel and preserve existing screen rule edits',async()=>{
   await collection('screen');await page.getByLabel('화면 이름',{exact:true}).fill('취소할 화면');await subTab('table');await subTab('screen');await expect(page.getByLabel('화면 이름',{exact:true})).toHaveValue('취소할 화면');await cancelSettings();
   await collection('screen');await expect(page.getByLabel('화면 이름',{exact:true})).toHaveValue('계약관리 목록');await page.getByLabel('화면 이름',{exact:true}).fill('Escape 취소');await page.keyboard.press('Escape');
   await collection('screen');await expect(page.getByLabel('화면 이름',{exact:true})).toHaveValue('계약관리 목록');await page.locator('#defaultRules').uncheck();await page.locator('[data-rule="0"][data-rule-key="depth3"]').fill('custom');await page.locator('#defaultRules').check();await page.locator('#defaultRules').uncheck();await expect(page.locator('[data-rule="0"][data-rule-key="depth3"]')).toHaveValue('custom');await cancelSettings();
  });
  await check('Independent inspection table registration and composite key light interaction',async()=>{
   await stage('inspection');await collection('table');await page.locator('#registered').check();await page.getByLabel('표 이름',{exact:true}).fill('검수확인');await subTab('key');await expect(page.locator('#keyPreview')).toHaveText('inspectionNo + inspectionOrd');await page.locator('[data-key="inspectionOrd"]').uncheck();await expect(page.locator('#keyPreview')).toHaveText('inspectionNo');await page.locator('[data-key="inspectionOrd"]').check();await applySettings();
   await mode('db');await expect(page.locator('[data-stage="inspection"]')).toContainText('검수확인');await expect(page.locator('#grid').getByRole('cell',{name:'false',exact:true})).toHaveCount(10);
   await collection('table');await expect(page.locator('#registered')).toBeChecked();await cancelSettings();await mode('extract');await stage('contract');
  });
  await check('Relation candidates confirm/unlink, ambiguous disabled and cancelled draft untouched',async()=>{
   await collection('relation');await expect(settings().getByRole('button',{name:'연결 확인',exact:true})).toHaveCount(3);await expect(settings().locator('[data-relation="1"]')).toBeDisabled();await settings().locator('[data-relation="0"]').click();await cancelSettings();
   await collection('relation');await expect(settings().locator('[data-candidate-state="0"]')).toHaveText('미연결');await settings().locator('[data-relation="0"]').click();await applySettings();
   await collection('relation');await expect(settings().locator('[data-candidate-state="0"]')).toHaveText('연결됨');await settings().locator('[data-relation="0"]').click();await applySettings();
   await collection('relation');await expect(settings().locator('[data-candidate-state="0"]')).toHaveText('미연결');await shot('03-settings-relations');await cancelSettings();
  });
  await check('Collapsed contextual sidebar distinguishes full business key including sequence',async()=>{
   await expect(page.locator('#sidebar')).toBeHidden();await select('contract-0');await page.locator('#toggleSidebar').click();await expect(page.locator('#sidebarBody')).toContainText('납품 장소 확인');await expect(page.locator('#sidebarBody')).not.toContainText('차수 02 별도 확인');await expect(page.locator('#sidebarBody')).toContainText('계약 목록 확인 순서');await expect(page.locator('#sidebarBody')).not.toContainText('공통 업무 메모');await shot('04-sidebar');
   await select('contract-1');await expect(page.locator('#sidebarBody')).toContainText('차수 02 별도 확인');await expect(page.locator('#sidebarBody')).not.toContainText('납품 장소 확인');
  });
  await check('Shared note editor supports cancel, escaped content, scope filtering and manager editing',async()=>{
   await page.locator('#quickNote').click();await expect(page.locator('#editScope')).toHaveValue('business');await expect(page.locator('#editTarget')).toHaveValue('contract-1');await page.locator('#editName').fill('취소할 메모');await page.locator('#editor').getByRole('button',{name:'취소',exact:true}).click();await expect(page.locator('#sidebarBody')).not.toContainText('취소할 메모');
   await page.locator('#quickNote').click();await page.locator('#editName').fill('검토 메모 (시안)');await page.locator('#editContent').fill('<b>수량 0과 false 확인</b>');await page.locator('#editor').getByRole('button',{name:'시안에 반영',exact:true}).click();await expect(page.locator('#sidebarBody')).toContainText('<b>수량 0과 false 확인</b>');assert.equal(await page.locator('#sidebarBody b').count(),0);
   await page.locator('#manageAll').click();await page.locator('#managerSearch').fill('검토 메모 (시안)');await expect(page.locator('#managerList .manager-row')).toHaveCount(1);await page.locator('#managerList [data-note]').first().click();await expect(page.locator('#editorTitle')).toHaveText('메모 편집');await expect(page.locator('#editContent')).toHaveValue('<b>수량 0과 false 확인</b>');await page.locator('#editor').getByRole('button',{name:'취소',exact:true}).click();
   await page.locator('#managerSearch').fill('');await page.locator('#managerScope').selectOption('general');await expect(page.locator('#managerList')).toContainText('공통 업무 메모');await expect(page.locator('#managerList')).not.toContainText('납품 장소 확인');await page.locator('#managerScope').selectOption('all');await shot('05-notes-manager');await page.locator('#manager [data-close="manager"]').first().click();
  });
  await check('Schedule date/list samples share editor and have no notifications',async()=>{
   await page.locator('#quickSchedule').click();await page.locator('#editName').fill('납품 확인 일정');await page.locator('#editDate').fill('2026-10-20');await page.locator('#editor').getByRole('button',{name:'시안에 반영',exact:true}).click();await expect(page.locator('#sidebarBody')).toContainText('2026-10-20');
   await page.locator('#manageAll').click();await page.locator('[data-manager="schedule"]').click();await expect(page.locator('#managerList')).toContainText('납품 확인 일정');await expect(page.locator('#managerCounts')).toContainText('일정 알림 없음');await shot('06-schedules-manager');await page.locator('#manager [data-close="manager"]').first().click();
  });
  await check('Narrow original/proposal grid, settings, sidebar and editor stay in viewport',async()=>{
   await page.setViewportSize({width:375,height:812});await noOverflow();await shot('07-narrow-sidebar');await page.locator('#closeSidebar').click();
   await collection('screen');await noOverflow();assert.ok(await settings().evaluate(el=>el.getBoundingClientRect().right<=innerWidth));await shot('08-narrow-settings');await cancelSettings();
   await page.locator('#toggleSidebar').click();await page.locator('#manageAll').click();await page.locator('#managerAdd').click();await noOverflow();assert.ok(await page.locator('#editor').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));await shot('09-narrow-editor');await page.locator('#editor').getByRole('button',{name:'취소',exact:true}).click();await page.locator('#manager [data-close="manager"]').first().click();
   await page.locator('#variant').selectOption('original');await noOverflow();await shot('10-narrow-original');await page.setViewportSize({width:2172,height:950});await page.locator('#variant').selectOption('proposal');
  });
  await check('Existing export/generation controls show explicit sample previews; close terminates preview',async()=>{
   for(const id of ['rawJson','jsonPreview','csvPreview','excelPreview','generatePreview']){await page.locator('#'+id).click();await expect(page.locator('#information')).toBeVisible();await expect(page.locator('#informationBody')).toContainText('시안');await page.locator('#information [data-close="information"]').click();}
   await page.locator('#closeShell').click();await expect(page.locator('#closedView')).toBeVisible();await page.locator('#restoreShell').click();await expect(page.locator('#shell')).toBeVisible();
  });
  await check('Reload restores original variant and initial samples; browser errors and external requests zero',async()=>{
   await page.reload();await expect(page.locator('#variant')).toHaveValue('original');await count(9);await expect(page.locator('#sidebar')).toBeHidden();await page.locator('#variant').selectOption('proposal');await count(6);
   await page.locator('#toggleSidebar').click();await page.locator('#manageAll').click();await expect(page.locator('#managerList')).not.toContainText('검토 메모 (시안)');await page.locator('#manager [data-close="manager"]').first().click();
   assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.externalRequests,[]);
  });
  report.status='passed';console.log(JSON.stringify({status:report.status,checks:report.checks.length,pageErrors:0,consoleErrors:0,externalRequests:0}));
 }catch(error){report.status='failed';report.error=String(error);process.exitCode=1;console.error(error);}
 finally{if(browser)await browser.close();await fs.writeFile(path.join(output,report.status==='passed'?'result-restoration.json':'restoration-failure-'+Date.now()+'.json'),JSON.stringify(report,null,2)+'\n');}
}

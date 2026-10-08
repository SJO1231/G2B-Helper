// Development verification only. Uses localhost pages and readonly supplied JSON imports in an ephemeral browser context.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist/mvp-extension');
const artifacts = path.join(root, 'artifacts/mvp-ui');
await fsp.mkdir(artifacts, { recursive: true });
const required = ['main.html', 'main.js', 'main.css', 'widget.js', 'background.js'];
const evidence = { startedAt: new Date().toISOString(), fixture: 'Synthetic standalone views, readonly supplied JSON imports, and mock transport content-widget DOM', checks: [], console: [], pageErrors: [], screenshots: [], downloads: [], build: {}, limitation: 'Local development UI; real G2B login, extension injection and Native SQLite round-trip are not exercised.' };
for (const file of required) {
  const bytes = await fsp.readFile(path.join(dist, file));
  evidence.build[file] = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (url.pathname === '/widget-test.html') {
      response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
      response.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Widget synthetic transport fixture</title></head><body style="font:16px sans-serif;background:#edf1f4"><h1>합성 페이지</h1><p>mock transport content-widget DOM 시험</p></body></html>'); return;
    }
    const file = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(dist + path.sep)) { response.writeHead(403); response.end(); return; }
    const data = await fsp.readFile(file);
    const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8' };
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser, page;
const grid = '.shell > .grid-area > .mvp-grid';
const mainGrid = () => page.locator(grid);
const count = () => mainGrid().locator('.mvp-grid-count');
const check = async (name, run) => {
  const item = { name, status: 'running' }; evidence.checks.push(item);
  try { await run(); item.status = 'passed'; }
  catch (error) {
    item.status = 'failed'; item.error = String(error?.stack || error);
    if (page && !page.isClosed()) {
      const filename = 'failure-' + evidence.checks.length + '.png';
      await page.screenshot({ path: path.join(artifacts, filename), fullPage: true }).catch(() => {});
      item.screenshot = filename;
    }
  }
};
const screenshot = async name => { await page.screenshot({ path: path.join(artifacts, name), fullPage: true }); evidence.screenshots.push(name); };
const field = async title => {
  const fields = await mainGrid().locator('.tabulator-header .tabulator-col[tabulator-field]').evaluateAll(elements => elements.map(element => ({ title: element.querySelector('.mvp-grid-column-title > span')?.textContent, field: element.getAttribute('tabulator-field') })));
  const found = fields.find(entry => entry.title === title); assert.ok(found, 'Missing header: ' + title); return found.field;
};
const header = async title => mainGrid().locator('.tabulator-header .tabulator-col[tabulator-field="' + await field(title) + '"]');
const cell = async (title, index = 0) => mainGrid().locator('.tabulator-table .tabulator-row').nth(index).locator('.tabulator-cell[tabulator-field="' + await field(title) + '"]');
const waitRows = n => expect(count()).toHaveText(new RegExp('^' + n + ' /'));
const goto = async query => {
  await page.goto(origin + '/main.html?' + query);
  await expect(mainGrid().locator('.tabulator-header')).toBeVisible();
  await expect(count()).not.toHaveText('');
};
const fixture = {
  pointInfo: { sample: true },
  tables: { '합성 표': [
    { code: '0001', amount: '12345678901234567890.123456789', flag: false, date: '20261001', blank: '', nested: [{ id: '0001', qty: 0, flag: false }, 0, false], '': 0, 'a.b': '00001', '__prefixed': false },
    { code: '0002', amount: 1234.56789, flag: true, date: '20261002', blank: null, nested: [], '': 0, 'a.b': '00002', '__prefixed': false },
    { code: '0003', amount: 0, flag: false, date: '20261003', blank: '', nested: null, '': 0, 'a.b': '00003', '__prefixed': false },
    {},
  ], '빈 표': [] },
};
const loadFixture = async () => {
  await goto('mode=extract');
  await page.getByLabel('JSON 열기', { exact: true }).setInputFiles({ name: 'synthetic-grid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await waitRows(4);
};
const openFilter = async title => {
  await (await header(title)).hover();
  await mainGrid().getByRole('button', { name: title + ' 필터', exact: true }).click();
  await expect(mainGrid().locator('.mvp-grid-panel')).toBeVisible();
};
const textFilter = async (title, mode, terms) => {
  await openFilter(title);
  await mainGrid().getByLabel('필터 조건', { exact: true }).selectOption(mode);
  await mainGrid().getByLabel('검색값 목록', { exact: true }).fill(terms);
  await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '적용', exact: true }).click();
};
const clearFilters = () => page.locator('.shell > .tabs').getByRole('button', { name: '필터 해제', exact: true }).click();
const openProperties = () => mainGrid().getByRole('button', { name: '속성', exact: true }).click();
const addUserColumn = async () => { await openProperties(); await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '사용자 열 추가', exact: true }).click(); };
const editor = () => mainGrid().getByLabel('셀 편집', { exact: true });
const selectWithoutEditing = async title => {
  await (await cell(title)).click();
  await expect(editor()).not.toBeVisible();
};
const download = async (name, buttonName) => {
  const event = page.waitForEvent('download');
  await page.locator('.shell > .toolbar').getByRole('button', { name: buttonName, exact: true }).click();
  const file = await event, destination = path.join(artifacts, name); await file.saveAs(destination);
  evidence.downloads.push({ name, suggested: file.suggestedFilename(), bytes: (await fsp.stat(destination)).size });
  return destination;
};
try {
  const installed = chromium.executablePath();
  const executablePath = [installed, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
  assert.ok(executablePath, 'No existing Chromium, Chrome or Edge binary found; no browser installation attempted.');
  browser = await chromium.launch({ executablePath, headless: true });
  evidence.browser = { executablePath, version: browser.version(), profile: 'ephemeral' };
  const context = await browser.newContext({ viewport: { width: 1180, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage();
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) evidence.console.push({ type: message.type(), text: message.text(), location: message.location() }); });
  page.on('pageerror', error => evidence.pageErrors.push(String(error.stack || error)));
  page.on('dialog', dialog => dialog.accept().catch(() => {}));
  await check('extract sample: 24 rows, source zero/false, minimum grid size, no native save', async () => {
    await goto('mode=extract'); await waitRows(24);
    await expect(page.getByLabel('시작일', { exact: true })).toBeVisible();
    await expect(page.getByLabel('종료일', { exact: true })).toBeVisible();
    await expect(page.getByLabel('날짜 기준', { exact: true })).toHaveValue('');
    await expect(page.locator('select[aria-label="종결 필터"]')).toBeHidden();
    await expect(page.locator('.tab-actions').getByRole('button', { name: '종결', exact: true })).toBeHidden();
    await expect(await cell('수량')).toHaveText('0'); await expect(await cell('완료')).toHaveText('false');
    const box = await mainGrid().boundingBox(); assert.ok(box.height >= 190);
    await expect(page.locator('.shell > .toolbar').getByRole('button', { name: '저장', exact: true })).toBeVisible();
    await expect(page.locator('.shell > .toolbar').getByRole('button', { name: '저장', exact: true })).toBeDisabled();
    await screenshot('01-extract-light.png');
  });
  await check('file JSON: every source key, identifiers, decimals and an original empty row survive', async () => {
    await loadFixture();
    await expect(await cell('(빈 키)')).toHaveText('0'); await expect(await cell('a.b')).toHaveText('00001'); await expect(await cell('__prefixed')).toHaveText('false');
    await expect(await cell('amount')).toHaveText('12345678901234567890.123456789');
    assert.equal(await (await header('blank')).isVisible(), false);
    const saved = JSON.parse(await fsp.readFile(await download('source-tables.json', 'JSON'), 'utf8'));
    assert.deepEqual(saved.tables['합성 표'], fixture.tables['합성 표']); assert.deepEqual(saved.tables['빈 표'], []);
  });
  await check('nested array click opens the same GridRenderer with primitive false/zero detail rows', async () => {
    await (await cell('nested')).locator('.mvp-grid-nested').click();
    const dialog = page.locator('dialog[open]'); await expect(dialog.locator('.mvp-grid')).toBeVisible();
    await expect(dialog.locator('.mvp-grid-count')).toHaveText('3 / 3행');
    await expect(dialog.locator('.tabulator-table')).toContainText('false');
    await dialog.locator('.titlebar').getByRole('button', { name: '닫기', exact: true }).click();
  });
  await check('filter values: search and checkbox selection', async () => {
    await openFilter('code'); await mainGrid().getByLabel('검색된 값 전체 선택', { exact: true }).uncheck();
    await mainGrid().getByLabel('필터 값 검색', { exact: true }).fill('0001'); await mainGrid().getByLabel('0001', { exact: true }).check();
    await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '적용', exact: true }).click(); await waitRows(1); await clearFilters(); await waitRows(4);
  });
  await check('multi-text includes/exclude, value selection and multiple-column AND', async () => {
    await textFilter('code', 'includes', '0001\n0002'); await waitRows(2);
    await openFilter('flag'); await mainGrid().getByLabel('검색된 값 전체 선택', { exact: true }).uncheck(); await mainGrid().getByLabel('필터 값 검색', { exact: true }).fill('false'); await mainGrid().getByLabel('false', { exact: true }).check(); await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '적용', exact: true }).click(); await waitRows(1);
    await textFilter('code', 'exclude', '0001'); await waitRows(1); await clearFilters(); await waitRows(4);
  });
  await check('hidden columns: restore empty source column and hide/restore from header menu', async () => {
    await openProperties(); await mainGrid().getByLabel('blank 표시', { exact: true }).check();
    await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '닫기', exact: true }).click(); await expect(await header('blank')).toBeVisible();
    await (await header('code')).click({ button: 'right' }); await mainGrid().locator('.tabulator-menu').getByText('열 숨기기', { exact: true }).click();
    await expect(await header('code')).not.toBeVisible();
    await openProperties(); await mainGrid().getByLabel('code 표시', { exact: true }).check();
    await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '닫기', exact: true }).click(); await expect(await header('code')).toBeVisible();
  });
  await check('column money/date type formatting leaves all source values unchanged', async () => {
    for (const [title, label] of [['amount', '금액'], ['date', '날짜']]) {
      await (await header(title)).click({ button: 'right' }); await mainGrid().locator('.tabulator-menu').getByText('열 타입', { exact: true }).click();
      await mainGrid().locator('.tabulator-menu').getByText(label, { exact: true }).click();
    }
    await expect(await cell('amount')).toHaveText('12,345,678,901,234,567,890.123456789'); await expect(await cell('date')).toHaveText('2026.10.01');
    // The extraction table is view only (#42); date input checks run on a DB user column below.
    await (await cell('date')).dblclick(); await expect(editor()).not.toBeVisible(); await expect(await cell('date')).toHaveText('2026.10.01');
  });
  await check('scroll to worksheet padding: all empty region rows have numbers', async () => {
    const holder = mainGrid().locator('.tabulator-tableholder'); await holder.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(100);
    const numbers = await mainGrid().locator('.tabulator-row-header').allTextContents();
    assert.ok(numbers.some(text => Number(text) > 4), 'No numbered empty worksheet row found');
    await holder.evaluate(element => { element.scrollTop = 0; });
  });
  await check('extraction is view only (#42): double click, typing and Delete leave the source values', async () => {
    await (await cell('code')).dblclick(); await expect(editor()).not.toBeVisible();
    await page.keyboard.type('9'); await page.keyboard.press('Delete'); await expect(editor()).not.toBeVisible();
    await expect(await cell('code')).toHaveText('0001'); await expect(await cell('amount')).toHaveText('12,345,678,901,234,567,890.123456789');
  });
  await check('range drag selection and raw clipboard copy; paste does not edit the view-only extraction', async () => {
    const from = await (await cell('code')).boundingBox(), to = await (await cell('amount', 1)).boundingBox();
    await page.mouse.move(from.x + 8, from.y + 10); await page.mouse.down(); await page.mouse.move(to.x + 40, to.y + 12, { steps: 8 }); await page.mouse.up();
    assert.ok(await mainGrid().locator('.tabulator-range-selected').count() >= 4, 'Range did not select a rectangle');
    await page.keyboard.press('Control+c'); const copied = await page.evaluate(() => navigator.clipboard.readText()); assert.ok(copied.includes('0001') && copied.includes('12345678901234567890.123456789') && copied.includes('1234.56789'));
    await selectWithoutEditing('code'); await page.evaluate(() => navigator.clipboard.writeText('0008\r\n')); await page.keyboard.press('Control+v'); await expect(await cell('code')).toHaveText('0001');
  });
  await check('settings black/white keeps the view; three screenshots include dark mode', async () => {
    await page.locator('.shell > .titlebar').getByRole('button', { name: '설정', exact: true }).click(); const settings = page.locator('dialog[open]');
    await settings.getByLabel('테마', { exact: true }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await settings.getByRole('button', { name: '저장', exact: true }).click();
    await expect(await cell('code')).toHaveText('0001'); await screenshot('02-extract-dark.png');
    await page.locator('.shell > .titlebar').getByRole('button', { name: '설정', exact: true }).click();
    await page.locator('dialog[open]').getByLabel('테마', { exact: true }).selectOption('light'); await page.locator('dialog[open]').getByRole('button', { name: '저장', exact: true }).click();
  });
  await check('extraction has no user columns (view only) and display names keep source keys', async () => {
    await openProperties(); await expect(mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '사용자 열 추가', exact: true })).toHaveCount(0);
    await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '닫기', exact: true }).click();
    await (await header('code')).click({ button: 'right' }); await expect(mainGrid().locator('.tabulator-menu').getByText('사용자 열 추가', { exact: true })).toHaveCount(0);
    await mainGrid().locator('.tabulator-menu').getByText('표시명 설정', { exact: true }).click();
    await mainGrid().getByLabel('열 표시명').fill('코드 표시'); await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '적용', exact: true }).click();
    await expect(await header('코드 표시')).toBeVisible();
  });
  await check('switching to the empty table and back keeps the extraction rows', async () => {
    const tabs = page.locator('.shell > .tabs'); await tabs.getByRole('button', { name: '빈 표', exact: true }).click(); await waitRows(0);
    await tabs.getByRole('button', { name: '합성 표', exact: true }).click(); await waitRows(4); await expect(await cell('코드 표시')).toHaveText('0001');
  });
  await check('Excel and CSV downloads preserve identifier and decimal values; Excel follows filters and mapped headers', async () => {
    await page.getByLabel('검색', { exact: true }).fill('0002'); await waitRows(1);
    const excel = XLSX.read(await fsp.readFile(await download('filtered.xlsx', 'Excel')));
    const matrix = XLSX.utils.sheet_to_json(excel.Sheets['자료'], { header: 1 }); assert.ok(matrix[0].includes('코드 표시')); assert.equal(matrix.length, 2); assert.ok(matrix[1].includes('0002')); assert.ok(matrix[1].includes(1234.56789)); assert.ok(matrix[1].includes(true));
    await page.getByLabel('검색', { exact: true }).fill('');
    const csv = await fsp.readFile(await download('raw-values.csv', 'CSV'), 'utf8'); assert.ok(csv.includes('0002') && csv.includes('1234.56789'));
    await page.getByRole('button', { name: '원본 JSON', exact: true }).click(); const dialog = page.locator('dialog[open]');
    const raw = JSON.parse(await dialog.locator('.raw-view').textContent()); assert.deepEqual(raw, fixture);
    await dialog.locator('.titlebar').getByRole('button', { name: '닫기', exact: true }).click();
  });
  await check('column drag moves header without renaming source fields', async () => {
    const source = (await header('amount')).locator('.mvp-grid-drag'), target = (await header('코드 표시')).locator('.mvp-grid-column-title');
    const before = await mainGrid().locator('.tabulator-header .tabulator-col[tabulator-field]').evaluateAll(nodes => nodes.map(node => node.getAttribute('tabulator-field')));
    await source.dragTo(target, { targetPosition: { x: 5, y: 8 } });
    const after = await mainGrid().locator('.tabulator-header .tabulator-col[tabulator-field]').evaluateAll(nodes => nodes.map(node => node.getAttribute('tabulator-field')));
    assert.notDeepEqual(after, before, 'Header order did not move');
  });
  await check('contract sample: closed/open filtering and derived readonly cells', async () => {
    await goto('mode=db&stage=contract'); await waitRows(24);
    await expect(page.getByLabel('시작일', { exact: true })).toBeVisible();
    await expect(page.getByLabel('종료일', { exact: true })).toBeVisible();
    await expect(page.locator('select[aria-label="종결 필터"]')).toBeVisible();
    await expect(page.locator('.tab-actions').getByRole('button', { name: '종결', exact: true })).toBeVisible();
    await screenshot('03-contract-light.png');
    await page.locator('select[aria-label="종결 필터"]').selectOption('closed'); await waitRows(1);
    await page.locator('select[aria-label="종결 필터"]').selectOption('open'); await waitRows(23);
    await page.locator('select[aria-label="종결 필터"]').selectOption('all'); await waitRows(24);
    for (const title of ['지체일수', '미종결금액', '원본 JSON']) {
      const chosen = await cell(title), before = await chosen.textContent(); await chosen.click(); await expect(editor()).not.toBeVisible(); await page.keyboard.press('Delete'); await expect(chosen).toHaveText(before);
    }
  });
  await check('contract selected-row completion button toggles only the selected user boolean', async () => {
    await (await cell('계약번호')).click(); await expect(editor()).not.toBeVisible();
    await page.locator('.tab-actions').getByRole('button', { name: '종결', exact: true }).click();
    await expect(await cell('종결')).toHaveText('true'); await expect(await cell('종결', 1)).toHaveText('false');
  });
  await check('contract source amount is read only; user amount/date edits keep precision and recalculate readonly values (#42)', async () => {
    await goto('mode=db&stage=contract');
    await (await cell('계약금액')).dblclick(); await expect(editor()).not.toBeVisible(); await expect(await cell('계약금액')).toHaveText('35,608,652.5');
    await (await cell('종결금액')).dblclick(); await expect(editor()).toBeVisible(); await editor().fill('1.000000000000000001'); await editor().press('Tab'); await expect(await cell('종결금액')).toHaveText('1.000000000000000001');
    await (await cell('종결금액')).dblclick(); await editor().fill('999'); await editor().press('Escape'); await expect(await cell('종결금액')).toHaveText('1.000000000000000001');
    await (await cell('종결금액')).dblclick(); await editor().fill('1000.1234567890123456789'); await editor().press('Enter');
    await expect(await cell('미종결금액')).toHaveText('35,607,652.3765432109876543211');
    await (await cell('지정일')).dblclick(); await expect(editor()).toBeVisible(); await editor().fill('2026.02.30'); await editor().press('Enter');
    await expect(page.locator('.shell > .status')).toContainText('유효한'); await expect(editor()).toBeHidden(); await expect(await cell('지정일')).toHaveText('2026.11.01');
    await (await cell('지정일')).dblclick(); await editor().fill('20261102'); await editor().press('Enter');
    await expect(await cell('지체일수')).toHaveText('6');
  });
  await check('DB user column add/hide/show/delete and raw paste into a user column (#42)', async () => {
    await goto('mode=db&stage=receipt');
    await addUserColumn(); await mainGrid().getByLabel('사용자 열 이름').fill('메모');
    await mainGrid().locator('.mvp-grid-panel').getByRole('button', { name: '추가', exact: true }).click(); await expect(await header('메모')).toBeVisible();
    await page.getByRole('button', { name: '사용자 열 숨김', exact: true }).click(); await expect(await header('메모')).not.toBeVisible();
    await page.getByRole('button', { name: '사용자 열 숨김', exact: true }).click(); await expect(await header('메모')).toBeVisible();
    await (await header('메모')).click({ button: 'right' }); await mainGrid().locator('.tabulator-menu').getByText('사용자 열 삭제', { exact: true }).click();
    await selectWithoutEditing('담당'); await page.evaluate(() => navigator.clipboard.writeText('0008\r\n')); await page.keyboard.press('Control+v'); await expect(await cell('담당')).toHaveText('0008');
  });
  await check('sorting changes display order while persisted row buffers retain record input order', async () => {
    await goto('mode=db&stage=contract'); const sort = (await header('계약번호')).locator('.tabulator-col-sorter'); await sort.click(); await sort.click();
    await expect(await cell('계약번호')).toHaveText('SAMPLE-024');
    const saved = JSON.parse(await fsp.readFile(await download('contract-order.json', 'JSON'), 'utf8'));
    assert.equal(saved[0].ctrtNo, 'SAMPLE-001'); assert.equal(saved[23].ctrtNo, 'SAMPLE-024');
  });
  await check('date window +/-1 year selects full calendar year and reapplies the selected source date', async () => {
    await goto('mode=db&stage=contract'); await (await header('ctrtDt')).click({button:'right'}); await mainGrid().locator('.tabulator-menu').getByText('열 타입',{exact:true}).click(); await mainGrid().getByText('날짜',{exact:true}).click(); await page.getByLabel('날짜 기준').selectOption('ctrtDt'); const start = page.getByLabel('시작일'), end = page.getByLabel('종료일'), before = [await start.inputValue(), await end.inputValue()];
    await page.getByRole('button', { name: '+1년', exact: true }).click(); await waitRows(0);
    assert.equal(Number((await start.inputValue()).slice(0, 4)), Number(before[0].slice(0, 4)) + 1); assert.equal(Number((await end.inputValue()).slice(0, 4)), Number(before[1].slice(0, 4)) + 1);
    await page.getByRole('button', { name: '−1년', exact: true }).click(); await waitRows(24);
    assert.equal(await start.inputValue(), before[0].slice(0,4)+'.01.01'); assert.equal(await end.inputValue(), before[0].slice(0,4)+'.12.31');
  });
  const validateProvidedTables = async tables => {
    const tabButtons = page.locator('.shell > .tabs > .tab-list > button'); assert.equal(await tabButtons.count(), Object.keys(tables).length);
    assert.ok(!(await tabButtons.allTextContents()).some(text => text.startsWith('pointInfo (')));
    const metadata = [];
    for (const [key, sourceRows] of Object.entries(tables)) {
      await tabButtons.filter({ hasText: key }).click(); await waitRows(sourceRows.length);
      const keys = [...new Set(sourceRows.flatMap(row => Object.keys(row)))];
      assert.equal(await mainGrid().locator('.tabulator-header .tabulator-col[tabulator-field]').count(), keys.length, 'Source-column count mismatch');
      let zeros = 0, falses = 0;
      for (const [index, row] of sourceRows.entries()) for (const [columnKey, value] of Object.entries(row)) {
        if (value !== 0 && value !== false) continue;
        const chosen = mainGrid().locator('.tabulator-table .tabulator-row').nth(index).locator('.tabulator-cell[tabulator-field="f' + keys.indexOf(columnKey) + '"]');
        assert.equal(await chosen.textContent(), String(value), 'Zero/false preservation mismatch'); value === 0 ? zeros++ : falses++;
      }
      metadata.push({ key, rows: sourceRows.length, columns: keys.length, zeros, falses });
    }
    return metadata;
  };
  await check('provided data_map file: real source tables/columns/empty tables and available zero/false values through JSON import', async () => {
    await goto('mode=extract');
    const filename = (await fsp.readdir(path.join(root, '참고자료'))).filter(name => /^data_map_.*\.txt$/.test(name)).sort()[0];
    assert.ok(filename); const filepath = path.join(root, '참고자료', filename), bytes = await fsp.readFile(filepath), raw = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    await page.getByLabel('JSON 열기', { exact: true }).setInputFiles(filepath);
    await expect(page.locator('.shell > .tabs > .tab-list > button')).toHaveCount(Object.keys(raw.tables).length);
    const metadata = await validateProvidedTables(raw.tables);
    await page.getByRole('button', { name: '원본 JSON', exact: true }).click();
    const displayed = JSON.parse(await page.locator('dialog[open] .raw-view').textContent());
    const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); assert.equal(digest(displayed), digest(raw), 'Raw JSON content hash mismatch');
    await page.locator('dialog[open] .titlebar').getByRole('button', { name: '닫기', exact: true }).click();
    evidence.providedDataMap = { filename, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), tables: metadata, note: 'Original values were not copied into fixture files or logs.' };
  });
  await check('six existing grid samples: defensive 24-item and 3-item contract rows remain complete through common renderer', async () => {
    await goto('mode=extract');
    const bytes = await fsp.readFile(path.join(root, 'prototypes/features/grid/fixtures/samples.json')), original = JSON.parse(bytes), tables = Object.fromEntries(original.tables.map(table => [table.id, table.rows]));
    await page.getByLabel('JSON 열기', { exact: true }).setInputFiles({ name: 'existing-grid-samples.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ pointInfo: {}, tables })) });
    await expect(page.locator('.shell > .tabs > .tab-list > button')).toHaveCount(6);
    const metadata = await validateProvidedTables(tables); assert.equal(tables.defense_items.length, 24); assert.equal(tables.contract_items.length, 3);
    evidence.providedGridSamples = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), tables: metadata, note: 'Existing readonly samples were adapted in memory; no original code was executed or sample fixture copied.' };
  });
  const widget = () => page.locator('#g2b-helper-mvp-root');
  await check('mock transport content-widget DOM: exact work-button order and count list/direct input requests', async () => {
    await page.addInitScript(({ origin }) => {
      window.__mvpRequests = [];
      window.chrome = { ...(window.chrome || {}), runtime: {
        getURL: file => new URL(file, origin + '/').href,
        sendMessage: async payload => {
          window.__mvpRequests.push(payload);
          if (payload.kind === 'mvp.context') return { result: { tabId: 1 } };
          if (payload.kind === 'mvp.rpc') return { result: { settings: { theme: 'light', shortcuts: { extract: 'Alt+Shift+E' }, launchers: [{ id: 'sample', label: '합성 런처', script: 'void 0' }] }, storeVersion: 1 } };
          return { result: { status: 'applied', message: '합성 명령 확인' } };
        },
        onMessage: { addListener: listener => { window.__mvpListener = listener; } },
      } };
    }, { origin });
    await page.goto(origin + '/widget-test.html'); await page.addScriptTag({ url: origin + '/widget.js' });
    await expect(widget().locator('.control')).toBeVisible();
    assert.deepEqual(await widget().locator('.body > .row').first().locator('button').allTextContents(), ['−1년', '+1년', '조회', '엑셀']);
    await widget().getByLabel('조회건수 목록').selectOption('500'); await expect(widget().getByLabel('조회건수 직접입력')).toHaveValue('500');
    await widget().getByLabel('조회건수 직접입력').fill('321'); await widget().getByRole('button', { name: '적용', exact: true }).click();
    for (const title of ['−1년', '+1년', '조회', '엑셀']) await widget().getByRole('button', { name: title, exact: true }).click();
    const requests = await page.evaluate(() => window.__mvpRequests.filter(payload => payload.kind === 'mvp.work').map(payload => payload.request));
    assert.deepEqual(requests, [{ kind: 'setRowCount', rowCount: 321 }, { kind: 'yearShift', years: -1, searchAfter: false }, { kind: 'yearShift', years: 1, searchAfter: false }, { kind: 'search' }, { kind: 'excel' }]);
  });
  await check('mock transport widget: drag, circular collapse/restore and one nearby iframe replaced per menu', async () => {
    const control = widget().locator('.control'), head = widget().locator('.head');
    const before = await control.boundingBox(), handle = await head.boundingBox();
    await page.mouse.move(handle.x + 70, handle.y + 10); await page.mouse.down(); await page.mouse.move(handle.x - 210, handle.y + 100, { steps: 10 }); await page.mouse.up();
    const after = await control.boundingBox(); assert.notEqual(after.x, before.x); assert.notEqual(after.y, before.y);
    await widget().getByRole('button', { name: '위젯 접기', exact: true }).click(); await expect(control).not.toBeVisible(); await expect(widget().locator('.circle')).toBeVisible();
    await widget().locator('.circle').click(); await expect(control).toBeVisible();
    await widget().getByRole('button', { name: '추출', exact: true }).click(); await expect(widget().locator('iframe')).toHaveCount(1);
    const frame = page.frameLocator('#g2b-helper-mvp-root iframe'); await expect(frame.locator('.mvp-grid-count')).toHaveText('24 / 24행');
    const box = await widget().locator('.frame-wrap').boundingBox(); assert.ok(box.width >= 850 && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1180);
    await widget().getByRole('button', { name: 'DB', exact: true }).click(); await expect(widget().locator('iframe')).toHaveCount(1); await expect(widget().locator('iframe')).toHaveAttribute('title', 'G2B Helper db');
    await expect(page.frameLocator('#g2b-helper-mvp-root iframe').locator('.mvp-grid-count')).toHaveText('24 / 24행');
    await screenshot('04-widget-light.png');
  });
  await check('mock transport widget: frame settings message changes theme/shortcut; Escape closes feature and header closes widget', async () => {
    const frame = page.frameLocator('#g2b-helper-mvp-root iframe');
    await expect(frame.locator('.mvp-grid-count')).toHaveText('24 / 24행');
    await frame.locator('html').evaluate((_, origin) => window.parent.postMessage({ kind: 'mvp.settings', settings: { theme: 'dark', shortcuts: { extract: 'Alt+Shift+E' } } }, origin), origin);
    await expect(widget()).toHaveCSS('--sheet', '#20282d');
    await screenshot('05-widget-dark.png');
    await page.mouse.click(1150, 12); await page.keyboard.press('Alt+Shift+E');
    await expect(widget().locator('iframe')).toHaveAttribute('title', 'G2B Helper extract');
    await page.mouse.click(1150, 12); await page.keyboard.press('Escape'); await expect(widget().locator('iframe')).toHaveCount(0);
    await widget().locator('.head').getByRole('button', { name: '위젯 닫기', exact: true }).click(); await expect(widget()).toHaveCount(0);
  });
  await check('console and browser errors: no Tabulator warning or runtime exception', async () => {
    assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(evidence.console, []);
  });
} catch (error) { evidence.fatal = String(error.stack || error); }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = evidence.checks.filter(item => item.status === 'passed').length;
  evidence.failed = evidence.checks.filter(item => item.status === 'failed').length;
  await fsp.writeFile(path.join(artifacts, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: evidence.passed, failed: evidence.failed, fatal: evidence.fatal, browser: evidence.browser, artifacts, checks: evidence.checks.map(({ name, status }) => ({ name, status })) }, null, 2));
if (evidence.failed || evidence.fatal) process.exitCode = 1;

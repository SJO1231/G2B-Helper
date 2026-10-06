// #13 정상 합성 fixture의 자료·어댑터·시나리오. 판정은 lib/judge의 공통 함수로 한다.
// 어댑터(요소 찾기·상태 읽기)는 fixture 전용이며 그 차이는 README §12에 공개한다. 기대값은 cases.ts 고정값이다.
import { readFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { D1_FILTER_CASES, D1_ROWS, D2_ALL, D2_B, D2_BV, D2_FILTER, D2_ROWS, D2_SEARCH, R1_CASES, preservationRows, type R1Case, type Row } from './cases';
import { MET, UNMET, judgeDisplay, judgeSearchFilterClear } from './judge';
import { displayIds, notObserved, openHtml, preservationJudgment, rowsJudgment, step, type ScreenJudgment } from './screen';
import type { Cause } from './outcome';

export const R1_ROWS: Row[] = [
  { id: 'r1', amount: '9007199254740993.25', ratio: '0.26' },
  { id: 'r2', amount: '35608652.5', ratio: '0.123456789012345678901' },
  { id: 'r3', amount: '9007199254740993.75', ratio: '' },
  { id: 'r4', amount: '12345678901234567890.125', ratio: '' },
];

/** R1 고정 사례를 fixture 셀에 대응시킨다(사례 ID → 열·행). */
export const R1_SCREEN: { item: R1Case; column: 'amount' | 'ratio'; row: string }[] = [
  ['R1-v1', 'amount', 'r1'], ['R1-v2', 'amount', 'r1'], ['R1-v3', 'amount', 'r1'], ['R1-v4', 'amount', 'r2'],
  ['R1-v5', 'amount', 'r3'], ['R1-v6', 'ratio', 'r1'], ['R1-v7', 'ratio', 'r2'], ['R1-v8', 'amount', 'r4'],
].map(([id, column, row]) => {
  const item = R1_CASES.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`unknown R1 case ${id}`);
  return { item, column: column as 'amount' | 'ratio', row };
});

const text = (key: string, label = key) => ({ key, label, type: 'text' });
export const TABLES = ['r1', 'd1', 'd2', 'm04'] as const;
export type TableName = typeof TABLES[number];

export function fixtureData() {
  const m04 = preservationRows();
  return {
    initialTable: 'r1',
    tabLabels: { r1: 'R1 자릿수', d1: 'D1 필터', d2: 'D2 검색', m04: 'M04 보존' },
    columns: {
      r1: [text('id', 'ID'), { key: 'amount', label: '금액', type: 'money' }, { key: 'ratio', label: '비율', type: 'number' }],
      d1: [text('id', 'ID'), text('번호'), text('차수'), text('검수명'), text('기관')],
      d2: [text('id', 'ID'), text('검수명'), text('기관')],
      m04: Object.keys(m04[0]).map((key) => text(key, key || '(빈 키)')),
    },
    tables: { r1: R1_ROWS, d1: D1_ROWS, d2: D2_ROWS, m04 },
  };
}

/** 원천·작업 저장소의 기대값: 적재한 고정 자료 그대로(이 범위의 조작은 허용 변화 0). */
export const expectedStores = (): Record<TableName, unknown[]> => fixtureData().tables;

export const EXPECTED_INITIAL: Record<TableName, string[]> = {
  r1: R1_ROWS.map((row) => row.id),
  d1: D1_ROWS.map((row) => row.id),
  d2: D2_ROWS.map((row) => row.id),
  m04: preservationRows().map((_row, index) => `#${index}`),
};

export function fixtureHtml(): string {
  const template = readFileSync(new URL('../fixtures/normal-grid.html', import.meta.url), 'utf8');
  const token = '/*__DATA__*/null';
  if (template.split(token).length !== 2) throw new Error('fixture data token must appear exactly once');
  return template.replace(token, () => JSON.stringify(fixtureData()));
}

async function readStores(page: Page): Promise<{ source: unknown; working: unknown }> {
  const encoded = await page.evaluate(() => {
    const state = (window as unknown as { __issue13: { source: unknown; working: unknown } }).__issue13;
    const encode = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => (item === undefined ? { __issue13: 'undefined' } : item));
    return { source: encode(state.source), working: encode(state.working) };
  });
  return { source: JSON.parse(encoded.source), working: JSON.parse(encoded.working) };
}

const rows = (page: Page) => displayIds(page, '#gridBody tr');
const clickTab = (page: Page, table: TableName) => page.click(`#tabs [data-table="${table}"]`);

/** 금액 열 머리글에서 서식 경로를 찾고, 열린 화면에 소수 자릿수 조정 수단이 보이는지 본다(R1-a, R1-a2). */
async function observeDigitControl(page: Page): Promise<{ header: boolean; viaHeader: boolean; control: boolean }> {
  const header = page.locator('#gridHead th[data-key="amount"]');
  if ((await header.count()) !== 1) return { header: false, viaHeader: false, control: false };
  const formatButtons = header.locator('button[aria-label*="서식"]');
  const viaHeader = (await formatButtons.count()) > 0;
  if (viaHeader) await formatButtons.first().click();
  const control = (await page.locator('select[aria-label*="자릿수"]:visible, select[aria-label*="소수"]:visible').count()) > 0;
  return { header: true, viaHeader, control };
}

async function applyDigits(page: Page, column: string, digits: number | null): Promise<boolean> {
  const button = page.locator(`#gridHead th[data-key="${column}"] button[aria-label*="서식"]`);
  if ((await button.count()) === 0) return false;
  await button.first().click();
  await page.selectOption('#decimals', digits === null ? 'keep' : String(digits));
  await page.click('#applyFormat');
  return true;
}

async function applyColumnFilter(page: Page, column: string, filter: (typeof D1_FILTER_CASES)[number]['filter']): Promise<void> {
  await page.click(`#gridHead th[data-key="${column}"] [data-filter]`);
  if (filter.mode === 'values') {
    const boxes = page.locator('#valueList input[type=checkbox]');
    const count = await boxes.count();
    for (let index = 0; index < count; index += 1) {
      const token = await boxes.nth(index).getAttribute('data-token');
      if (token !== null && filter.values.includes(token)) await boxes.nth(index).check();
    }
  } else if (filter.mode === 'includes') {
    await page.fill('#includeTerm', filter.terms.join(' '));
  } else if (filter.mode === 'exclude') {
    await page.fill('#excludeTerm', filter.terms.join(' '));
  }
  await page.click('#applyFilter');
}

export interface FixtureRun { judgments: Record<string, ScreenJudgment>; errors: string[]; blocked: string[]; }

export async function runFixture(browser: Browser, html: string): Promise<FixtureRun> {
  const { context, page, blocked } = await openHtml(browser, html, 'fixture.html');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  const judgments: Record<string, ScreenJudgment> = {};
  const expected = expectedStores();
  try {
    // A4-a·A4-b: 적재 직후 원천·작업 저장소
    const loaded = await step(errors, 'read stores after load', () => readStores(page));
    judgments['A4-a'] = loaded ? preservationJudgment([{ store: 'source', expected, actual: loaded.source }]) : notObserved('적재 직후 원천 저장소를 읽지 못함');
    judgments['A4-b'] = loaded ? preservationJudgment([{ store: 'working', expected, actual: loaded.working }]) : notObserved('적재 직후 작업 저장소를 읽지 못함');

    // A4-c·R2-init: 검색·필터 전 처음 표시
    const initial: Partial<Record<TableName, string[]>> = {};
    for (const table of TABLES) initial[table] = await step(errors, `initial ${table}`, async () => { await clickTab(page, table); return rows(page); });
    const allInitial = TABLES.every((table) => initial[table]) ? TABLES.flatMap((table) => initial[table] ?? []) : undefined;
    judgments['A4-c'] = rowsJudgment(TABLES.flatMap((table) => EXPECTED_INITIAL[table]), allInitial, TABLES.reduce((sum, table) => sum + EXPECTED_INITIAL[table].length, 0));
    judgments['R2-init:D1'] = rowsJudgment(EXPECTED_INITIAL.d1, initial.d1, EXPECTED_INITIAL.d1.length);
    judgments['R2-init:D2'] = rowsJudgment(EXPECTED_INITIAL.d2, initial.d2, EXPECTED_INITIAL.d2.length);

    // R1-a·R1-a2: 금액 열 머리글의 열 서식 경로와 자릿수 조정 수단
    await step(errors, 'tab r1', () => clickTab(page, 'r1'));
    const control = await step(errors, 'digit control', () => observeDigitControl(page));
    const absent: Cause = { element: 'control:소수 자릿수', value: 'absent' };
    if (!control || !control.header) {
      judgments['R1-a'] = notObserved('금액 열 머리글을 찾지 못함');
      judgments['R1-a2'] = notObserved('금액 열 머리글을 찾지 못함');
    } else {
      judgments['R1-a'] = control.control
        ? { verdict: MET, causes: [], observed: true, targets: 1, outputComplete: true, witness: true }
        : { verdict: `${UNMET}(부재)`, causes: [absent], observed: true, targets: 1, outputComplete: true, witness: true };
      judgments['R1-a2'] = control.control && control.viaHeader
        ? { verdict: MET, causes: [], observed: true, targets: 1, outputComplete: true, witness: true }
        : { verdict: `${UNMET}(부재)`, causes: [{ element: 'control:열 서식 경로', value: 'absent' }], observed: true, targets: 1, outputComplete: true, witness: true };
    }

    // R1-v1~v8: 설정 적용 뒤 셀 표시(천 단위 쉼표 제거 비교)
    for (const { item, column, row } of R1_SCREEN) {
      const outcome = await step(errors, `${item.id}`, async () => {
        const applied = await applyDigits(page, column, item.digits);
        const shown = applied ? await page.locator(`#gridBody tr[data-row="${row}"] td[data-key="${column}"]`).textContent() : null;
        return { applied, shown };
      });
      if (!outcome) judgments[item.id] = notObserved('설정 적용 또는 셀 읽기 실패');
      else if (!outcome.applied) judgments[item.id] = { verdict: `${UNMET}(조정 수단 없음)`, causes: [{ element: `cell:${item.id}`, value: 'no-control' }], observed: true, targets: 1, outputComplete: true, witness: true };
      else {
        const judged = judgeDisplay(item, outcome.shown ?? undefined);
        judgments[item.id] = {
          verdict: judged.verdict,
          causes: judged.verdict === UNMET ? [{ element: `cell:${item.id}`, value: 'display-mismatch' }] : [],
          observed: judged.verdict === MET || judged.verdict === UNMET,
          targets: 1, outputComplete: true, witness: true, detail: { shown: outcome.shown, expected: item.expected },
        };
      }
    }
    const afterR1 = await step(errors, 'read stores after R1', () => readStores(page));
    judgments['R1-e'] = afterR1
      ? preservationJudgment([{ store: 'source', expected, actual: afterR1.source }, { store: 'working', expected, actual: afterR1.working }])
      : notObserved('R1 조작 뒤 저장소를 읽지 못함');

    // R2-a·R2-e·R2-f: D1 표
    await step(errors, 'tab d1', () => clickTab(page, 'd1'));
    const clearLabel = await step(errors, 'clear label', () => page.locator('#clearFilters').textContent());
    if (clearLabel === undefined || clearLabel === null) judgments['R2-a'] = notObserved('필터 해제 버튼을 찾지 못함');
    else {
      const normalized = clearLabel.replace(/\s+/g, ' ').trim();
      judgments['R2-a'] = normalized === '필터 해제'
        ? { verdict: MET, causes: [], observed: true, targets: 1, outputComplete: true, witness: true }
        : { verdict: UNMET, causes: [{ element: 'button:필터 해제', value: 'label' }], observed: true, targets: 1, outputComplete: true, witness: true, detail: normalized };
    }
    const means = await step(errors, 'filter means', async () => {
      await page.click('#gridHead th[data-key="검수명"] [data-filter]');
      const panel = page.locator('[role="dialog"][aria-label="열 필터"]');
      const list = (await panel.locator('[role="group"][aria-label="값 목록"]:visible input[type=checkbox]').count()) > 0;
      const include = (await panel.locator('input[aria-label="포함 검색"]:visible').count()) > 0;
      const exclude = (await panel.locator('input[aria-label="제외 검색"]:visible').count()) > 0;
      await page.click('#clearFilters');
      return { list, include, exclude };
    });
    if (!means) judgments['R2-e'] = notObserved('열 필터 화면을 열지 못함');
    else {
      const causes: Cause[] = [];
      if (!means.list) causes.push({ element: 'control:값 목록', value: 'absent' });
      if (!means.include) causes.push({ element: 'control:포함 검색', value: 'absent' });
      if (!means.exclude) causes.push({ element: 'control:제외 검색', value: 'absent' });
      judgments['R2-e'] = { verdict: causes.length ? `${UNMET}(부재)` : MET, causes, observed: true, targets: 3, outputComplete: true, witness: true };
    }
    for (const item of D1_FILTER_CASES) {
      const shown = await step(errors, item.id, async () => {
        await applyColumnFilter(page, item.column, item.filter);
        const ids = await rows(page);
        await page.click('#clearFilters');
        return ids;
      });
      judgments[`R2-f:${item.id}`] = rowsJudgment(item.expected, shown, D1_ROWS.length);
    }

    // R2-0·R2-b·R2-c: D2 표의 검색 → 적용 → 필터 해제
    const flow = await step(errors, 'd2 flow', async () => {
      await clickTab(page, 'd2');
      await page.fill('#search', D2_SEARCH);
      const search = await rows(page);
      await applyColumnFilter(page, D2_FILTER.column, D2_FILTER.filter);
      const searchAndFilter = await rows(page);
      await page.click('#clearFilters');
      const cleared = await rows(page);
      const searchValue = await page.inputValue('#search');
      return { search, searchAndFilter, cleared, searchValue };
    });
    if (!flow) {
      for (const id of ['R2-0', 'R2-b', 'R2-c']) judgments[id] = notObserved('D2 검색·적용·해제 흐름을 마치지 못함');
    } else {
      const sets = { all: D2_ALL, b: D2_B, bv: D2_BV };
      const result = judgeSearchFilterClear(sets, flow);
      const witness = D2_B.length >= 2 && D2_BV.length > 0 && D2_BV.length < D2_B.length && D2_B.length < D2_ALL.length;
      const wrap = (judged: typeof result.premise) => ({ ...rowsFromJudged(judged, D2_ALL.length), witness });
      judgments['R2-0'] = wrap(result.premise);
      judgments['R2-b'] = wrap(result.apply);
      const clear = wrap(result.clear);
      if (flow.searchValue !== D2_SEARCH && (clear.verdict === MET || clear.verdict === UNMET)) {
        clear.verdict = UNMET;
        clear.causes = [...clear.causes, { element: 'search', value: 'changed' }];
        clear.detail = { cleared: flow.cleared, searchValue: flow.searchValue };
      }
      judgments['R2-c'] = clear;
    }

    // A4-d(R2-d 포함): 이 범위의 모든 조작 뒤 원천·작업 저장소. 허용 변화 0
    const final = await step(errors, 'read stores after scenario', () => readStores(page));
    judgments['A4-d'] = final
      ? preservationJudgment([{ store: 'source', expected, actual: final.source }, { store: 'working', expected, actual: final.working }])
      : notObserved('시나리오 뒤 저장소를 읽지 못함');
  } finally {
    await context.close();
  }
  return { judgments, errors, blocked };
}

function rowsFromJudged(judged: { verdict: string; missing?: string[]; extra?: string[]; reason?: string; observed?: unknown }, targets: number): ScreenJudgment {
  if (judged.verdict !== MET && judged.verdict !== UNMET) return { verdict: `${judged.verdict}(${judged.reason ?? ''})`, causes: [], observed: true, targets, outputComplete: true, witness: true };
  const causes: Cause[] = [
    ...(judged.missing ?? []).map((id) => ({ element: `row:${id}`, value: 'missing' })),
    ...(judged.extra ?? []).map((id) => ({ element: `row:${id}`, value: 'extra' })),
  ];
  return { verdict: judged.verdict, causes, observed: true, targets, outputComplete: true, witness: true, detail: judged.observed };
}

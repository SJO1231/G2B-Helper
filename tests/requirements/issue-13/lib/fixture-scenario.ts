// #13 정상 합성 fixture 전용 어댑터. 고정 cases.ts를 기대값으로 쓰며 제품/F44를 판정하지 않는다.
import { readFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { D1_FILTER_CASES, D1_ROWS, D2_ALL, D2_B, D2_BV, D2_FILTER, D2_ROWS, D2_SEARCH, R1_CASES, preservationRows, type R1Case, type Row } from './cases';
import { MET, UNMET, UNVERIFIED, judgeDisplay, judgeSearchFilterClear } from './judge';
import { displayIds, fromRows, notObserved, openHtml, preservationJudgment, rowsJudgment, step, type ScreenJudgment } from './screen';
import type { Cause } from './outcome';

export const R1_ROWS: Row[] = [
  { id: 'r1', amount: '9007199254740993.25', ratio: '0.26' },
  { id: 'r2', amount: '35608652.5', ratio: '0.123456789012345678901' },
  { id: 'r3', amount: '9007199254740993.75', ratio: '' },
  { id: 'r4', amount: '12345678901234567890.125', ratio: '' },
];

/** 고정 R1 사례 ID를 실제 fixture 셀에 대응시킨다. 기대 문자열은 cases.ts에서 가져온다. */
export const R1_SCREEN: { item: R1Case; column: 'amount' | 'ratio'; row: string }[] = [
  ['R1-v1', 'amount', 'r1'], ['R1-v2', 'amount', 'r1'], ['R1-v3', 'amount', 'r1'], ['R1-v4', 'amount', 'r2'],
  ['R1-v5', 'amount', 'r3'], ['R1-v6', 'ratio', 'r1'], ['R1-v7', 'ratio', 'r2'], ['R1-v8', 'amount', 'r4'],
].map(([id, column, row]) => {
  const item = R1_CASES.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`알 수 없는 R1 사례 ${id}`);
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

/** 적재할 고정 입력과 같은 전체 저장소가 기대값이다. DOM/실행 결과를 기대값으로 사용하지 않는다. */
export const expectedStores = (): Record<TableName, unknown[]> => fixtureData().tables;
/** README 고정 행 집합. 실제 F44 초기 완전성은 이 기대값으로 판정할 수 없다. */
export const EXPECTED_INITIAL: Record<TableName, string[]> = {
  r1: ['r1', 'r2', 'r3', 'r4'],
  d1: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
  d2: ['e1', 'e2', 'e3', 'e4', 'e5'],
  m04: ['#0', '#1', '#2', '#3'],
};

export function fixtureHtml(): string {
  const template = readFileSync(new URL('../fixtures/normal-grid.html', import.meta.url), 'utf8');
  const token = '/*__DATA__*/null';
  if (template.split(token).length !== 2) throw new Error('합성 자료 표식은 정확히 하나여야 합니다.');
  return template.replace(token, () => JSON.stringify(fixtureData()));
}

async function readStores(page: Page): Promise<{ source: unknown; working: unknown }> {
  return page.evaluate(() => {
    const state = (window as unknown as { __issue13: { source: unknown; working: unknown } }).__issue13;
    return { source: state.source, working: state.working };
  });
}

const rows = (page: Page) => displayIds(page, '#gridBody tr');
const clickTab = (page: Page, table: TableName) => page.click(`#tabs [data-table="${table}"]`);

async function observeDigitControl(page: Page): Promise<{ header: boolean; viaHeader: boolean; control: boolean }> {
  const header = page.locator('#gridHead th[data-key="amount"]');
  if ((await header.count()) !== 1 || !await header.isVisible()) return { header: false, viaHeader: false, control: false };
  const formatButtons = header.locator('button[aria-label*="서식"]');
  const viaHeader = (await formatButtons.count()) > 0;
  if (viaHeader) await formatButtons.first().click();
  const control = (await page.locator('select[aria-label*="자릿수"]:visible, select[aria-label*="소수"]:visible').count()) > 0;
  return { header: true, viaHeader, control };
}

async function applyDigits(page: Page, column: string, digits: number | null): Promise<boolean> {
  const header = page.locator(`#gridHead th[data-key="${column}"]`);
  if (await header.count() !== 1 || !await header.isVisible()) throw new Error('서식 관측 영역을 찾지 못함');
  const button = header.locator('button[aria-label*="서식"]');
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

export interface FixtureRun {
  judgments: Record<string, ScreenJudgment>;
  errors: string[];
  blocked: string[];
  observations: Record<string, unknown>;
  screenshots: string[];
}

/** screenshotPrefix는 검사가 지정한 ignored artifacts 경로만 전달한다. 합성 화면만 저장한다. */
export async function runFixture(browser: Browser, html: string, screenshotPrefix?: string): Promise<FixtureRun> {
  const { context, page, blocked, errors } = await openHtml(browser, html, 'fixture.html');
  const judgments: Record<string, ScreenJudgment> = {};
  const observations: Record<string, unknown> = {};
  const screenshots: string[] = [];
  const capture = async (name: string) => {
    if (!screenshotPrefix) return;
    const path = `${screenshotPrefix}-${name}.png`;
    const saved = await step(errors, `화면 기록 ${name}`, async () => { await page.screenshot({ path, fullPage: true }); return path; });
    if (saved) screenshots.push(saved);
  };
  const expected = expectedStores();
  try {
    // A4-a·A4-b: 원천과 실제 화면이 쓰는 작업 저장소 전체를 읽는다.
    const loaded = await step(errors, '적재 후 저장소', () => readStores(page));
    observations.loaded = loaded;
    judgments['A4-a'] = loaded ? preservationJudgment([{ store: 'source', expected, actual: loaded.source }]) : notObserved('적재 직후 원천 저장소를 읽지 못함');
    judgments['A4-b'] = loaded ? preservationJudgment([{ store: 'working', expected, actual: loaded.working }]) : notObserved('적재 직후 작업 저장소를 읽지 못함');

    // A4-c·R2-init: 합성 고정 자료만 판정하며 실제 F44 초기 완전성을 증명하지 않는다.
    const initial: Partial<Record<TableName, string[]>> = {};
    for (const table of TABLES) initial[table] = await step(errors, `처음 표시 ${table}`, async () => {
      // 고정 초기 활성 표 r1은 재렌더링 없이 첫 화면 그대로 읽는다.
      if (table !== 'r1') await clickTab(page, table);
      return rows(page);
    });
    observations.initial = initial;
    const allInitial = TABLES.every((table) => initial[table]) ? TABLES.flatMap((table) => (initial[table] ?? []).map((id) => `${table}:${id}`)) : undefined;
    judgments['A4-c'] = rowsJudgment(TABLES.flatMap((table) => EXPECTED_INITIAL[table].map((id) => `${table}:${id}`)), allInitial, TABLES.length);
    judgments['R2-init:D1'] = rowsJudgment(EXPECTED_INITIAL.d1, initial.d1, 1);
    judgments['R2-init:D2'] = rowsJudgment(EXPECTED_INITIAL.d2, initial.d2, 1);

    await step(errors, '탭 r1', () => clickTab(page, 'r1'));
    const control = await step(errors, '자릿수 수단', () => observeDigitControl(page));
    observations.digitControl = control;
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
    await capture('r1');

    const r1Snapshots: { phase: string; stores: Awaited<ReturnType<typeof readStores>> | undefined }[] = [];
    observations.r1Snapshots = r1Snapshots;
    for (const { item, column, row } of R1_SCREEN) {
      r1Snapshots.push({ phase: `${item.id}:적용 전`, stores: await step(errors, `${item.id} 적용 전 저장소`, () => readStores(page)) });
      const outcome = await step(errors, item.id, async () => {
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
      r1Snapshots.push({ phase: `${item.id}:적용 후`, stores: await step(errors, `${item.id} 적용 후 저장소`, () => readStores(page)) });
    }
    const afterR1 = await step(errors, 'R1 후 저장소', () => readStores(page));
    observations.afterR1 = afterR1;
    r1Snapshots.push({ phase: 'R1 전체 사례 종료', stores: afterR1 });
    judgments['R1-e'] = {
      ...(r1Snapshots.every(({ stores }) => stores !== undefined)
        ? preservationJudgment(r1Snapshots.flatMap(({ stores }) => [{ store: 'source', expected, actual: stores!.source }, { store: 'working', expected, actual: stores!.working }]))
        : notObserved('R1 사례 전후 저장소 관측이 하나 이상 실패함')),
      detail: { phases: r1Snapshots.map(({ phase }) => phase) },
    };

    await step(errors, '탭 d1', () => clickTab(page, 'd1'));
    const clearControl = await step(errors, '필터 해제 버튼', async () => {
      const toolbar = page.locator('#toolbar');
      if (await toolbar.count() !== 1 || !await toolbar.isVisible()) throw new Error('도구 영역 관측 불가');
      const button = toolbar.locator('#clearFilters');
      return { buttons: await button.count(), label: await button.count() ? await button.textContent() : null };
    });
    observations.clearControl = clearControl;
    if (!clearControl) judgments['R2-a'] = notObserved('필터 해제 버튼의 영역을 읽지 못함');
    else if (clearControl.buttons === 0) judgments['R2-a'] = { verdict: `${UNMET}(부재)`, causes: [{ element: 'button:필터 해제', value: 'absent' }], observed: true, targets: 1, outputComplete: true, witness: true, detail: { buttons: 0 } };
    else {
      const normalized = (clearControl.label ?? '').replace(/\s+/g, ' ').trim();
      judgments['R2-a'] = normalized === '필터 해제'
        ? { verdict: MET, causes: [], observed: true, targets: 1, outputComplete: true, witness: true }
        : { verdict: UNMET, causes: [{ element: 'button:필터 해제', value: 'label' }], observed: true, targets: 1, outputComplete: true, witness: true, detail: normalized };
    }
    const means = await step(errors, '열 필터 수단', async () => {
      await page.click('#gridHead th[data-key="검수명"] [data-filter]');
      const panel = page.locator('[role="dialog"][aria-label="열 필터"]');
      if (await panel.count() !== 1 || !await panel.isVisible()) throw new Error('필터 영역 관측 불가');
      const list = (await panel.locator('[role="group"][aria-label="값 목록"]:visible input[type=checkbox]').count()) > 0;
      const listSearch = (await panel.locator('input[aria-label="값 목록 검색"]:visible').count()) > 0;
      const include = (await panel.locator('input[aria-label="포함 검색"]:visible').count()) > 0;
      const exclude = (await panel.locator('input[aria-label="제외 검색"]:visible').count()) > 0;
      await capture('filter');
      await page.click('#clearFilters');
      return { list, listSearch, include, exclude };
    });
    observations.filterMeans = means;
    if (!means) judgments['R2-e'] = notObserved('열 필터 화면을 열지 못함');
    else {
      const causes: Cause[] = [];
      if (!means.list || !means.listSearch) causes.push({ element: 'control:값 목록', value: 'absent' });
      if (!means.include) causes.push({ element: 'control:포함 검색', value: 'absent' });
      if (!means.exclude) causes.push({ element: 'control:제외 검색', value: 'absent' });
      judgments['R2-e'] = { verdict: causes.length ? `${UNMET}(부재)` : MET, causes, observed: true, targets: 1, outputComplete: true, witness: true };
    }
    const d1Snapshots: { phase: string; stores: Awaited<ReturnType<typeof readStores>> | undefined }[] = [];
    observations.d1Snapshots = d1Snapshots;
    for (const item of D1_FILTER_CASES) {
      const shown = await step(errors, item.id, async () => {
        await applyColumnFilter(page, item.column, item.filter);
        const ids = await rows(page);
        await page.click('#clearFilters');
        return ids;
      });
      judgments[`R2-f:${item.id}`] = rowsJudgment(item.expected, shown, 1);
      d1Snapshots.push({ phase: `${item.id}:필터 해제 후`, stores: await step(errors, `${item.id} 시나리오 종료 후 저장소`, () => readStores(page)) });
    }

    const flow = await step(errors, 'D2 검색·적용·해제', async () => {
      await clickTab(page, 'd2');
      await page.fill('#search', '');
      const emptySearch = await rows(page);
      await page.fill('#search', D2_SEARCH);
      const search = await rows(page);
      await applyColumnFilter(page, D2_FILTER.column, D2_FILTER.filter);
      const searchAndFilter = await rows(page);
      await page.click('#clearFilters');
      const cleared = await rows(page);
      const searchValue = await page.inputValue('#search');
      return { emptySearch, search, searchAndFilter, cleared, searchValue };
    });
    observations.flow = flow;
    if (!flow) {
      for (const id of ['R2-0', 'R2-b', 'R2-c']) judgments[id] = notObserved('D2 검색·적용·해제 흐름을 마치지 못함');
    } else {
      const result = judgeSearchFilterClear({ all: D2_ALL, b: D2_B, bv: D2_BV }, flow);
      const witness = D2_B.length >= 2 && D2_BV.length > 0 && D2_BV.length < D2_B.length && D2_B.length < D2_ALL.length;
      const wrap = (judged: typeof result.premise): ScreenJudgment => ({ ...fromRows(judged, 1), witness });
      const premise = wrap(result.premise);
      premise.searchRows = flow.search;
      // 실제 관측 B가 빈 경우만 F6의 전제 확인 예외 입력을 만든다. 다른 불일치는 원래 미충족이다.
      if (witness && flow.search.length === 0) {
        premise.verdict = `${UNVERIFIED}(증인 불성립)`;
        premise.causes = [...premise.causes, { element: 'search-result:B', value: '[]' }];
      }
      judgments['R2-0'] = premise;
      judgments['R2-b'] = wrap(result.apply);
      const clear = wrap(result.clear);
      if (flow.searchValue !== D2_SEARCH && (clear.verdict === MET || clear.verdict === UNMET)) {
        clear.verdict = UNMET;
        clear.causes = [...clear.causes, { element: 'search', value: 'changed' }];
        clear.detail = { cleared: flow.cleared, searchValue: flow.searchValue };
      }
      judgments['R2-c'] = clear;
    }
    await capture('d2');

    const final = await step(errors, '조작 후 저장소', () => readStores(page));
    observations.final = final;
    const afterScenarios = [...d1Snapshots, { phase: 'D2 전체 흐름 종료', stores: final }];
    judgments['A4-d'] = {
      ...(afterScenarios.every(({ stores }) => stores !== undefined)
        ? preservationJudgment(afterScenarios.flatMap(({ stores }) => [{ store: 'source', expected, actual: stores!.source }, { store: 'working', expected, actual: stores!.working }]))
        : notObserved('시나리오 종료 후 저장소 관측이 하나 이상 실패함')),
      detail: { phases: afterScenarios.map(({ phase }) => phase) },
    };
  } finally {
    await context.close();
  }
  return { judgments, errors, blocked, observations, screenshots };
}

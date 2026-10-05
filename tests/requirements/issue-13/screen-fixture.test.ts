// #13 합성 화면 검사: 정상 기대 일치와 결함 검출을 제품/F44 충족과 구분한다.
// 주입은 메모리 사본의 한 표식 블록만 바꾸며 raw 관측·F6 입력/출력을 ignored 임시 기록에 남긴다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from '@playwright/test';
import { fixtureHtml, runFixture, type FixtureRun } from './lib/fixture-scenario';
import { D2_ALL, D2_B, D2_BV, D2_SEARCH } from './lib/cases';
import { MET, UNMET } from './lib/judge';
import { DETECTED, classifyMutation, type Cause, type MutationRun, type Outcome } from './lib/outcome';
import { injectBlock, launchBrowser, notObserved, sha256, type InjectionResult } from './lib/screen';

const NORMAL_IDS = [
  'A4-a', 'A4-b', 'A4-c', 'R2-init:D1', 'R2-init:D2', 'R1-a', 'R1-a2',
  'R1-v1', 'R1-v2', 'R1-v3', 'R1-v4', 'R1-v5', 'R1-v6', 'R1-v7', 'R1-v8', 'R1-e',
  'R2-a', 'R2-e', 'R2-f:P2-D1-values-1', 'R2-f:P2-D1-values-2', 'R2-f:P2-D1-includes', 'R2-f:P2-D1-exclude',
  'R2-0', 'R2-b', 'R2-c', 'A4-d',
];
/** 정상 합성 사례의 고정 기대 판정이며 실행 결과에서 생성하지 않는다. */
const NORMAL_EXPECTED: Record<string, string> = Object.fromEntries(NORMAL_IDS.map((id) => [id, MET]));

interface Target { judgment: string; causes: Cause[]; }
interface Mutation { id: string; block: string; replace: (original: string) => string; targets: Target[]; }
const cell = (judgment: string): Target => ({ judgment, causes: [{ element: `cell:${judgment}`, value: 'display-mismatch' }] });

/** README R1·R2·A4의 주입과 지정 원인. 기대 원인은 실제 출력에서 역산하지 않는다. */
const ORIGINAL_MUTATIONS: Mutation[] = [
  { id: 'M-R1-1 조정 수단 제거', block: 'formatButton', replace: () => '', targets: [{ judgment: 'R1-a', causes: [{ element: 'control:소수 자릿수', value: 'absent' }] }] },
  {
    id: 'M-R1-2 적용 시 원값을 Number로 저장', block: 'applyFormat',
    replace: (original) => `${original}\n  for (const row of working[current]) if (PLAIN.test(textOf(row[formatColumn]))) row[formatColumn] = String(Number(row[formatColumn]));`,
    targets: [{ judgment: 'R1-e', causes: [{ element: 'working$["r1"][0]["amount"]', value: 'value' }] }],
  },
  {
    id: 'M-R1-3 Number 기반 표시', block: 'formatNumber',
    replace: () => "\n  if (digits === 'keep') return String(Number(text));\n  return Number(text).toFixed(digits);\n  ",
    targets: ['R1-v1', 'R1-v2', 'R1-v3', 'R1-v7', 'R1-v8'].map(cell),
  },
  { id: 'M-R1-4 반올림 대신 버림', block: 'formatNumber', replace: (original) => original.replace('if (rest * 2n >= divisor) units += 1n;', ''), targets: ['R1-v5', 'R1-v6'].map(cell) },
  { id: 'M-R1-5 설정 무시(no-op)', block: 'applyFormat', replace: () => '', targets: [cell('R1-v2')] },
  { id: 'M-R2-1 적용 무시(no-op)', block: 'applyFilter', replace: () => '', targets: [{ judgment: 'R2-b', causes: [{ element: 'row:e3', value: 'extra' }] }] },
  { id: 'M-R2-2 해제가 검색어까지 초기화', block: 'clear', replace: (original) => `${original} view().search = '';`, targets: [{ judgment: 'R2-c', causes: [{ element: 'search', value: 'changed' }] }] },
  { id: 'M-R2-3 표시명 열 필터 해제', block: 'clearLabel', replace: () => "$('clearFilters').textContent = '열 필터 해제';", targets: [{ judgment: 'R2-a', causes: [{ element: 'button:필터 해제', value: 'label' }] }] },
  { id: 'M-R2-4 값 목록 제거', block: 'valueList', replace: () => "\n  const box = $('valueBox');\n  if (box) box.remove();\n  ", targets: [{ judgment: 'R2-e', causes: [{ element: 'control:값 목록', value: 'absent' }] }] },
  {
    id: 'M-R2-5 조건을 대조 열(기관)에 적용', block: 'applyFilter',
    replace: () => "\n  if (!rule.values.length && !rule.include && !rule.exclude) delete view().filters['기관'];\n  else view().filters['기관'] = rule;\n  ",
    targets: [
      { judgment: 'R2-b', causes: [{ element: 'row:e1', value: 'missing' }, { element: 'row:e2', value: 'missing' }] },
      { judgment: 'R2-f:P2-D1-values-1', causes: [{ element: 'row:d5', value: 'extra' }] },
    ],
  },
  { id: 'M-R2-6 값 목록을 부분 일치로 처리', block: 'matchValue', replace: () => 'return textOf(cellValue).includes(String(JSON.parse(token)[1]));', targets: [{ judgment: 'R2-f:P2-D1-values-1', causes: [{ element: 'row:d2', value: 'extra' }] }] },
  {
    id: 'M-R2-7 검색 결과가 항상 공집합', block: 'search', replace: () => 'return !term;',
    targets: [{ judgment: 'R2-0', causes: [{ element: 'search-result:B', value: '[]' }, { element: 'row:e1', value: 'missing' }, { element: 'row:e2', value: 'missing' }, { element: 'row:e3', value: 'missing' }] }],
  },
  {
    id: 'M-R2-8 필터 적용 시 중복 행 병합', block: 'visible',
    replace: () => "if (Object.keys(v.filters).length) { const seen = new Set(); rows = rows.filter(({ row }) => { const key = JSON.stringify(Object.entries(row).filter(([name]) => name !== 'id')); if (seen.has(key)) return false; seen.add(key); return true; }); } return rows;",
    targets: [{ judgment: 'R2-b', causes: [{ element: 'row:e2', value: 'missing' }] }],
  },
  { id: 'M-R2-9 처음 표시에서 d3 누락', block: 'visible', replace: () => "return current === 'd1' ? rows.filter(({ id }) => id !== 'd3') : rows;", targets: [{ judgment: 'R2-init:D1', causes: [{ element: 'row:d3', value: 'missing' }] }] },
  {
    id: 'M-A4-1 표시 조작 중 작업 자료 0을 빈 값으로', block: 'searchHook',
    replace: () => "for (const row of working.m04) for (const key of Object.keys(row)) if (row[key] === '0') row[key] = '';",
    targets: [{ judgment: 'A4-d', causes: [{ element: 'working$["m04"][0]["amountText"]', value: 'value' }] }],
  },
  { id: 'M-A4-2 적재 시 빈 키 누락', block: 'load', replace: () => "const source = structuredClone(DATA.tables); for (const row of source.m04) delete row[''];", targets: [{ judgment: 'A4-a', causes: [{ element: 'source$["m04"][0][""]', value: 'missing-key' }] }] },
  {
    id: 'M-A4-3 적재 시 선행0 숫자 변환', block: 'load',
    replace: () => "const source = structuredClone(DATA.tables); for (const row of source.m04) if (typeof row.itemIdnfNo === 'string' && row.itemIdnfNo !== '') row.itemIdnfNo = Number(row.itemIdnfNo);",
    targets: [{ judgment: 'A4-a', causes: [{ element: 'source$["m04"][0]["itemIdnfNo"]', value: 'type' }] }],
  },
  {
    id: 'M-A4-4 적재 시 중복 행 병합', block: 'load',
    replace: () => 'const source = structuredClone(DATA.tables); source.m04 = source.m04.filter((row, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(row)) === index);',
    targets: [{ judgment: 'A4-a', causes: [{ element: 'source$["m04"]', value: 'length' }] }],
  },
  {
    id: 'M-A4-5 탭 전환 중 작업 자료만 손상', block: 'tabHook',
    replace: () => "if (working.m04[0] && working.m04[0].money !== '') working.m04[0].money = String(Number(working.m04[0].money));",
    targets: [{ judgment: 'A4-d', causes: [{ element: 'working$["m04"][0]["money"]', value: 'value' }] }],
  },
  { id: 'M-A4-6 초기 작업 자료 불일치', block: 'working', replace: () => "const working = structuredClone(source); if (working.m04[1]) working.m04[1].confirmed = 'false';", targets: [{ judgment: 'A4-b', causes: [{ element: 'working$["m04"][1]["confirmed"]', value: 'type' }] }] },
  { id: 'M-A4-7 처음 화면에서 1행 누락', block: 'visible', replace: () => "return current === 'm04' ? rows.filter(({ id }) => id !== '#2') : rows;", targets: [{ judgment: 'A4-c', causes: [{ element: 'row:m04:#2', value: 'missing' }] }] },
];

/** C2 추가 반례. 원문 21개와 구분하며 A4 보존과 R2 번호·차수 병합 결함을 확인한다. */
const ADDITIONAL_MUTATIONS: Mutation[] = [
  {
    id: 'M-A4-8 적재 시 숫자0·false를 빈 문자열로', block: 'load',
    replace: () => "const source = structuredClone(DATA.tables); for (const row of source.m04) for (const key of Object.keys(row)) if (row[key] === 0 || row[key] === false) row[key] = '';",
    targets: [{ judgment: 'A4-a', causes: [{ element: 'source$["m04"][0]["amountNumber"]', value: 'type' }, { element: 'source$["m04"][0]["confirmed"]', value: 'type' }] }],
  },
  {
    id: 'M-A4-9 누락 키를 false로 채움', block: 'load',
    replace: () => 'const source = structuredClone(DATA.tables); source.m04[3].confirmed = false;',
    targets: [{ judgment: 'A4-a', causes: [{ element: 'source$["m04"][3]["confirmed"]', value: 'extra-key' }] }],
  },
  {
    id: 'M-A4-10 얕은 작업 복사 중첩 변경이 원천으로 유출', block: 'working',
    replace: () => "const working = { ...source, m04: source.m04.map((row) => ({ ...row })) }; working.m04[0].items[0].qty = '1';",
    targets: [{ judgment: 'A4-a', causes: [{ element: 'source$["m04"][0]["items"][0]["qty"]', value: 'value' }] }],
  },
  {
    id: 'M-R2-8-number 같은 번호의 차수·중복 행을 병합', block: 'visible',
    replace: () => "if (current === 'd1' && Object.keys(v.filters).length) { const seen = new Set(); rows = rows.filter(({ row }) => { const number = row['번호']; if (seen.has(number)) return false; seen.add(number); return true; }); } return rows;",
    targets: [{ judgment: 'R2-f:P2-D1-includes', causes: [{ element: 'row:d2', value: 'missing' }, { element: 'row:d4', value: 'missing' }] }],
  },
  {
    id: 'M-A4-11 서로 다른 표의 표시 행 ID를 맞바꿈', block: 'visible',
    replace: () => "return rows.map(({ row, id }) => ({ row, id: current === 'r1' && id === 'r1' ? '#0' : current === 'm04' && id === '#0' ? 'r1' : id }));",
    targets: [{ judgment: 'A4-c', causes: [{ element: 'row:r1:r1', value: 'missing' }, { element: 'row:m04:#0', value: 'missing' }] }],
  },
  {
    id: 'M-R1-6 자릿수0에서 작업 원값 손상 뒤 다른 설정으로 복원', block: 'applyFormat',
    replace: (original) => `${original}\n  if (current === 'r1') working.r1[0].amount = value === '0' ? String(Number(working.r1[0].amount)) : source.r1[0].amount;`,
    targets: [{ judgment: 'R1-e', causes: [{ element: 'working$["r1"][0]["amount"]', value: 'value' }] }],
  },
  {
    id: 'M-R2-10 D1 단일 선택에서 작업0 손상 뒤 후속 조건으로 복원', block: 'applyFilter',
    replace: (original) => `${original}\n  if (current === 'd1') working.m04[0].amountText = rule.values.length === 1 ? '' : '0';`,
    targets: [{ judgment: 'A4-d', causes: [{ element: 'working$["m04"][0]["amountText"]', value: 'value' }] }],
  },
  {
    id: 'M-A4-12 첫 화면에서만 r1 행 누락 뒤 탭 클릭으로 복원', block: 'visible',
    replace: () => "if (!window.__issue13InitialRenderSeen) { window.__issue13InitialRenderSeen = true; return current === 'r1' ? rows.filter(({ id }) => id !== 'r1') : rows; } return rows;",
    targets: [{ judgment: 'A4-c', causes: [{ element: 'row:r1:r1', value: 'missing' }] }],
  },
];
const MUTATIONS = [...ORIGINAL_MUTATIONS, ...ADDITIONAL_MUTATIONS];

let browser: Browser;
let browserVersion: string | undefined;
let normal: FixtureRun;
const html = fixtureHtml();
const artifacts = fileURLToPath(new URL('../../../artifacts/harness/', import.meta.url));
const startedAt = new Date().toISOString();
const mutatedRuns = new Map<string, Promise<FixtureRun>>();
const rawRuns: { id: string; injection: InjectionResult; run: FixtureRun }[] = [];
const classifiedRuns: { input: MutationRun; output: Outcome }[] = [];
const boundaryRuns: { id: string; run: FixtureRun }[] = [];

beforeAll(async () => {
  mkdirSync(artifacts, { recursive: true });
  browser = await launchBrowser();
  browserVersion = browser.version();
  normal = await runFixture(browser, html, artifacts + '/issue13-c2-normal');
}, 120000);
afterAll(async () => {
  try { await browser?.close(); }
  finally {
    const files = ['fixtures/normal-grid.html', 'lib/screen.ts', 'lib/fixture-scenario.ts', 'screen-fixture.test.ts', 'lib/cases.ts', 'lib/judge.ts', 'lib/outcome.ts'];
    const sourceHashes = Object.fromEntries(files.map((path) => [path, sha256(readFileSync(new URL(path, import.meta.url), 'utf8'))]));
    writeFileSync(artifacts + '/issue13-c2.json', JSON.stringify({
      scope: '합성 검사기 확인과 주입 분류만; 실제 F44·제품 요구·사용자 수용은 미검증',
      startedAt, finishedAt: new Date().toISOString(), node: process.version, platform: process.platform, browserVersion,
      sourceHashes, normalHtmlSha256: sha256(html), expectedVerdicts: NORMAL_EXPECTED,
      originalMutationIds: ORIGINAL_MUTATIONS.map(({ id }) => id), additionalMutationIds: ADDITIONAL_MUTATIONS.map(({ id }) => id),
      originalTargetCount: ORIGINAL_MUTATIONS.flatMap(({ targets }) => targets).length,
      additionalTargetCount: ADDITIONAL_MUTATIONS.flatMap(({ targets }) => targets).length,
      normal, mutated: rawRuns, classified: classifiedRuns, boundaries: boundaryRuns,
    }, null, 2) + '\n', 'utf8');
  }
});

describe('#13 정상 합성 fixture(검사기 확인, 제품 판정 아님)', () => {
  it('외부 요청 없이 열리고 판정 26개를 모두 만들며 페이지·단계 오류가 없다', () => {
    expect(NORMAL_IDS).toHaveLength(26);
    expect(normal.blocked).toEqual([]);
    expect(normal.errors).toEqual([]);
    expect(Object.keys(normal.judgments).sort()).toEqual([...NORMAL_IDS].sort());
    expect(normal.screenshots).toHaveLength(3);
  });
  for (const id of NORMAL_IDS) {
    it(`${id}: 고정 기대 판정 ${NORMAL_EXPECTED[id]}`, () => {
      const judged = normal.judgments[id] ?? notObserved('판정 없음');
      expect({ id, ...judged }).toMatchObject({ verdict: NORMAL_EXPECTED[id], causes: [], observed: true, outputComplete: true, witness: true });
      expect(Number.isInteger(judged.targets) && judged.targets > 0).toBe(true);
    });
  }
  it('빈 검색 전체 집합·중복 두 행·필터 해제 후 검색 입력과 집합이 고정 기대에 맞는다', () => {
    expect(normal.observations.flow).toEqual({ emptySearch: D2_ALL, search: D2_B, searchAndFilter: D2_BV, cleared: D2_B, searchValue: D2_SEARCH });
    expect(normal.judgments['R2-e'].targets).toBe(1);
  });
});

describe('#13 결함 주입 사본(README §5 분류)', () => {
  it('원문 주입 21개·지정 판정 27개와 추가 반례 목록을 구분한다', () => {
    expect(ORIGINAL_MUTATIONS).toHaveLength(21);
    expect(ORIGINAL_MUTATIONS.flatMap((mutation) => mutation.targets)).toHaveLength(27);
    expect(ADDITIONAL_MUTATIONS.map(({ id }) => id.split(' ')[0])).toEqual(['M-A4-8', 'M-A4-9', 'M-A4-10', 'M-R2-8-number', 'M-A4-11', 'M-R1-6', 'M-R2-10', 'M-A4-12']);
  });
  for (const mutation of MUTATIONS) {
    for (const target of mutation.targets) {
      it(`${mutation.id} → ${target.judgment}: 검출 성공`, async () => {
        const injected = injectBlock(html, mutation.block, mutation.replace);
        let pending = mutatedRuns.get(mutation.id);
        if (!pending) {
          const screenshotPrefix = mutation.id.startsWith('M-R2-4 ') ? artifacts + '/issue13-c2-M-R2-4' : undefined;
          pending = runFixture(browser, injected.html, screenshotPrefix).then((run) => { rawRuns.push({ id: mutation.id, injection: injected, run }); return run; });
          mutatedRuns.set(mutation.id, pending);
        }
        const run = await pending;
        const judged = run.judgments[target.judgment] ?? notObserved('판정 없음');
        const baseline = normal.judgments[target.judgment] ?? notObserved('기준 판정 없음');
        const otherFailures = Object.entries(run.judgments).filter(([id, other]) => id !== target.judgment && other.verdict !== NORMAL_EXPECTED[id]).map(([id]) => id);
        const input: MutationRun = {
          id: mutation.id.split(' ')[0], kind: 'judgment', designated: target.judgment,
          expectedBaseline: NORMAL_EXPECTED[target.judgment], injection: injected,
          baseline: { verdict: baseline.verdict, witness: baseline.witness },
          mutated: { observed: judged.observed, targets: judged.targets, verdict: judged.verdict, causes: judged.causes, searchRows: judged.searchRows, outputComplete: judged.outputComplete, otherFailures },
          injectedCauses: target.causes,
        };
        const classified = classifyMutation(input);
        classifiedRuns.push({ input, output: classified });
        expect(injected.beforeSha256).toBe(sha256(html));
        expect(injected.afterSha256).toBe(sha256(injected.html));
        const open = `/*M:${mutation.block}*/`;
        const close = `/*/M:${mutation.block}*/`;
        const start = html.indexOf(open) + open.length;
        const end = html.indexOf(close);
        expect(injected.blockDiff).toEqual({ marker: mutation.block, before: html.slice(start, end), after: mutation.replace(html.slice(start, end)) });
        expect(injected.html).toBe(html.slice(0, start) + injected.blockDiff!.after + html.slice(end));
        expect({ ...classified, blocked: run.blocked }).toMatchObject({ outcome: DETECTED, outputComplete: true, blocked: [] });
        if (input.id === 'M-R2-7') {
          expect(judged).toMatchObject({ verdict: '미검증(증인 불성립)', targets: 1, searchRows: [] });
          expect(classified.reason).toBe('R2-0 정상 전제 성립, 주입 뒤 관측 B 공집합과 원인 일치');
        }
      }, 60000);
    }
  }
});

describe('#13 관측·표식 경계', () => {
  it('초기 스크립트 오류가 goto 이전에 등록한 pageerror 기록에 남는다', async () => {
    const run = await runFixture(browser, html + '<script>throw new Error("C2-load-error");</script>');
    boundaryRuns.push({ id: '초기 pageerror 기록', run });
    expect(run.errors).toContain('pageerror: C2-load-error');
  }, 60000);
  it('외부 이미지 요청이 route에서 차단되어 blocked 기록에 남는다', async () => {
    const address = 'https://example.invalid/issue13-probe';
    const run = await runFixture(browser, html + `<img src="${address}" alt="격리 검사">`);
    boundaryRuns.push({ id: '외부 이미지 요청 차단', run });
    expect(run.blocked).toContain(address);
    expect(run.errors).toEqual([]);
  }, 60000);
  it.each([
    ['표식 없음', 'abc'],
    ['열림 중복', '/*M:x*/a/*M:x*/b/*/M:x*/'],
    ['닫힘 중복', '/*M:x*/a/*/M:x*//*/M:x*/'],
    ['역순', '/*/M:x*/a/*M:x*/'],
  ])('%s이면 원본과 전체 hash를 보존하고 주입하지 않는다', (_label, source) => {
    expect(injectBlock(source, 'x', () => 'changed')).toEqual({ html: source, markerFound: false, beforeSha256: sha256(source), afterSha256: sha256(source) });
  });
  it('동일 블록은 실제 diff/hash가 동일하여 F6의 주입 미적용으로 남는다', () => {
    const source = 'a/*M:x*/original/*/M:x*/b';
    const injected = injectBlock(source, 'x', (original) => original);
    expect(injected.html).toBe(source);
    expect(injected.beforeSha256).toBe(injected.afterSha256);
    expect(injected.blockDiff).toEqual({ marker: 'x', before: 'original', after: 'original' });
  });
  it('교체 내용이 지정 표식을 더 만들면 사본을 바꾸지 않는다', () => {
    const source = '/*M:x*/original/*/M:x*/';
    expect(injectBlock(source, 'x', () => '/*M:x*/extra')).toEqual({ html: source, markerFound: false, beforeSha256: sha256(source), afterSha256: sha256(source) });
  });
  it('필수 버튼이 0개여도 도구 영역을 관측하면 부재, 영역 제거는 관측 실패다', async () => {
    const absentHtml = injectBlock(html, 'visible', () => "const button = $('clearFilters'); if (button) button.remove(); return rows;");
    const absent = await runFixture(browser, absentHtml.html);
    boundaryRuns.push({ id: '필터 해제 버튼 0개', run: absent });
    expect(absent.judgments['R2-a']).toMatchObject({ verdict: `${UNMET}(부재)`, observed: true, targets: 1, causes: [{ element: 'button:필터 해제', value: 'absent' }], detail: { buttons: 0 } });
    const missingHtml = injectBlock(html, 'visible', () => "const toolbar = $('toolbar'); if (toolbar) toolbar.id = 'missingToolbar'; return rows;");
    const missingRegion = await runFixture(browser, missingHtml.html);
    boundaryRuns.push({ id: '도구 영역 관측 실패', run: missingRegion });
    expect(missingRegion.judgments['R2-a']).toMatchObject({ verdict: '미검증(관측 불가)', observed: false, targets: 0 });
  }, 120000);
});

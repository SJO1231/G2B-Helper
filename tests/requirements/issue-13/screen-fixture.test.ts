// #13 화면 검사(구현자 작성): 정상 합성 fixture와 결함 주입 사본.
// 정상 fixture의 결과는 사례별 기대 판정과의 일치(검사기 확인)이며 제품(F44·제품 코드) 충족이 아니다.
// 결함 주입은 메모리 안 사본의 표식 블록만 바꾸고, README §5 분류(lib/outcome)로 검출 성공을 확인한다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from '@playwright/test';
import { fixtureHtml, runFixture, type FixtureRun } from './lib/fixture-scenario';
import { MET } from './lib/judge';
import { DETECTED, classifyMutation, type Cause } from './lib/outcome';
import { injectBlock, launchBrowser, notObserved } from './lib/screen';

const NORMAL_IDS = [
  'A4-a', 'A4-b', 'A4-c', 'R2-init:D1', 'R2-init:D2', 'R1-a', 'R1-a2',
  'R1-v1', 'R1-v2', 'R1-v3', 'R1-v4', 'R1-v5', 'R1-v6', 'R1-v7', 'R1-v8', 'R1-e',
  'R2-a', 'R2-e', 'R2-f:P2-D1-values-1', 'R2-f:P2-D1-values-2', 'R2-f:P2-D1-includes', 'R2-f:P2-D1-exclude',
  'R2-0', 'R2-b', 'R2-c', 'A4-d',
];
/** 정상 fixture의 사례별 기대 판정. 이 범위에는 조건부·미확정·미검증 기대가 없다. */
const NORMAL_EXPECTED: Record<string, string> = Object.fromEntries(NORMAL_IDS.map((id) => [id, MET]));

interface Target { judgment: string; causes: Cause[]; }
interface Mutation { id: string; block: string; replace: (original: string) => string; targets: Target[]; }
const cell = (judgment: string): Target => ({ judgment, causes: [{ element: `cell:${judgment}`, value: 'display-mismatch' }] });

/** README R1·R2·A4 누락 반례. 지정 판정과 주입이 만들어야 하는 원인을 고정한다. */
const MUTATIONS: Mutation[] = [
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
    targets: [{ judgment: 'R2-0', causes: [{ element: 'row:e1', value: 'missing' }, { element: 'row:e2', value: 'missing' }, { element: 'row:e3', value: 'missing' }] }],
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
  { id: 'M-A4-7 처음 화면에서 1행 누락', block: 'visible', replace: () => "return current === 'm04' ? rows.filter(({ id }) => id !== '#2') : rows;", targets: [{ judgment: 'A4-c', causes: [{ element: 'row:#2', value: 'missing' }] }] },
];

let browser: Browser;
let normal: FixtureRun;
const mutatedRuns = new Map<string, Promise<FixtureRun>>();

beforeAll(async () => {
  browser = await launchBrowser();
  normal = await runFixture(browser, fixtureHtml());
}, 120000);
afterAll(async () => { await browser?.close(); });

describe('#13 화면 검사: 정상 합성 fixture(검사기 확인, 제품 판정 아님)', () => {
  it('외부 요청 없이 열리고 판정 26개를 모두 만들며 페이지·단계 오류가 없다', () => {
    expect(NORMAL_IDS).toHaveLength(26);
    expect(normal.blocked).toEqual([]);
    expect(normal.errors).toEqual([]);
    expect(Object.keys(normal.judgments).sort()).toEqual([...NORMAL_IDS].sort());
  });

  for (const id of NORMAL_IDS) {
    it(`${id}: 사례별 기대 판정 ${NORMAL_EXPECTED[id]}`, () => {
      const judged = normal.judgments[id] ?? notObserved('판정 없음');
      expect({ id, ...judged }).toMatchObject({ verdict: NORMAL_EXPECTED[id], observed: true, outputComplete: true, witness: true });
      expect(judged.targets).toBeGreaterThan(0);
    });
  }
});

describe('#13 화면 검사: 결함 주입 사본(README §5 분류로 검출 성공 확인)', () => {
  it('결함 주입 21개, 지정 판정 28개', () => {
    expect(MUTATIONS).toHaveLength(21);
    expect(MUTATIONS.flatMap((mutation) => mutation.targets)).toHaveLength(28);
  });

  for (const mutation of MUTATIONS) {
    for (const target of mutation.targets) {
      it(`${mutation.id} → ${target.judgment}: 검출 성공`, async () => {
        const injected = injectBlock(fixtureHtml(), mutation.block, mutation.replace);
        let pending = mutatedRuns.get(mutation.id);
        if (!pending) {
          pending = runFixture(browser, injected.html);
          mutatedRuns.set(mutation.id, pending);
        }
        const run = await pending;
        const judged = run.judgments[target.judgment] ?? notObserved('판정 없음');
        const baseline = normal.judgments[target.judgment] ?? notObserved('기준 판정 없음');
        const otherFailures = Object.entries(run.judgments)
          .filter(([id, other]) => id !== target.judgment && other.verdict !== NORMAL_EXPECTED[id])
          .map(([id]) => id);
        const classified = classifyMutation({
          id: mutation.id,
          kind: 'judgment',
          designated: target.judgment,
          expectedBaseline: NORMAL_EXPECTED[target.judgment],
          injection: { markerFound: injected.markerFound, beforeSha256: injected.beforeSha256, afterSha256: injected.afterSha256 },
          baseline: { verdict: baseline.verdict, witness: baseline.witness },
          mutated: { observed: judged.observed, targets: judged.targets, verdict: judged.verdict, causes: judged.causes, outputComplete: judged.outputComplete, otherFailures },
          injectedCauses: target.causes,
        });
        expect({ ...classified, mutation: mutation.id, judged, blocked: run.blocked }).toMatchObject({ outcome: DETECTED, blocked: [] });
      }, 60000);
    }
  }
});

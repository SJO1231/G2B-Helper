// #13 검사기 자체 검사(구현자 작성). 제품 코드를 불러오지 않는다.
// 같은 판정 함수를 요구에서 직접 만든 기준 구현과 의도 결함 대체 구현에 적용해, 정상은 충족·결함은 지정 판정 미충족이 되는지 본다.
// 여기서 나오는 결과는 검사기 확인이며 제품 충족 집계가 아니다(README §5).
import { describe, expect, it } from 'vitest';
import type { GridFilter, JsonRow } from '../../../apps/mvp/contracts';
import { numberPath, roundDecimal } from './lib/exact-decimal';
import { D1_FILTER_CASES, D1_ROWS, D2_ALL, D2_B, D2_BV, D2_FILTER, D2_ROWS, D2_SEARCH, R1_CASES, preservationRows, type FilterCase, type R1Case, type Row } from './lib/cases';
import { MET, NOT_RUN, UNMET, UNVERIFIED, judgeDisplay, judgePreservation, judgeRowMultiset, judgeSearchFilterClear, summarize, type SearchFilterObservations } from './lib/judge';

// ---------- R1·P1 표시 판정 ----------
const group = (text: string): string => text.replace(/^(-?)(\d+)/, (_whole: string, sign: string, integer: string) => sign + integer.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const formatters: Record<string, (item: R1Case) => string> = {
  reference: (item) => group(item.digits === null ? item.raw : roundDecimal(item.raw, item.digits, 'half-up')),
  numberBased: (item) => group(numberPath(item.raw, item.digits)),
  truncating: (item) => group(item.digits === null ? item.raw : roundDecimal(item.raw, item.digits, 'truncate')),
  ignoresSetting: (item) => group(item.raw),
};
const r1Verdicts = (format: (item: R1Case) => string): Record<string, string> =>
  Object.fromEntries(R1_CASES.map((item) => [item.id, judgeDisplay(item, format(item)).verdict]));

describe('#13 검사기 자체 검사: R1·P1 표시 판정', () => {
  it('요구에서 만든 기준 서식은 8건 모두 충족', () => {
    const result = r1Verdicts(formatters.reference);
    expect(Object.keys(result)).toHaveLength(8);
    for (const verdict of Object.values(result)) expect(verdict).toBe(MET);
  });

  it('Number 기반 서식(M-R1-3)은 Number 손실 구별 사례 R1-v1·v2·v3·v7·v8에서만 미충족', () => {
    const result = r1Verdicts(formatters.numberBased);
    for (const item of R1_CASES) expect([item.id, result[item.id]]).toEqual([item.id, item.numberLoss ? UNMET : MET]);
    expect(R1_CASES.filter((item) => item.numberLoss).map((item) => item.id)).toEqual(['R1-v1', 'R1-v2', 'R1-v3', 'R1-v7', 'R1-v8']);
  });

  it('버림 서식(M-R1-4)은 R1-v5·v6에서만 미충족', () => {
    const result = r1Verdicts(formatters.truncating);
    for (const item of R1_CASES) expect([item.id, result[item.id]]).toEqual([item.id, ['R1-v5', 'R1-v6'].includes(item.id) ? UNMET : MET]);
  });

  it('설정 무시(M-R1-5)는 R1-v1·v2 중 하나 이상에서 미충족', () => {
    const result = r1Verdicts(formatters.ignoresSetting);
    expect([result['R1-v1'], result['R1-v2']]).toContain(UNMET);
  });

  it('관측값이 없으면 통과가 아니라 미검증', () => {
    expect(judgeDisplay(R1_CASES[0], undefined).verdict).toBe(UNVERIFIED);
    expect(judgeDisplay(R1_CASES[0], null).verdict).toBe(UNVERIFIED);
  });
});

// ---------- P2 필터 판정 ----------
// 기준 구현: README R2-f 의미를 그대로 옮겼다. values 토큰은 [자료형, 값]을 해석하며 제품 valueToken()을 쓰지 않는다.
interface FilterImpl {
  matches(row: Row, column: string, filter: GridFilter): boolean;
  search(row: Row, term: string): boolean;
  dedupe?: boolean;
  applyIgnored?: boolean;
  clearDropsSearch?: boolean;
}
const kind = (value: unknown): string => (value === null ? 'null' : value === undefined ? 'missing' : typeof value);
const reference: FilterImpl = {
  matches(row, column, filter) {
    const value: unknown = row[column];
    if (filter.mode === 'values') {
      return filter.values.some((token) => {
        const [type, expected] = JSON.parse(token) as [string, unknown];
        return kind(value) === type && value === expected;
      });
    }
    const text = String(value ?? '');
    if (filter.mode === 'includes') return filter.terms.some((term) => text.includes(term));
    if (filter.mode === 'exclude') return !filter.terms.some((term) => text.includes(term));
    return filter.terms.some((term) => text === term);
  },
  search: (row, term) => !term || Object.values(row).some((value) => String(value ?? '').includes(term)),
};
const defects: Record<string, FilterImpl> = {
  partialValues: {
    ...reference,
    matches: (row, column, filter) => filter.mode === 'values'
      ? filter.values.some((token) => String(row[column]).includes(String((JSON.parse(token) as [string, unknown])[1])))
      : reference.matches(row, column, filter),
  },
  wrongColumn: { ...reference, matches: (row, _column, filter) => reference.matches(row, '기관', filter) },
  mergesDuplicates: { ...reference, dedupe: true },
  searchIgnored: { ...reference, search: () => true },
  searchEmpty: { ...reference, search: () => false },
  applyIgnored: { ...reference, applyIgnored: true },
  clearDropsSearch: { ...reference, clearDropsSearch: true },
};
function d1Ids(impl: FilterImpl, item: FilterCase): string[] {
  let rows = D1_ROWS.filter((row) => impl.matches(row, item.column, item.filter));
  if (impl.dedupe) rows = rows.filter((row, index) => rows.findIndex((other) => other['번호'] === row['번호'] && other['차수'] === row['차수']) === index);
  return rows.map((row) => row.id);
}
function d2Observations(impl: FilterImpl): SearchFilterObservations {
  const pick = (term: string, withFilter: boolean): string[] => D2_ROWS
    .filter((row) => impl.search(row, term) && (!withFilter || impl.applyIgnored || impl.matches(row, D2_FILTER.column, D2_FILTER.filter)))
    .map((row) => row.id);
  return { search: pick(D2_SEARCH, false), searchAndFilter: pick(D2_SEARCH, true), cleared: pick(impl.clearDropsSearch ? '' : D2_SEARCH, false) };
}
const d2 = (impl: FilterImpl) => judgeSearchFilterClear({ all: D2_ALL, b: D2_B, bv: D2_BV }, d2Observations(impl));

describe('#13 검사기 자체 검사: P2 필터 판정', () => {
  it('기준 구현은 D1 4건 모두 충족', () => {
    expect(D1_FILTER_CASES).toHaveLength(4);
    for (const item of D1_FILTER_CASES) expect([item.id, judgeRowMultiset(item.expected, d1Ids(reference, item)).verdict]).toEqual([item.id, MET]);
  });

  it('값 목록 부분 일치(M-R2-6)는 d2가 섞여 미충족', () => {
    expect(judgeRowMultiset(D1_FILTER_CASES[0].expected, d1Ids(defects.partialValues, D1_FILTER_CASES[0]))).toMatchObject({ verdict: UNMET, missing: [], extra: ['d2'] });
  });

  it('대조 열 적용(M-R2-5)은 d5만 나와 미충족', () => {
    expect(judgeRowMultiset(D1_FILTER_CASES[0].expected, d1Ids(defects.wrongColumn, D1_FILTER_CASES[0]))).toMatchObject({ verdict: UNMET, missing: ['d1', 'd3', 'd4'], extra: ['d5'] });
  });

  it('번호·차수로 중복 병합(M-R2-8)은 d4가 빠져 미충족', () => {
    expect(judgeRowMultiset(D1_FILTER_CASES[0].expected, d1Ids(defects.mergesDuplicates, D1_FILTER_CASES[0]))).toMatchObject({ verdict: UNMET, missing: ['d4'], extra: [] });
  });

  it('기준 구현은 D2 검색 전제·적용·해제 모두 충족', () => {
    const result = d2(reference);
    expect([result.premise.verdict, result.apply.verdict, result.clear.verdict]).toEqual([MET, MET, MET]);
  });

  it('검색 무시는 검색 전제 미충족이고 적용·해제는 통과가 아니라 미검증', () => {
    const result = d2(defects.searchIgnored);
    expect(result.premise).toMatchObject({ verdict: UNMET, extra: ['e4', 'e5'] });
    expect([result.apply.verdict, result.clear.verdict]).toEqual([UNVERIFIED, UNVERIFIED]);
  });

  it('검색 공집합(M-R2-7)은 검색 전제 미충족이며 원인으로 B 전체 누락과 빈 관측을 출력', () => {
    const result = d2(defects.searchEmpty);
    expect(result.premise).toMatchObject({ verdict: UNMET, missing: ['e1', 'e2', 'e3'], observed: [] });
    expect(result.apply.verdict).toBe(UNVERIFIED);
  });

  it('적용 무시(M-R2-1)는 적용 미충족', () => {
    const result = d2(defects.applyIgnored);
    expect(result.premise.verdict).toBe(MET);
    expect(result.apply).toMatchObject({ verdict: UNMET, extra: ['e3'] });
  });

  it('해제가 검색까지 지움(M-R2-2)은 해제 미충족', () => {
    expect(d2(defects.clearDropsSearch).clear).toMatchObject({ verdict: UNMET, extra: ['e4', 'e5'] });
  });

  it('증인이 성립하지 않는 자료는 미검증(증인 불성립)', () => {
    const result = judgeSearchFilterClear({ all: D2_ALL, b: D2_ALL, bv: D2_BV }, d2Observations(reference));
    expect([result.premise.verdict, result.apply.verdict, result.clear.verdict]).toEqual([UNVERIFIED, UNVERIFIED, UNVERIFIED]);
  });

  it('관측값이 없으면 미검증', () => {
    expect(judgeRowMultiset(['d1'], undefined).verdict).toBe(UNVERIFIED);
  });
});

// ---------- 원값 보존 판정(A4·P4) ----------
const mapScalars = (value: unknown, change: (scalar: unknown) => unknown): unknown => {
  if (Array.isArray(value)) return value.map((item: unknown) => mapScalars(item, change));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapScalars(item, change)]));
  return change(value);
};
const roundTrips: Record<string, (rows: JsonRow[]) => unknown> = {
  zeroToEmpty: (rows) => mapScalars(rows, (value) => (value === '0' ? '' : value)),
  falseToText: (rows) => mapScalars(rows, (value) => (value === false ? 'false' : value)),
  leadingZeroToNumber: (rows) => rows.map((row) => (Object.hasOwn(row, 'itemIdnfNo') && row.itemIdnfNo !== '' ? { ...row, itemIdnfNo: Number(row.itemIdnfNo) } : { ...row })),
  moneyViaNumber: (rows) => rows.map((row) => (Object.hasOwn(row, 'money') && row.money !== '' ? { ...row, money: String(Number(row.money)) } : { ...row })),
  dropsEmptyKey: (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== ''))),
  fillsMissingKeys: (rows) => {
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return rows.map((row) => Object.fromEntries(keys.map((key) => [key, Object.hasOwn(row, key) ? row[key] : ''])));
  },
};
const expectedPaths: Record<string, string[]> = {
  zeroToEmpty: ['$[0]["amountText"]', '$[0]["items"][0]["qty"]', '$[1]["amountText"]', '$[1]["items"][0]["qty"]'],
  falseToText: ['$[0]["confirmed"]', '$[0]["items"][0]["checked"]', '$[1]["confirmed"]', '$[1]["items"][0]["checked"]'],
  leadingZeroToNumber: ['$[0]["itemIdnfNo"]', '$[1]["itemIdnfNo"]'],
  moneyViaNumber: ['$[0]["money"]', '$[1]["money"]'],
  dropsEmptyKey: ['$[0][""]', '$[1][""]', '$[2][""]'],
  fillsMissingKeys: ['$[3][""]', '$[3]["amountText"]', '$[3]["amountNumber"]', '$[3]["confirmed"]', '$[3]["note"]', '$[3]["itemIdnfNo"]', '$[3]["items"]'],
};

describe('#13 검사기 자체 검사: 원값 보존 판정', () => {
  it('복제 왕복은 충족이고 원천도 그대로', () => {
    const source = preservationRows();
    expect(judgePreservation(preservationRows(), structuredClone(source)).verdict).toBe(MET);
    expect(judgePreservation(preservationRows(), source).verdict).toBe(MET);
  });

  for (const [name, paths] of Object.entries(expectedPaths)) {
    it(`결함 ${name}은 미충족이며 원인 위치를 빠짐없이 출력`, () => {
      const result = judgePreservation(preservationRows(), roundTrips[name](preservationRows()));
      expect(result.verdict).toBe(UNMET);
      expect((result.differences ?? []).map((difference) => difference.path).sort()).toEqual([...paths].sort());
    });
  }

  it('중복 행 병합은 행 수 차이로 미충족', () => {
    const rows = preservationRows();
    const merged = rows.filter((row, index) => rows.findIndex((other) => JSON.stringify(other) === JSON.stringify(row)) === index);
    const result = judgePreservation(preservationRows(), merged);
    expect(result.verdict).toBe(UNMET);
    expect(result.differences?.[0]).toEqual({ path: '$', kind: 'length', expected: 4, actual: 3 });
  });

  it('원천을 복제하지 않는 작업 모델은 작업 편집이 원천을 바꿔 미충족', () => {
    const source = preservationRows();
    const working = source; // 결함: 복제 없이 같은 객체를 작업 자료로 씀
    working[0].money = '1.5';
    const result = judgePreservation(preservationRows(), source);
    expect(result.verdict).toBe(UNMET);
    expect((result.differences ?? []).map((difference) => difference.path)).toEqual(['$[0]["money"]']);
  });

  it('관측하지 못하면 미검증', () => {
    expect(judgePreservation(preservationRows(), undefined, { observed: false }).verdict).toBe(UNVERIFIED);
  });
});

describe('#13 검사기 자체 검사: 집계', () => {
  it('대상 0건, 미실행·미검증 포함은 충족이 아니고 미충족이 있으면 미충족', () => {
    expect(summarize([]).overall).toBe(`${UNVERIFIED}(대상 0건)`);
    expect(summarize([{ verdict: MET }, { verdict: NOT_RUN }]).overall).toBe(`${UNVERIFIED}(충족 아닌 결과 포함)`);
    expect(summarize([{ verdict: MET }, { verdict: UNVERIFIED }]).overall).toBe(`${UNVERIFIED}(충족 아닌 결과 포함)`);
    expect(summarize([{ verdict: MET }, { verdict: UNMET }]).overall).toBe(UNMET);
    expect(summarize([{ verdict: MET }, { verdict: MET }]).overall).toBe(MET);
  });
});

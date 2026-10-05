// #13 L-B 제품 순수 함수 검사(구현자 작성). 실제 제품 모듈과 실제 의존성(decimal.js)을 그대로 import한다.
// 대체 모듈·skip·조건부 성공을 쓰지 않는다. 기대값은 README 고정 사례(lib/cases.ts)이며 제품 결과에서 가져오지 않는다.
// 제품이 요구를 충족하지 못하면 이 검사는 실패하며, 기대값·제품·CI를 바꾸지 않고 실패로 보고한다.
import { describe, expect, it } from 'vitest';
import { GridModel, formatValue, matchesColumn, matchesView, type GridFilter, type GridView } from '../../../apps/mvp/grid-model';
import { D1_FILTER_CASES, D1_ROWS, D2_ALL, D2_B, D2_BV, D2_FILTER, D2_ROWS, D2_SEARCH, R1_CASES, preservationRows } from './lib/cases';
import { MET, judgeDisplay, judgePreservation, judgeRowMultiset, judgeSearchFilterClear } from './lib/judge';

describe('#13 L-B P1 formatValue 고정 사례(R1-v1~v8)', () => {
  it('사례표가 8건이다(대상 0건 방지)', () => {
    expect(R1_CASES).toHaveLength(8);
  });

  for (const item of R1_CASES) {
    it(`${item.id}: ${item.raw} → 설정 ${item.digits === null ? '원본 유지' : item.digits}`, () => {
      const displayed = formatValue(item.raw, item.type, item.digits === null ? {} : { decimals: item.digits });
      expect(judgeDisplay(item, displayed)).toMatchObject({ verdict: MET });
    });
  }
});

describe('#13 L-B P2 matchesColumn·matchesView 고정 기대(D1·D2)', () => {
  for (const item of D1_FILTER_CASES) {
    it(`${item.id}: matchesColumn 결과 다중집합이 고정 기대와 같고 입력 행이 바뀌지 않는다`, () => {
      const rows = D1_ROWS.map((row) => ({ ...row }));
      const before = structuredClone(rows);
      const ids = rows.filter((row) => matchesColumn(row, item.column, item.filter)).map((row) => row.id);
      expect(judgeRowMultiset(item.expected, ids)).toMatchObject({ verdict: MET });
      expect(judgePreservation(before, rows)).toMatchObject({ verdict: MET });
    });
  }

  const view = (search: string, filters: [string, GridFilter][]): GridView => ({ search, combine: 'and', filters: new Map(filters) });

  it('P2-D2: 검색 전제·적용·필터 비운 뒤 검색 유지가 고정 기대와 같고 입력 행이 바뀌지 않는다', () => {
    const rows = D2_ROWS.map((row) => ({ ...row }));
    const before = structuredClone(rows);
    const pick = (current: GridView): string[] => rows.filter((row) => matchesView(row, current)).map((row) => row.id);
    const result = judgeSearchFilterClear({ all: D2_ALL, b: D2_B, bv: D2_BV }, {
      search: pick(view(D2_SEARCH, [])),
      searchAndFilter: pick(view(D2_SEARCH, [[D2_FILTER.column, D2_FILTER.filter]])),
      cleared: pick(view(D2_SEARCH, [])),
    });
    expect(result.premise).toMatchObject({ verdict: MET });
    expect(result.apply).toMatchObject({ verdict: MET });
    expect(result.clear).toMatchObject({ verdict: MET });
    expect(judgePreservation(before, rows)).toMatchObject({ verdict: MET });
  });

  it('P2-D2: 검색·조건이 없으면 모든 행이 남는다', () => {
    const rows = D2_ROWS.map((row) => ({ ...row }));
    expect(judgeRowMultiset(D2_ALL, rows.filter((row) => matchesView(row, view('', []))).map((row) => row.id))).toMatchObject({ verdict: MET });
  });
});

describe('#13 L-B P4 GridModel 원값 왕복 보존(A4·M04)', () => {
  it('encode→rows 왕복이 입력과 같고 원천 행이 바뀌지 않는다', () => {
    const source = preservationRows();
    const sourceBefore = structuredClone(source);
    const model = new GridModel(source);
    const back = model.rows(model.encode(source));
    expect(judgePreservation(preservationRows(), back)).toMatchObject({ verdict: MET });
    expect(judgePreservation(sourceBefore, source)).toMatchObject({ verdict: MET });
  });

  it('작업 버퍼 셀 하나를 바꾸면 되돌린 행에서는 그 셀만 바뀌고 원천 행은 그대로다', () => {
    const source = preservationRows();
    const sourceBefore = structuredClone(source);
    const model = new GridModel(source);
    const buffer = model.encode(source);
    // 어댑터: 작업 버퍼의 필드 이름은 제품 GridModel.columns의 key→field 대응으로 찾는다.
    const column = model.columns.find((candidate) => candidate.key === 'money');
    expect(column).toBeDefined();
    buffer[0][column!.field] = '1.5';
    const expected = preservationRows();
    expected[0].money = '1.5';
    expect(judgePreservation(expected, model.rows(buffer))).toMatchObject({ verdict: MET });
    expect(judgePreservation(sourceBefore, source)).toMatchObject({ verdict: MET });
  });

  it('작업 버퍼의 중첩 품목 값을 바꾸면 되돌린 행에서는 그 값만 바뀌고 원천 행의 중첩 값은 고정 증인 그대로다', () => {
    const source = preservationRows();
    const model = new GridModel(source);
    const buffer = model.encode(source);
    const column = model.columns.find((candidate) => candidate.key === 'items');
    expect(column).toBeDefined();
    // 작업 버퍼의 중첩 배열을 그 자리에서 바꾼다. encode가 원천을 얕게만 복제하면 이 변경이 원천 items에 새어 들어간다.
    const workingItems = buffer[0][column!.field] as { qty: unknown }[];
    workingItems[0].qty = '9';
    // 원천 기대값은 실행 전 스냅숏이 아니라 고정 증인(preservationRows)에서 만든다: items[0].qty는 '0'이어야 한다.
    expect(judgePreservation(preservationRows(), source)).toMatchObject({ verdict: MET });
    const expected = preservationRows();
    (expected[0].items as { qty: unknown }[])[0].qty = '9';
    expect(judgePreservation(expected, model.rows(buffer))).toMatchObject({ verdict: MET });
  });
});

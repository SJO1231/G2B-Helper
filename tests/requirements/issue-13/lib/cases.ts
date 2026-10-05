// #13 기준표 v3.1의 고정 사례. 기대값은 README에 적은 문자열을 그대로 옮긴 것이며 제품 구현에서 가져오지 않는다.
import type { GridFilter, JsonRow, MvpColumnType } from '../../../../apps/mvp/contracts';

export interface R1Case {
  id: string;
  raw: string;
  type: MvpColumnType;
  /** null은 명시적 "원본 유지"(현재 API에서는 decimals 미지정). 기본 자릿수 판정이 아니다. */
  digits: number | null;
  expected: string;
  numberPath: string;
  numberLoss: boolean;
  /** null은 원본 유지라 버림 구별 대상이 아님. */
  truncation: boolean | null;
  truncated?: string;
}

/** R1 고정 사례표(README R1, L-B P1). */
export const R1_CASES: R1Case[] = [
  { id: 'R1-v1', raw: '9007199254740993.25', type: 'money', digits: 2, expected: '9007199254740993.25', numberPath: '9007199254740994.00', numberLoss: true, truncation: false },
  { id: 'R1-v2', raw: '9007199254740993.25', type: 'money', digits: 0, expected: '9007199254740993', numberPath: '9007199254740994', numberLoss: true, truncation: false },
  { id: 'R1-v3', raw: '9007199254740993.25', type: 'money', digits: null, expected: '9007199254740993.25', numberPath: '9007199254740994', numberLoss: true, truncation: null },
  { id: 'R1-v4', raw: '35608652.5', type: 'money', digits: 1, expected: '35608652.5', numberPath: '35608652.5', numberLoss: false, truncation: false },
  { id: 'R1-v5', raw: '9007199254740993.75', type: 'money', digits: 0, expected: '9007199254740994', numberPath: '9007199254740994', numberLoss: false, truncation: true, truncated: '9007199254740993' },
  { id: 'R1-v6', raw: '0.26', type: 'number', digits: 1, expected: '0.3', numberPath: '0.3', numberLoss: false, truncation: true, truncated: '0.2' },
  { id: 'R1-v7', raw: '0.123456789012345678901', type: 'number', digits: 20, expected: '0.12345678901234567890', numberPath: '0.12345678901234567737', numberLoss: true, truncation: false },
  { id: 'R1-v8', raw: '12345678901234567890.125', type: 'money', digits: 3, expected: '12345678901234567890.125', numberPath: '12345678901234567168.000', numberLoss: true, truncation: false },
];

/** 동률이라 사례에서 뺀 값(README R1). 규칙에 따라 결과가 갈리는지만 검산한다. */
export const R1_EXCLUDED_TIE = { raw: '35608652.5', digits: 0, halfUp: '35608653', halfEven: '35608652' };

export type Row = Record<string, string>;

/** R2 D1(필터 의미). id는 행 식별용이며 검색어·조건 값을 포함하지 않는다. */
export const D1_ROWS: Row[] = [
  { id: 'd1', 번호: 'N-001', 차수: '01', 검수명: 'A4 용지', 기관: '갑기관' },
  { id: 'd2', 번호: 'N-001', 차수: '02', 검수명: 'A4 용지 구매', 기관: '을기관' },
  { id: 'd3', 번호: 'N-003', 차수: '01', 검수명: 'A4 용지', 기관: '을기관' },
  { id: 'd4', 번호: 'N-001', 차수: '01', 검수명: 'A4 용지', 기관: '갑기관' },
  { id: 'd5', 번호: 'N-005', 차수: '01', 검수명: '토너 교체', 기관: 'A4 용지' },
  { id: 'd6', 번호: 'N-006', 차수: '01', 검수명: '복사기 임차', 기관: '갑기관' },
];

export interface FilterCase { id: string; column: string; filter: GridFilter; expected: string[]; }

/**
 * D1 조건과 기대 다중집합(README R2 D1 표). values 토큰은 현재 API 형식(JSON 배열 [자료형, 값])으로 직접 적었다.
 * 제품 valueToken()으로 만들지 않는다.
 */
export const D1_FILTER_CASES: FilterCase[] = [
  { id: 'P2-D1-values-1', column: '검수명', filter: { mode: 'values', values: ['["string","A4 용지"]'] }, expected: ['d1', 'd3', 'd4'] },
  { id: 'P2-D1-values-2', column: '검수명', filter: { mode: 'values', values: ['["string","A4 용지"]', '["string","토너 교체"]'] }, expected: ['d1', 'd3', 'd4', 'd5'] },
  { id: 'P2-D1-includes', column: '검수명', filter: { mode: 'includes', terms: ['A4 용지'] }, expected: ['d1', 'd2', 'd3', 'd4'] },
  { id: 'P2-D1-exclude', column: '검수명', filter: { mode: 'exclude', terms: ['A4 용지'] }, expected: ['d5', 'd6'] },
];

/** R2 D2(검색·적용·해제). */
export const D2_ROWS: Row[] = [
  { id: 'e1', 검수명: 'A4 용지 납품', 기관: '갑기관' },
  { id: 'e2', 검수명: 'A4 용지 납품', 기관: '갑기관' },
  { id: 'e3', 검수명: 'A4 용지 구매', 기관: '을기관' },
  { id: 'e4', 검수명: '토너 교체', 기관: '을기관' },
  { id: 'e5', 검수명: '복사기 임차', 기관: '갑기관' },
];
export const D2_SEARCH = 'A4';
export const D2_ALL = ['e1', 'e2', 'e3', 'e4', 'e5'];
export const D2_B = ['e1', 'e2', 'e3'];
export const D2_BV = ['e1', 'e2'];
export const D2_FILTER: { column: string; filter: GridFilter } = { column: '검수명', filter: { mode: 'values', values: ['["string","A4 용지 납품"]'] } };

/**
 * P4·A4 원값 보존 증인(MVP:25 M04 범주). 기대값은 입력 자체다. 부를 때마다 새 객체를 만든다.
 * 빈 키 "", 0과 '0', false, null, 선행0, 소수 문자열, 중첩 배열, 중복 행, 모든 값이 빈 원래 행, 키가 없는 행.
 */
export function preservationRows(): JsonRow[] {
  const base = (): JsonRow => ({
    '': '빈 키 값',
    amountText: '0',
    amountNumber: 0,
    confirmed: false,
    note: null,
    itemIdnfNo: '00001234',
    money: '9007199254740993.25',
    items: [{ dtlsPrnm: '[업무용] 모니터', qty: '0', checked: false }, { dtlsPrnm: '모니터 거치대', qty: '3', checked: true }],
  });
  return [
    base(),
    base(),
    { '': '', amountText: '', amountNumber: '', confirmed: '', note: '', itemIdnfNo: '', money: '', items: '' },
    { money: '1' },
  ];
}

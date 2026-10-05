// #13 F6 결과 분류 자체 검사(구현자 작성). README §5(v3.1.3)의 분기마다 고정 기대 분류와 직접 대조한다.
// 결함 주입 결과 분류기의 확인이며 제품 충족이나 #13 요구 충족 집계가 아니다.
import { describe, expect, it } from 'vitest';
import { DETECTED, MISSED, NOT_APPLICABLE, UNDECIDABLE, classifyMutation, type MutationRun } from './lib/outcome';

const applied = { markerFound: true, beforeSha256: 'a'.repeat(64), afterSha256: 'b'.repeat(64) };
const injected = [{ element: 'row:e3', value: 'extra' }];

function judgmentRun(overrides: Partial<MutationRun> = {}, mutated: Partial<MutationRun['mutated']> = {}): MutationRun {
  return {
    id: 'M-TEST',
    kind: 'judgment',
    designated: 'R2-b',
    expectedBaseline: '충족',
    injection: applied,
    baseline: { verdict: '충족', witness: true },
    mutated: { observed: true, targets: 5, verdict: '미충족', causes: [{ element: 'row:e3', value: 'extra' }], outputComplete: true, ...mutated },
    injectedCauses: injected,
    ...overrides,
  };
}

function reportRun(overrides: Partial<MutationRun> = {}, mutated: Partial<MutationRun['mutated']> = {}): MutationRun {
  return {
    id: 'M-R4-8',
    kind: 'report',
    designated: 'R4-c 근거 미확인',
    expectedReport: [],
    injection: applied,
    baseline: { report: [], witness: true },
    mutated: { observed: true, targets: 12, report: ['button:주입 업무'], outputComplete: true, ...mutated },
    injectedCauses: [{ element: 'button:주입 업무' }],
    ...overrides,
  };
}

const cases: { name: string; run: MutationRun; outcome: string; reason: string }[] = [
  { name: '정상 충족 → 미충족, 원인 일치', run: judgmentRun(), outcome: DETECTED, reason: '지정 판정 미충족, 원인이 주입 결함과 일치' },
  {
    name: '정상 조건부 → 미충족, 원인 일치',
    run: judgmentRun({ designated: 'A1-s1', expectedBaseline: '조건부(대표 규칙 미확정)', baseline: { verdict: '조건부(대표 규칙 미확정)', witness: true }, injectedCauses: [{ element: 'summary:name', value: 'no-item-name' }] }, { causes: [{ element: 'summary:name', value: 'no-item-name' }] }),
    outcome: DETECTED, reason: '지정 판정 미충족, 원인이 주입 결함과 일치',
  },
  { name: '보고 검사: 정상 출력 목록에 주입 항목이 나옴', run: reportRun(), outcome: DETECTED, reason: '보고 목록에 주입 항목이 나옴' },
  {
    name: '확인된 부재: 미충족(부재), 원인 일치',
    run: judgmentRun({ designated: 'R1-a', injectedCauses: [{ element: 'control:소수 자릿수', value: 'absent' }] }, { verdict: '미충족(부재)', causes: [{ element: 'control:소수 자릿수', value: 'absent' }] }),
    outcome: DETECTED, reason: '지정 판정 미충족, 원인이 주입 결함과 일치',
  },
  { name: '출력 불완전이어도 주입 원인이 출력됐으면 검출', run: judgmentRun({}, { outputComplete: false }), outcome: DETECTED, reason: '지정 판정 미충족, 원인이 주입 결함과 일치' },
  { name: '미검출: 주입 뒤에도 충족', run: judgmentRun({}, { verdict: '충족', causes: [] }), outcome: MISSED, reason: '① 지정 판정이 충족' },
  { name: '보고 검사: 정상 출력 목록에 다른 버튼만 있음', run: reportRun({}, { report: ['button:다른 버튼'] }), outcome: MISSED, reason: '② 정상 출력된 보고 목록에 주입 항목이 없음' },
  { name: '다른 원인: 미충족이지만 원인이 다른 요소', run: judgmentRun({}, { causes: [{ element: 'row:e4', value: 'extra' }] }), outcome: MISSED, reason: '③ 지정 판정 미충족이지만 원인이 주입 결함과 다름' },
  { name: '다른 원인: 같은 요소, 다른 값', run: judgmentRun({}, { causes: [{ element: 'row:e3', value: 'missing' }] }), outcome: MISSED, reason: '③ 지정 판정 미충족이지만 원인이 주입 결함과 다름' },
  { name: '다른 판정만 실패', run: judgmentRun({}, { verdict: '충족', causes: [], otherFailures: ['R2-c'] }), outcome: MISSED, reason: '④ 다른 판정만 실패, 지정 판정은 충족' },
  {
    name: '조건부 생존',
    run: judgmentRun({ designated: 'A1-s1', expectedBaseline: '조건부(대표 규칙 미확정)', baseline: { verdict: '조건부(대표 규칙 미확정)', witness: true } }, { verdict: '조건부(대표 규칙 미확정)', causes: [] }),
    outcome: MISSED, reason: '⑤ 주입 뒤에도 조건부로 남음',
  },
  { name: '충족 기대가 주입 뒤 조건부', run: judgmentRun({}, { verdict: '조건부(대표 규칙 미확정)', causes: [] }), outcome: MISSED, reason: '미충족 전환 실패: 충족 기대 판정이 주입 뒤 조건부' },
  { name: '주입 미적용: 표식 없음', run: judgmentRun({ injection: { ...applied, markerFound: false } }), outcome: UNDECIDABLE, reason: '(가) 주입 미적용' },
  { name: '주입 미적용: 해시 같음', run: judgmentRun({ injection: { ...applied, afterSha256: applied.beforeSha256 } }), outcome: UNDECIDABLE, reason: '(가) 주입 미적용' },
  { name: '기준 실행 판정이 기대와 다름', run: judgmentRun({ baseline: { verdict: '미충족', witness: true } }), outcome: UNDECIDABLE, reason: '(나) 기준 실행 판정이 사례별 기대 판정과 다름' },
  { name: '기준 실행 증인 불성립', run: judgmentRun({ baseline: { verdict: '충족', witness: false } }), outcome: UNDECIDABLE, reason: '(나) 기준 실행 증인 불성립' },
  { name: '보고 검사 기준 출력이 고정 기대와 다름', run: reportRun({ baseline: { report: ['button:예상 밖'], witness: true } }), outcome: UNDECIDABLE, reason: '(나) 기준 실행 보고가 고정 기대 출력과 다름' },
  { name: '관측 실패', run: judgmentRun({}, { observed: false }), outcome: UNDECIDABLE, reason: '(다) 관측 실패' },
  { name: '대상 0건', run: judgmentRun({}, { targets: 0 }), outcome: UNDECIDABLE, reason: '(다) 대상 0건' },
  { name: '출력 불완전이고 주입 원인 없음', run: judgmentRun({}, { causes: [{ element: 'row:e4', value: 'extra' }], outputComplete: false }), outcome: UNDECIDABLE, reason: '원인 목록 출력 불완전' },
  { name: '보고 출력 불완전이고 주입 항목 없음', run: reportRun({}, { report: [], outputComplete: false }), outcome: UNDECIDABLE, reason: '보고 출력 불완전' },
  { name: '정상 충족 기대가 주입 뒤 미확정', run: judgmentRun({}, { verdict: '미확정(관측만: 미등록 표기)', causes: [] }), outcome: UNDECIDABLE, reason: '주입 뒤 지정 판정이 미확정 또는 미검증' },
  { name: '정상 충족 기대가 주입 뒤 미검증', run: judgmentRun({}, { verdict: '미검증(검색 전제 불성립)', causes: [] }), outcome: UNDECIDABLE, reason: '주입 뒤 지정 판정이 미확정 또는 미검증' },
  {
    name: '정상 조건부 기대가 주입 뒤 미검증',
    run: judgmentRun({ expectedBaseline: '조건부(대표 규칙 미확정)', baseline: { verdict: '조건부(대표 규칙 미확정)', witness: true } }, { verdict: '미검증(구별 불가)', causes: [] }),
    outcome: UNDECIDABLE, reason: '주입 뒤 지정 판정이 미확정 또는 미검증',
  },
  { name: '기대 판정이 미검증인 판정을 지정함', run: judgmentRun({ expectedBaseline: '미검증(계약 없음)', baseline: { verdict: '미검증(계약 없음)', witness: true } }), outcome: UNDECIDABLE, reason: '지정 오류: 기대 판정이 미검증인 판정은 지정하지 않는다' },
  { name: '처음부터 미확정', run: judgmentRun({ expectedBaseline: '미확정(관측만)', baseline: { verdict: '미확정(관측만)', witness: true } }), outcome: NOT_APPLICABLE, reason: '기준 기대 판정이 처음부터 미확정' },
];

describe('#13 F6 결과 분류 자체 검사', () => {
  it('분기 사례가 26건이고 네 분류를 모두 덮는다(대상 0건 방지)', () => {
    expect(cases).toHaveLength(26);
    expect(new Set(cases.map((item) => item.outcome))).toEqual(new Set([DETECTED, MISSED, UNDECIDABLE, NOT_APPLICABLE]));
  });

  for (const item of cases) {
    it(`${item.name} → ${item.outcome}`, () => {
      expect(classifyMutation(item.run)).toEqual({ outcome: item.outcome, reason: item.reason });
    });
  }

  it('주입 원인이 비어 있으면 미충족이어도 검출 성공으로 세지 않는다', () => {
    expect(classifyMutation(judgmentRun({ injectedCauses: [] })).outcome).not.toBe(DETECTED);
  });

  it('주입 원인이 여러 개면 모두 출력돼야 검출 성공이다', () => {
    const two = [{ element: 'row:e1', value: 'missing' }, { element: 'row:e2', value: 'missing' }];
    expect(classifyMutation(judgmentRun({ injectedCauses: two }, { causes: [two[0]] })).outcome).toBe(MISSED);
    expect(classifyMutation(judgmentRun({ injectedCauses: two }, { causes: [...two, { element: 'row:e3', value: 'missing' }] })).outcome).toBe(DETECTED);
  });
});

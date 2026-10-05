// #13 O-1 오라클 자체 검사(구현자 작성). 제품 코드를 불러오지 않는다.
// 고정 기대값을 오라클이 재현하는지, README의 "Number 손실 구별·버림 구별" 표기가 실제 계산과 맞는지 확인한다.
// 오라클이 고정값과 다르면 검사기 결함으로 보고하며 고정값을 고쳐 맞추지 않는다(README O-1).
import { describe, expect, it } from 'vitest';
import { formatDecimal, numberPath, parseDecimal, roundDecimal } from './lib/exact-decimal';
import { R1_CASES, R1_EXCLUDED_TIE } from './lib/cases';

describe('#13 O-1 오라클 자체 검사', () => {
  it('사례표가 8건이다(대상 0건 방지)', () => {
    expect(R1_CASES).toHaveLength(8);
  });

  for (const item of R1_CASES) {
    it(`${item.id}: 정확한 계산이 고정 기대 표시를 재현하고 반올림 규칙과 무관하다`, () => {
      if (item.digits === null) {
        expect(item.expected).toBe(item.raw);
        return;
      }
      expect(roundDecimal(item.raw, item.digits, 'half-up')).toBe(item.expected);
      expect(roundDecimal(item.raw, item.digits, 'half-even')).toBe(item.expected);
    });

    it(`${item.id}: Number 경로 값과 "Number 손실 구별" 표기가 실제 계산과 맞다`, () => {
      const viaNumber = numberPath(item.raw, item.digits);
      expect(viaNumber).toBe(item.numberPath);
      expect(viaNumber !== item.expected).toBe(item.numberLoss);
    });

    const digits = item.digits;
    if (item.truncation !== null && digits !== null) {
      it(`${item.id}: 버림 결과와 "버림 구별" 표기가 실제 계산과 맞다`, () => {
        const truncated = roundDecimal(item.raw, digits, 'truncate');
        expect(truncated !== item.expected).toBe(item.truncation);
        if (item.truncation) expect(truncated).toBe(item.truncated);
      });
    }
  }

  it('제외한 동률 사례는 반올림 규칙에 따라 결과가 갈린다', () => {
    expect(roundDecimal(R1_EXCLUDED_TIE.raw, R1_EXCLUDED_TIE.digits, 'half-up')).toBe(R1_EXCLUDED_TIE.halfUp);
    expect(roundDecimal(R1_EXCLUDED_TIE.raw, R1_EXCLUDED_TIE.digits, 'half-even')).toBe(R1_EXCLUDED_TIE.halfEven);
    expect(R1_EXCLUDED_TIE.halfUp).not.toBe(R1_EXCLUDED_TIE.halfEven);
  });

  it('손실 증인: Number 변환은 …993.25를 …994로 바꾸지만 오라클 왕복은 원값을 유지한다', () => {
    const raw = '9007199254740993.25';
    expect(String(BigInt(Number(raw)))).toBe('9007199254740994');
    expect(formatDecimal(parseDecimal(raw))).toBe(raw);
  });

  it('일반 소수 문자열이 아닌 입력을 거절한다', () => {
    for (const bad of ['', '1,000', '1e3', ' 1', '.5', '1.', 'NaN']) expect(() => parseDecimal(bad)).toThrow();
    expect(() => parseDecimal(1.5 as unknown as string)).toThrow(TypeError);
  });
});

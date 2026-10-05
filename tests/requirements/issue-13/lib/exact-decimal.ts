// #13 기준표 O-1 오라클: 10진 문자열을 BigInt로 다루는 정확한 소수 계산.
// Number를 거치지 않는다. 기대값은 cases.ts에 고정 문자열로 적고, 이 모듈은 그 고정값을 재현하는지만 검산한다.

export interface DecimalParts { negative: boolean; units: bigint; scale: number; }
export type RoundingMode = 'half-up' | 'half-even' | 'truncate';

const PLAIN_DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export function parseDecimal(text: string): DecimalParts {
  if (typeof text !== 'string') throw new TypeError('decimal text must be a string');
  const match = PLAIN_DECIMAL.exec(text);
  if (!match) throw new Error(`not a plain decimal string: ${JSON.stringify(text)}`);
  const fraction = match[3] ?? '';
  const units = BigInt(match[2] + fraction);
  return { negative: match[1] === '-' && units !== 0n, units, scale: fraction.length };
}

export function formatDecimal({ negative, units, scale }: DecimalParts): string {
  let digits = units.toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = digits.slice(0, -scale) + '.' + digits.slice(-scale);
  }
  return (negative && units !== 0n ? '-' : '') + digits;
}

/**
 * 정확한 값을 소수 digits자리로 맞춘다. half-up은 0에서 먼 쪽, truncate는 버림(결함 정의용)이다.
 * digits가 원값 자릿수보다 크면 0을 채운다. 0 채움은 기준표에서 미확정이라 고정 사례에는 쓰지 않는다.
 */
export function roundDecimal(text: string, digits: number, mode: RoundingMode): string {
  if (!Number.isInteger(digits) || digits < 0) throw new RangeError('digits must be a non-negative integer');
  const value = parseDecimal(text);
  if (digits >= value.scale) {
    return formatDecimal({ ...value, units: value.units * 10n ** BigInt(digits - value.scale), scale: digits });
  }
  const divisor = 10n ** BigInt(value.scale - digits);
  let quotient = value.units / divisor;
  const twiceRemainder = (value.units % divisor) * 2n;
  if (mode === 'half-up' && twiceRemainder >= divisor) quotient += 1n;
  if (mode === 'half-even' && (twiceRemainder > divisor || (twiceRemainder === divisor && quotient % 2n === 1n))) quotient += 1n;
  return formatDecimal({ negative: value.negative, units: quotient, scale: digits });
}

/** 결함 정의 "Number 경로": 원본 유지(digits === null)는 String(Number(원값)), 그 밖에는 Number(원값).toFixed(digits). */
export function numberPath(text: string, digits: number | null): string {
  return digits === null ? String(Number(text)) : Number(text).toFixed(digits);
}

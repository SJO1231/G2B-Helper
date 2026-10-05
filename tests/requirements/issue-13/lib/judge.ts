// #13 공통 판정 함수. 정상 기준 구현·결함 대체 구현·실제 제품 함수가 같은 함수를 쓴다.
// 판정은 원인 목록을 첫 차이에서 멈추지 않고 모두 돌려준다(README §5 출력 완전성).

export const MET = '충족';
export const UNMET = '미충족';
export const UNVERIFIED = '미검증';
export const NOT_RUN = '미실행';

export interface Difference { path: string; kind: 'type' | 'length' | 'missing-key' | 'extra-key' | 'value'; expected?: unknown; actual?: unknown; }
export interface Judgment {
  verdict: string;
  reason?: string;
  observed?: unknown;
  expected?: unknown;
  cause?: string;
  missing?: string[];
  extra?: string[];
  differences?: Difference[];
}

export function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** 자료형까지 구별하는 깊은 비교. '0'과 0, false와 'false', null과 누락 키를 다르게 본다. */
export function diffValues(expected: unknown, actual: unknown, path = '$', out: Difference[] = []): Difference[] {
  const expectedType = typeName(expected);
  const actualType = typeName(actual);
  if (expectedType !== actualType) {
    out.push({ path, kind: 'type', expected: expectedType, actual: actualType });
    return out;
  }
  if (expectedType === 'array') {
    const left = expected as unknown[];
    const right = actual as unknown[];
    if (left.length !== right.length) out.push({ path, kind: 'length', expected: left.length, actual: right.length });
    const shared = Math.min(left.length, right.length);
    for (let index = 0; index < shared; index += 1) diffValues(left[index], right[index], `${path}[${index}]`, out);
    return out;
  }
  if (expectedType === 'object') {
    const left = expected as Record<string, unknown>;
    const right = actual as Record<string, unknown>;
    for (const key of Object.keys(left)) {
      const child = `${path}[${JSON.stringify(key)}]`;
      if (!Object.hasOwn(right, key)) out.push({ path: child, kind: 'missing-key' });
      else diffValues(left[key], right[key], child, out);
    }
    for (const key of Object.keys(right)) {
      if (!Object.hasOwn(left, key)) out.push({ path: `${path}[${JSON.stringify(key)}]`, kind: 'extra-key' });
    }
    return out;
  }
  if (!Object.is(expected, actual)) out.push({ path, kind: 'value', expected, actual });
  return out;
}

/** 원값 보존 판정(A4·R1-e·R2-d·P4). 관측하지 못했으면 통과가 아니라 미검증이다. */
export function judgePreservation(expected: unknown, actual: unknown, options: { observed?: boolean } = {}): Judgment {
  if (options.observed === false) return { verdict: UNVERIFIED, reason: '관측 불가' };
  const differences = diffValues(expected, actual);
  return { verdict: differences.length ? UNMET : MET, differences };
}

/** R1·P1 표시 판정. 천 단위 쉼표만 제거해 고정 기대 문자열과 비교한다. */
export function judgeDisplay(caseDefinition: { expected: string }, displayed: unknown): Judgment {
  if (typeof displayed !== 'string') return { verdict: UNVERIFIED, reason: '관측값 없음', observed: displayed };
  const normalized = displayed.replaceAll(',', '');
  if (normalized === caseDefinition.expected) return { verdict: MET, observed: displayed };
  return { verdict: UNMET, observed: displayed, expected: caseDefinition.expected, cause: 'display-mismatch' };
}

export function countIds(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** 표시 행 다중집합 판정(R2·P2). 빠진 행과 남는 행을 모두 돌려준다. */
export function judgeRowMultiset(expectedIds: readonly string[], actualIds: readonly string[] | undefined): Judgment {
  if (!Array.isArray(actualIds)) return { verdict: UNVERIFIED, reason: '관측값 없음' };
  const expected = countIds(expectedIds);
  const actual = countIds(actualIds);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [id, count] of expected) for (let n = actual.get(id) ?? 0; n < count; n += 1) missing.push(id);
  for (const [id, count] of actual) for (let n = expected.get(id) ?? 0; n < count; n += 1) extra.push(id);
  return { verdict: missing.length || extra.length ? UNMET : MET, missing, extra, observed: [...actualIds] };
}

export interface SearchFilterObservations { search?: readonly string[]; searchAndFilter?: readonly string[]; cleared?: readonly string[]; }

/** D2 검색·적용·해제 판정. R2-0(검색 전제)이 충족이 아니면 적용·해제는 미검증(검색 전제 불성립)이다. */
export function judgeSearchFilterClear(
  sets: { all: readonly string[]; b: readonly string[]; bv: readonly string[] },
  observations: SearchFilterObservations,
): { premise: Judgment; apply: Judgment; clear: Judgment } {
  const witness = sets.b.length >= 2 && sets.bv.length > 0 && sets.bv.length < sets.b.length && sets.b.length < sets.all.length;
  if (!witness) {
    const reason = '증인 불성립(|B|≥2, 0<|BV|<|B|<|A| 아님)';
    return { premise: { verdict: UNVERIFIED, reason }, apply: { verdict: UNVERIFIED, reason }, clear: { verdict: UNVERIFIED, reason } };
  }
  const premise = judgeRowMultiset(sets.b, observations.search);
  if (premise.verdict !== MET) {
    const reason = '검색 전제 불성립';
    return { premise, apply: { verdict: UNVERIFIED, reason }, clear: { verdict: UNVERIFIED, reason } };
  }
  return { premise, apply: judgeRowMultiset(sets.bv, observations.searchAndFilter), clear: judgeRowMultiset(sets.b, observations.cleared) };
}

/** 판정 결과 집계. 대상 0건·미검증·미실행은 충족으로 세지 않는다. overall은 1건 이상이고 모두 충족일 때만 충족이다. */
export function summarize(results: readonly { verdict: string }[]): { total: number; counts: Record<string, number>; overall: string } {
  const counts: Record<string, number> = { [MET]: 0, [UNMET]: 0, [UNVERIFIED]: 0, [NOT_RUN]: 0, other: 0 };
  for (const result of results) {
    if (result.verdict !== 'other' && Object.hasOwn(counts, result.verdict)) counts[result.verdict] += 1;
    else counts.other += 1;
  }
  let overall: string = MET;
  if (results.length === 0) overall = `${UNVERIFIED}(대상 0건)`;
  else if (counts[UNMET] > 0) overall = UNMET;
  else if (counts[MET] !== results.length) overall = `${UNVERIFIED}(충족 아닌 결과 포함)`;
  return { total: results.length, counts, overall };
}

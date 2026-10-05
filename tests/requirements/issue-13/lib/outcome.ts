// #13 README §5(v3.1.3) 결함 주입 결과 분류. 순수 함수이며 브라우저·제품 코드를 쓰지 않는다.
// 분류는 주입 증거 → 기준 실행 → 주입 사본 관측 → 지정 판정·보고 출력과 원인 대조 순서로 정한다.
import { MET, UNMET } from './judge';

export const DETECTED = '검출 성공';
export const MISSED = '검출 실패';
export const UNDECIDABLE = '판정 불가';
export const NOT_APPLICABLE = '판정 대상 아님';

export const CONDITIONAL = '조건부';
export const UNDETERMINED = '미확정';

/** 원인 식별자: 같은 요소(element)와, 적힌 경우 같은 값(value)이어야 같은 원인이다. */
export interface Cause { element: string; value?: string; }

export interface InjectionEvidence {
  /** 표식 블록을 정확히 1개 찾았는지 */
  markerFound: boolean;
  beforeSha256: string;
  afterSha256: string;
}

export interface MutationRun {
  id: string;
  /** 'judgment'는 제품 판정, 'report'는 R4-c·A1-u 같은 보고 검사 */
  kind: 'judgment' | 'report';
  designated: string;
  /** 정상 fixture에서 지정 판정의 사례별 기대 판정(judgment). report는 무시 */
  expectedBaseline?: string;
  /** 보고 검사의 고정 기대 출력(report) */
  expectedReport?: string[];
  injection: InjectionEvidence;
  /** 같은 실행 조건의 정상 fixture 결과 */
  baseline: { verdict?: string; report?: string[]; witness: boolean };
  /** 주입 사본 결과 */
  mutated: {
    /** 화면이 열리고 지정 판정의 관측 대상을 읽었는지 */
    observed: boolean;
    /** 관측 대상 수(요소·행·목록). 0이면 대상 0건 */
    targets: number;
    verdict?: string;
    causes?: Cause[];
    report?: string[];
    /** 원인 목록(또는 보고 목록)을 끝까지 출력했는지 */
    outputComplete: boolean;
    /** 지정 판정 밖에서 실패한 판정 ID */
    otherFailures?: string[];
  };
  /** 주입한 결함이 만들어야 하는 원인. 모두 출력돼야 검출 성공이다 */
  injectedCauses: Cause[];
}

export interface Outcome { outcome: string; reason: string; }

const sameCause = (expected: Cause, actual: Cause): boolean =>
  expected.element === actual.element && (expected.value === undefined || expected.value === actual.value);
const includesAll = (expected: readonly Cause[], actual: readonly Cause[]): boolean =>
  expected.length > 0 && expected.every((cause) => actual.some((candidate) => sameCause(cause, candidate)));
const sameMultiset = (left: readonly string[] = [], right: readonly string[] = []): boolean =>
  left.length === right.length && [...left].sort().join('\u0000') === [...right].sort().join('\u0000');
const isUnverified = (verdict: string | undefined): boolean => typeof verdict === 'string' && verdict.startsWith('미검증');
const isUndetermined = (verdict: string | undefined): boolean => typeof verdict === 'string' && verdict.startsWith(UNDETERMINED);
const isConditional = (verdict: string | undefined): boolean => typeof verdict === 'string' && verdict.startsWith(CONDITIONAL);
/** '미충족(부재)'처럼 사유가 붙은 값도 같은 판정으로 본다. '미충족'은 '충족'으로 시작하지 않는다. */
const isUnmet = (verdict: string | undefined): boolean => typeof verdict === 'string' && verdict.startsWith(UNMET);
const isMet = (verdict: string | undefined): boolean => typeof verdict === 'string' && verdict.startsWith(MET);

export function classifyMutation(run: MutationRun): Outcome {
  // 처음부터 미확정(관측만)인 판정에는 주입을 만들지 않는다.
  if (run.kind === 'judgment' && isUndetermined(run.expectedBaseline)) return { outcome: NOT_APPLICABLE, reason: '기준 기대 판정이 처음부터 미확정' };
  if (run.kind === 'judgment' && isUnverified(run.expectedBaseline)) return { outcome: UNDECIDABLE, reason: '지정 오류: 기대 판정이 미검증인 판정은 지정하지 않는다' };

  // (가) 주입 적용 증거
  const { injection } = run;
  if (!injection.markerFound || injection.beforeSha256 === injection.afterSha256) return { outcome: UNDECIDABLE, reason: '(가) 주입 미적용' };

  // (나) 기준 실행: 사례별 기대 판정 또는 고정 기대 보고와 일치하고 증인이 성립해야 한다.
  if (!run.baseline.witness) return { outcome: UNDECIDABLE, reason: '(나) 기준 실행 증인 불성립' };
  if (run.kind === 'judgment' && run.baseline.verdict !== run.expectedBaseline) return { outcome: UNDECIDABLE, reason: '(나) 기준 실행 판정이 사례별 기대 판정과 다름' };
  if (run.kind === 'report' && !sameMultiset(run.baseline.report, run.expectedReport)) return { outcome: UNDECIDABLE, reason: '(나) 기준 실행 보고가 고정 기대 출력과 다름' };

  // (다) 주입 사본 관측
  const { mutated } = run;
  if (!mutated.observed) return { outcome: UNDECIDABLE, reason: '(다) 관측 실패' };
  if (mutated.targets <= 0) return { outcome: UNDECIDABLE, reason: '(다) 대상 0건' };

  if (run.kind === 'report') {
    const listed = (mutated.report ?? []).map((element) => ({ element }));
    if (includesAll(run.injectedCauses, listed)) return { outcome: DETECTED, reason: '보고 목록에 주입 항목이 나옴' };
    if (!mutated.outputComplete) return { outcome: UNDECIDABLE, reason: '보고 출력 불완전' };
    return { outcome: MISSED, reason: '② 정상 출력된 보고 목록에 주입 항목이 없음' };
  }

  const verdict = mutated.verdict;
  if (isUndetermined(verdict) || isUnverified(verdict)) return { outcome: UNDECIDABLE, reason: '주입 뒤 지정 판정이 미확정 또는 미검증' };
  if (isUnmet(verdict)) {
    if (includesAll(run.injectedCauses, mutated.causes ?? [])) return { outcome: DETECTED, reason: '지정 판정 미충족, 원인이 주입 결함과 일치' };
    if (!mutated.outputComplete) return { outcome: UNDECIDABLE, reason: '원인 목록 출력 불완전' };
    return { outcome: MISSED, reason: '③ 지정 판정 미충족이지만 원인이 주입 결함과 다름' };
  }
  if (isMet(verdict)) {
    return mutated.otherFailures?.length
      ? { outcome: MISSED, reason: '④ 다른 판정만 실패, 지정 판정은 충족' }
      : { outcome: MISSED, reason: '① 지정 판정이 충족' };
  }
  if (isConditional(verdict)) {
    return isConditional(run.expectedBaseline)
      ? { outcome: MISSED, reason: '⑤ 주입 뒤에도 조건부로 남음' }
      : { outcome: MISSED, reason: '미충족 전환 실패: 충족 기대 판정이 주입 뒤 조건부' };
  }
  return { outcome: UNDECIDABLE, reason: `알 수 없는 판정 값: ${String(verdict)}` };
}

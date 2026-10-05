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
  /** 주입 어댑터가 읽은 지정 표식의 실제 전후 블록 문자. 없으면 증거 미제공이다. */
  blockDiff?: { marker: string; before: string; after: string };
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
    /** 읽은 대상·영역 수(양의 정수). 제거된 버튼 수나 빈 검색 결과의 행 수가 아니다. */
    targets: number;
    verdict?: string;
    causes?: Cause[];
    report?: string[];
    /** M-R2-7/R2-0 전제 확인에서 실제로 읽은 검색 결과 B. 누락과 공집합을 구별한다. */
    searchRows?: string[];
    /** 원인 목록(또는 보고 목록)을 끝까지 출력했는지 */
    outputComplete: boolean;
    /** 지정 판정 밖에서 실패한 판정 ID */
    otherFailures?: string[];
  };
  /** 주입한 결함이 만들어야 하는 원인. 모두 출력돼야 검출 성공이다 */
  injectedCauses: Cause[];
}

export interface Outcome { outcome: string; reason: string; outputComplete: boolean | undefined; }

const sameCause = (expected: Cause, actual: Cause): boolean =>
  expected.element === actual.element && (expected.value === undefined || expected.value === actual.value);
const includesAll = (expected: readonly Cause[], actual: readonly Cause[]): boolean =>
  expected.length > 0 && expected.every((cause) => actual.some((candidate) => sameCause(cause, candidate)));
const stringList = (value: unknown): value is string[] => Array.isArray(value) && [...value].every((item) => typeof item === 'string');
const causeList = (value: unknown): value is Cause[] => Array.isArray(value) && [...value].every((item) =>
  item !== null && typeof item === 'object' && typeof item.element === 'string' && item.element.trim().length > 0 &&
  (item.value === undefined || typeof item.value === 'string'));
const sameMultiset = (left: readonly string[], right: readonly string[]): boolean => {
  const sortedRight = [...right].sort();
  return left.length === right.length && [...left].sort().every((item, index) => item === sortedRight[index]);
};
/** 정확한 상태 또는 비어 있지 않은 괄호 사유만 허용한다. 접두어 오타는 판정이 아니다. */
const verdictState = (verdict: unknown): string | undefined => {
  const match = typeof verdict === 'string' ? /^(충족|미충족|미검증|조건부|미확정)(?:\(([^()\r\n]+)\))?$/.exec(verdict) : null;
  return match && (match[2] === undefined || match[2].trim().length > 0) ? match[1] : undefined;
};

export function classifyMutation(run: MutationRun): Outcome {
  const outputComplete = typeof run?.mutated?.outputComplete === 'boolean' ? run.mutated.outputComplete : undefined;
  const result = (outcome: string, reason: string): Outcome => ({ outcome, reason, outputComplete });
  if (!run || (run.kind !== 'judgment' && run.kind !== 'report')) return result(UNDECIDABLE, '검사 종류 누락 또는 오류');
  const expectedState = verdictState(run.expectedBaseline);
  // 처음부터 미확정(관측만)인 판정에는 주입을 만들지 않는다.
  if (run.kind === 'judgment' && expectedState === UNDETERMINED) return result(NOT_APPLICABLE, '기준 기대 판정이 처음부터 미확정');
  if (run.kind === 'judgment' && expectedState === '미검증') return result(UNDECIDABLE, '지정 오류: 기대 판정이 미검증인 판정은 지정하지 않는다');
  if (run.kind === 'judgment' && expectedState !== MET && expectedState !== CONDITIONAL) return result(UNDECIDABLE, '(나) 유효한 기준 기대 판정 없음');

  // (가) 주입 적용 증거
  const { injection } = run;
  if (!injection || typeof injection.markerFound !== 'boolean' ||
      typeof injection.beforeSha256 !== 'string' || !/^[a-f\d]{64}$/i.test(injection.beforeSha256) ||
      typeof injection.afterSha256 !== 'string' || !/^[a-f\d]{64}$/i.test(injection.afterSha256)) return result(UNDECIDABLE, '(가) 주입 증거 형식 오류');
  if (!injection.markerFound || injection.beforeSha256.toLowerCase() === injection.afterSha256.toLowerCase()) return result(UNDECIDABLE, '(가) 주입 미적용');
  const diff = injection.blockDiff;
  if (!diff || typeof diff.marker !== 'string' || !diff.marker.trim() || typeof diff.before !== 'string' || typeof diff.after !== 'string' || diff.before === diff.after) return result(UNDECIDABLE, '(가) 표식 블록 diff 미확인');
  // 형식과 전후 문자 변화 확인은 실제 단일 표식 교체·전체 사본 hash·인과의 독립 대조를 대신하지 않는다.

  // (나) 기준 실행: 사례별 기대 판정 또는 고정 기대 보고와 일치하고 증인이 성립해야 한다.
  if (run.baseline?.witness !== true) return result(UNDECIDABLE, '(나) 기준 실행 증인 불성립');
  if (run.kind === 'judgment' && run.baseline.verdict !== run.expectedBaseline) return result(UNDECIDABLE, '(나) 기준 실행 판정이 사례별 기대 판정과 다름');
  if (run.kind === 'report' && (!stringList(run.baseline.report) || !stringList(run.expectedReport))) return result(UNDECIDABLE, '(나) 기준 보고 또는 기대 출력 미제공');
  if (run.kind === 'report' && !sameMultiset(run.baseline.report!, run.expectedReport!)) return result(UNDECIDABLE, '(나) 기준 실행 보고가 고정 기대 출력과 다름');

  // (다) 주입 사본 관측
  const { mutated } = run;
  if (mutated?.observed !== true) return result(UNDECIDABLE, '(다) 관측 실패');
  if (!Number.isInteger(mutated.targets) || mutated.targets < 0) return result(UNDECIDABLE, '(다) 관측 대상 수 오류');
  if (mutated.targets === 0) return result(UNDECIDABLE, '(다) 대상 0건');
  if (outputComplete === undefined) return result(UNDECIDABLE, '출력 완전성 미제공');
  if (!causeList(run.injectedCauses) || run.injectedCauses.length === 0) return result(UNDECIDABLE, '주입 원인 미제공 또는 오류');

  if (run.kind === 'report') {
    if (!stringList(mutated.report)) return result(UNDECIDABLE, '보고 목록 미출력');
    const listed = mutated.report.map((element) => ({ element }));
    if (includesAll(run.injectedCauses, listed)) return result(DETECTED, '보고 목록에 주입 항목이 나옴');
    if (!mutated.outputComplete) return result(UNDECIDABLE, '보고 출력 불완전');
    return result(MISSED, '② 정상 출력된 보고 목록에 주입 항목이 없음');
  }

  const state = verdictState(mutated.verdict);
  // §5의 전제 예외만 인정: 정상 R2-0 충족 + 관측 B 공집합 + 같은 공집합 원인.
  if (run.id === 'M-R2-7' && run.designated === 'R2-0' && expectedState === MET &&
      mutated.verdict === '미검증(증인 불성립)' && stringList(mutated.searchRows) && mutated.searchRows.length === 0 &&
      run.injectedCauses.some((cause) => cause.element === 'search-result:B' && cause.value === '[]') &&
      causeList(mutated.causes) && includesAll(run.injectedCauses, mutated.causes)) return result(DETECTED, 'R2-0 정상 전제 성립, 주입 뒤 관측 B 공집합과 원인 일치');
  if (state === UNDETERMINED || state === '미검증') return result(UNDECIDABLE, '주입 뒤 지정 판정이 미확정 또는 미검증');
  if (state === UNMET) {
    if (!causeList(mutated.causes)) return result(UNDECIDABLE, '원인 목록 미출력 또는 오류');
    if (includesAll(run.injectedCauses, mutated.causes)) return result(DETECTED, '지정 판정 미충족, 원인이 주입 결함과 일치');
    if (!mutated.outputComplete) return result(UNDECIDABLE, '원인 목록 출력 불완전');
    return result(MISSED, '③ 지정 판정 미충족이지만 원인이 주입 결함과 다름');
  }
  if (state === MET) {
    return mutated.otherFailures?.length
      ? result(MISSED, '④ 다른 판정만 실패, 지정 판정은 충족')
      : result(MISSED, '① 지정 판정이 충족');
  }
  if (state === CONDITIONAL) {
    return expectedState === CONDITIONAL
      ? result(MISSED, '⑤ 주입 뒤에도 조건부로 남음')
      : result(MISSED, '미충족 전환 실패: 충족 기대 판정이 주입 뒤 조건부');
  }
  return result(UNDECIDABLE, `알 수 없는 판정 값: ${String(mutated.verdict)}`);
}

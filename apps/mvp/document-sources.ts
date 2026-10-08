import type { ExtractionView, JsonRow, ProcurementObservation } from './contracts';

const identityKeys = { receipt: ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd'], bid: ['bidPbancNo', 'bidPbancOrd'], contract: ['ctrtNo', 'ctrtChgOrd'] };
const present = (value: unknown): boolean => value !== undefined && value !== null && !(typeof value === 'string' && !value.trim());

/**
 * Documents are made from collected DB records only (user, 2026-10-09, #42): a selected row of a collection target
 * becomes its record, which is collected first; rows of other screens and of files opened as JSON are not output.
 */
export type OutputSource = { kind: 'record'; observation: ProcurementObservation } | { kind: 'blocked'; reason: string };

export function extractionSources(selected: { sourceIndex: number; row: JsonRow }[], view: ExtractionView, observations: ProcurementObservation[], screen: 'collection' | 'other' | 'file'): OutputSource[] {
  const frame = observations.filter(observation => observation.source.framePath === view.source?.framePath);
  return selected.map(({ row }): OutputSource => {
    if (screen === 'file') return { kind: 'blocked', reason: '파일로 연 자료는 보기 전용입니다. 문서는 수집된 DB 자료로만 만듭니다.' };
    if (!frame.length) return { kind: 'blocked', reason: screen === 'collection' ? '수집 대상 화면이지만 업무번호와 차수를 읽지 못해 수집할 수 없습니다. 화면을 다시 연 뒤 생성하세요.' : '수집 대상 화면이 아니어서 문서를 만들 수 없습니다. 문서는 수집된 DB 자료로만 만듭니다.' };
    const keys = identityKeys[frame[0].stage], identity = keys.map(key => row[key]);
    const observation = identity.every(present) ? frame.find(entry => entry.identity.every((value, index) => value === String(identity[index]))) : frame.length === 1 ? frame[0] : undefined;
    return observation ? { kind: 'record', observation } : { kind: 'blocked', reason: '이 행의 업무번호와 차수를 화면 자료에서 찾지 못해 수집할 수 없습니다.' };
  });
}

/** Several selected rows of one record (a detail screen) are one record. */
export function recordSources(sources: OutputSource[]): ProcurementObservation[] {
  const records = new Map<string, ProcurementObservation>();
  for (const source of sources) {
    if (source.kind !== 'record') continue;
    const key = JSON.stringify([source.observation.stage, source.observation.identity]);
    if (!records.has(key)) records.set(key, source.observation);
  }
  return [...records.values()];
}

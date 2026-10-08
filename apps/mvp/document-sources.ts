import type { ExtractionView, JsonRow, ProcurementObservation } from './contracts';

const identityKeys = { receipt: ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd'], bid: ['bidPbancNo', 'bidPbancOrd'], contract: ['ctrtNo', 'ctrtChgOrd'] };
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const present = (value: unknown): boolean => value !== undefined && value !== null && !(typeof value === 'string' && !value.trim());

/**
 * Where a selected G2B screen row gets its output values (user, 2026-10-08, #24):
 * a collection target is compared with the DB and saved; other extracted rows are output only.
 */
export type OutputSource =
  | { kind: 'record'; observation: ProcurementObservation; edits?: JsonRow }
  | { kind: 'output'; row: JsonRow; screen?: JsonRow }
  | { kind: 'blocked'; reason: string };

/**
 * `pristine` is the extracted table as read from the screen, aligned with the grid's source indices when known.
 * An edit counts toward a record only where the screen row held that record's own value.
 */
export function extractionSources(selected: { sourceIndex: number; row: JsonRow }[], view: ExtractionView, observations: ProcurementObservation[], pristine: JsonRow[] | undefined, collection: boolean): OutputSource[] {
  const frame = observations.filter(observation => observation.source.framePath === view.source?.framePath);
  return selected.map(({ sourceIndex, row }): OutputSource => {
    const screen = pristine?.[sourceIndex];
    if (!frame.length) {
      if (collection) return { kind: 'blocked', reason: '수집 대상 화면이지만 업무번호와 차수를 읽지 못해 저장할 수 없습니다. 화면을 다시 연 뒤 생성하세요.' };
      return { kind: 'output', row, ...(screen && !same(screen, row) ? { screen } : {}) };
    }
    const keys = identityKeys[frame[0].stage], identity = keys.map(key => row[key]);
    const observation = identity.every(present) ? frame.find(entry => entry.identity.every((value, index) => value === String(identity[index]))) : frame.length === 1 ? frame[0] : undefined;
    if (!observation) return { kind: 'blocked', reason: '이 행의 업무번호와 차수를 화면 자료에서 찾지 못해 저장할 수 없습니다.' };
    const base = screen || observation.fields;
    const edits = Object.fromEntries(Object.keys(observation.fields)
      .filter(key => !keys.includes(key) && Object.hasOwn(row, key) && !same(row[key], base[key]) && same(base[key], observation.fields[key]))
      .map(key => [key, row[key]]));
    return { kind: 'record', observation, ...(Object.keys(edits).length ? { edits } : {}) };
  });
}

/** Several selected rows of one record (a detail screen) become one item; their edits must agree. */
export function recordSources(sources: OutputSource[]): { observation: ProcurementObservation; edits?: JsonRow }[] {
  const records = new Map<string, { observation: ProcurementObservation; edits?: JsonRow }>();
  for (const source of sources) {
    if (source.kind !== 'record') continue;
    const key = JSON.stringify([source.observation.stage, source.observation.identity]), current = records.get(key);
    if (!current) { records.set(key, { observation: source.observation, ...(source.edits ? { edits: { ...source.edits } } : {}) }); continue; }
    for (const [field, value] of Object.entries(source.edits || {})) {
      if (current.edits && Object.hasOwn(current.edits, field) && !same(current.edits[field], value)) throw new Error('같은 업무 자료의 여러 행에서 같은 값을 다르게 고쳤습니다: ' + field);
      current.edits = { ...current.edits, [field]: value };
    }
  }
  return [...records.values()];
}

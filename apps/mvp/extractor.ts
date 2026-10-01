import { approvedScreenProfiles } from '../../plugins/collector/scope';
import type { CaptureScreenRule, ExtractionResult, ExtractionView, JsonRow, MvpSettings, NestedDataset, ProcurementObservation, ProcurementStage } from './contracts';

type Profile = typeof approvedScreenProfiles[number];
interface Unit { framePath: string; url: string; pointInfo: JsonRow; tables: Record<string, JsonRow[]>; warnings: string[]; valid: boolean; original: unknown; }
const object = (value: unknown): value is JsonRow => value !== null && typeof value === 'object' && !Array.isArray(value);
const present = (value: unknown): boolean => value !== undefined && value !== null && !(typeof value === 'string' && !value.trim());
const identityValue = (value: unknown): boolean => present(value) && (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
const complete = (row: JsonRow, profile: Profile): boolean => profile.identityFields.every(key => Object.hasOwn(row, key) && identityValue(row[key]));
const identity = (row: JsonRow, profile: Profile): string[] => profile.identityFields.map(key => String(row[key]));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const stable = (value: unknown): string => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value) ?? 'undefined';
const sameIdentity = (row: JsonRow, target: string[], profile: Profile): boolean => profile.identityFields.every((key, i) => !present(row[key]) || String(row[key]) === target[i]);
const conflict = (a: JsonRow, b: JsonRow): boolean => Object.keys(a).some(key => Object.hasOwn(b, key) && present(a[key]) && present(b[key]) && stable(a[key]) !== stable(b[key]));

/** Explicit defaults for the settings editor; an omitted policy retains the legacy gate. */
export const defaultScreenRules: CaptureScreenRule[] = approvedScreenProfiles.flatMap(profile => profile.depth2.flatMap(depth2 => {
  const depths: (string | undefined)[] = profile.stage === 'bid' ? ['01175', '01179'] : profile.stage === 'contract' ? ['01572', '01579'] : [undefined];
  return depths.map(depth3 => ({ id: [profile.stage, depth2, depth3].filter(Boolean).join('-'), stage: profile.stage, urlPattern: '*', areaCd: profile.areaCd, depth1: profile.depth1, depth2, ...(depth3 ? { depth3 } : {}) }));
}));

function ruleMatches(rule: CaptureScreenRule, unit: Unit): boolean {
  if (!rule || !approvedScreenProfiles.some(profile => profile.stage === rule.stage) || !['urlPattern', 'areaCd', 'depth1', 'depth2'].every(key => typeof rule[key as keyof CaptureScreenRule] === 'string' && String(rule[key as keyof CaptureScreenRule]).trim())) return false;
  if (rule.depth3 !== undefined && typeof rule.depth3 !== 'string') return false;
  const pattern = rule.urlPattern;
  // A plain URL is a prefix; only * has wildcard meaning, never regular expressions.
  const urlMatches = pattern.includes('*') ? new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's').test(unit.url) : unit.url.startsWith(pattern);
  return urlMatches && unit.pointInfo.areaCd === rule.areaCd && unit.pointInfo.depth1 === rule.depth1 && unit.pointInfo.depth2 === rule.depth2 && (!rule.depth3?.trim() || unit.pointInfo.depth3 === rule.depth3);
}

function units(raw: unknown, sourceUrl: string | undefined, warnings: string[]): Unit[] {
  if (!object(raw)) throw new Error('추출 JSON은 pointInfo와 tables를 포함한 객체여야 합니다.');
  const parse = (source: unknown, fallbackPath: string, fallbackUrl?: string): Unit => {
    if (!object(source)) throw new Error('frame은 JSON 객체여야 합니다.');
    const framePath = typeof source.framePath === 'string' && source.framePath ? source.framePath : fallbackPath;
    const localWarnings = Array.isArray(source.warnings) ? source.warnings.filter((entry): entry is string => typeof entry === 'string') : [];
    let valid = object(source.pointInfo) && object(source.tables);
    if (!valid) localWarnings.push('pointInfo/tables 형식이 올바르지 않아 수집하지 않습니다.');
    const pointInfo = object(source.pointInfo) ? source.pointInfo : {};
    const tables: Record<string, JsonRow[]> = Object.create(null);
    if (object(source.tables)) for (const [key, rows] of Object.entries(source.tables)) {
      if (!Array.isArray(rows) || !rows.every(object)) {
        valid = false;
        localWarnings.push(key + ': 표는 JSON 객체 행의 배열이어야 합니다. 원본에서 확인하세요.');
        continue;
      }
      tables[key] = rows;
    }
    // An explicit frame URL never borrows the page URL or another frame's URL.
    const url = Object.hasOwn(source, 'url') ? typeof source.url === 'string' ? source.url : '' : fallbackUrl ?? '';
    warnings.push(...localWarnings.map(message => '[' + framePath + '] ' + message));
    return { framePath, url, pointInfo, tables, warnings: localWarnings, valid, original: source };
  };
  if (Object.hasOwn(raw, 'frames')) {
    if (!Array.isArray(raw.frames)) throw new Error('frames는 배열이어야 합니다.');
    if (raw.frames.length) return raw.frames.map((frame, index) => parse(frame, 'frame:' + index));
  }
  if (!object(raw.pointInfo) || !object(raw.tables)) throw new Error('추출 JSON의 pointInfo/tables 형식을 확인하세요.');
  return [parse(raw, 'top', sourceUrl)];
}

function structuralStage(unit: Unit): ProcurementStage | undefined {
  const fromScreen = approvedScreenProfiles.find(profile => profile.depth2.some(depth => depth === unit.pointInfo.depth2) && unit.pointInfo.areaCd === profile.areaCd && unit.pointInfo.depth1 === profile.depth1);
  if (fromScreen) return fromScreen.stage;
  const rows = [unit.pointInfo, ...Object.values(unit.tables).flat()];
  const matches = approvedScreenProfiles.filter(profile => rows.some(row => complete(row, profile)));
  return matches.length === 1 ? matches[0].stage : undefined;
}

function approvedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && (url.hostname === 'g2b.go.kr' || url.hostname.endsWith('.g2b.go.kr'));
  } catch { return false; }
}

function datasetKind(key: string, rows: JsonRow[], stage: ProcurementStage): NestedDataset['kind'] {
  const fields = new Set(rows.flatMap(row => Object.keys(row)));
  const itemField = stage === 'receipt' ? 'ctrtDmndRcptItemSqno' : stage === 'bid' ? 'bidPbancItemSqno' : 'ctrtItemSqno';
  if (fields.has(itemField) || (stage === 'receipt' && /(?:gvDmndItem|gridView(?:Excel)?)$/.test(key)) || (stage === 'bid' && /grdAliasDmTtl01List$/.test(key)) || (stage === 'contract' && /grdCtrtLis(?:Excel)?$/.test(key))) return 'items';
  if (stage === 'bid' && (fields.has('lmtSqno') || fields.has('bidLmtSeCd') || /(?:grdAliasDmTtl07(?:Left|Right)List|grdBidPrcLmtMfrcFld|grdAliasDmTtl10List)$/.test(key) || /^(?:qualification|qualifications)$/.test(key))) return 'qualification';
  return 'other';
}

function isContent(key: string): boolean { return /grdAliasDmTtl06List$/.test(key) || /^(?:content|contents)$/.test(key); }

function observe(unit: Unit, warnings: string[], capturedAt: string, screenRules?: CaptureScreenRule[]): ProcurementObservation[] {
  const prefix = '[' + unit.framePath + '] ';
  const reject = (reason: string): ProcurementObservation[] => { warnings.push(prefix + reason); return []; };
  if (!approvedUrl(unit.url)) return reject(unit.url ? '지정 G2B HTTP/HTTPS URL이 아니므로 수집하지 않습니다.' : 'URL을 확인할 수 없는 자료입니다. 구조 추출만 가능하며 수집하지 않습니다.');
  const matchingRules = screenRules?.filter(rule => ruleMatches(rule, unit));
  const stages = new Set(matchingRules?.map(rule => rule.stage));
  if (stages.size > 1) return reject('화면 규칙이 서로 다른 업무에 일치하여 수집하지 않습니다.');
  const profile = screenRules === undefined ? approvedScreenProfiles.find(entry => entry.depth2.some(depth => depth === unit.pointInfo.depth2) && unit.pointInfo.areaCd === entry.areaCd && unit.pointInfo.depth1 === entry.depth1) : approvedScreenProfiles.find(entry => stages.has(entry.stage));
  if (!profile) return reject('지정 areaCd/depth1/depth2 화면 규칙이 아니므로 추출만 가능합니다.');
  if (!unit.valid || unit.warnings.length) return reject('frame 읽기/형식 오류가 있어 수집하지 않습니다.');
  for (const key of ['areaCd', 'depth1', 'depth2', 'depth3', ...profile.identityFields]) {
    if (Object.keys(unit.pointInfo).some(candidate => candidate.startsWith(key + '#') && stable(unit.pointInfo[candidate]) !== stable(unit.pointInfo[key]))) return reject('중복 화면 참조값이 모호하여 수집하지 않습니다.');
  }
  const depth3 = unit.pointInfo.depth3;
  const approvedDepth3 = profile.stage === 'bid' ? ['01175', '01179'] : profile.stage === 'contract' ? ['01572', '01579'] : [];
  if (present(depth3) && (!identityValue(depth3) || (screenRules === undefined && profile.stage !== 'receipt' && !approvedDepth3.includes(String(depth3))))) return reject('확인되지 않은 depth3 화면이므로 수집하지 않습니다.');
  const entries = Object.entries(unit.tables).map(([key, rows]) => ({ key, rows, kind: datasetKind(key, rows, profile.stage) }));
  const allRows = entries.flatMap(entry => entry.rows);
  const pointComplete = complete(unit.pointInfo, profile);
  const detail = pointComplete || depth3 === '01179' || depth3 === '01579' || profile.stage === 'receipt';
  const candidates = pointComplete ? [unit.pointInfo] : detail ? [
    ...entries.filter(entry => isContent(entry.key)).flatMap(entry => entry.rows).filter(row => complete(row, profile)),
    ...allRows.filter(row => complete(row, profile))
  ] : entries.filter(entry => entry.kind === 'other').flatMap(entry => entry.rows).filter(row => complete(row, profile));
  if (!candidates.length) return reject('업무번호와 차수가 완전하지 않아 수집하지 않습니다.');
  const parents = new Map<string, JsonRow>();
  for (const row of candidates) {
    const id = identity(row, profile), encoded = JSON.stringify(id);
    if (!sameIdentity(unit.pointInfo, id, profile)) return reject('화면과 표의 업무 식별값이 충돌하여 수집하지 않습니다.');
    const previous = parents.get(encoded);
    // Child rows may share a parent key and still have different item/contact values.
    if (!detail && previous && conflict(previous, row)) return reject('동일 업무 목록 행의 값이 충돌하여 수집하지 않습니다.');
    if (!previous) parents.set(encoded, detail ? Object.fromEntries(profile.identityFields.map(key => [key, row[key]])) : row);
  }
  if (detail && parents.size !== 1) return reject('상세 frame에 서로 다른 업무 식별값이 있어 수집하지 않습니다.');
  if (detail && allRows.some(row => !sameIdentity(row, identity(candidates[0], profile), profile))) return reject('상세 화면의 표 업무 식별값이 충돌하여 수집하지 않습니다.');
  if (!detail && entries.some(entry => entry.rows.some(row => !complete(row, profile)))) return reject('목록의 일부 표 행에 업무 식별값이 없어 부모 연결이 모호합니다.');
  const itemField = profile.stage === 'receipt' ? 'ctrtDmndRcptItemSqno' : profile.stage === 'bid' ? 'bidPbancItemSqno' : 'ctrtItemSqno';
  const items = new Map<string, JsonRow>();
  for (const entry of entries.filter(entry => entry.kind === 'items')) for (const row of entry.rows) if (identityValue(row[itemField])) {
    const parentId = complete(row, profile) ? identity(row, profile) : detail ? identity(candidates[0], profile) : [];
    const itemId = stable([...parentId, ...(profile.stage === 'bid' ? [row.bidClsfNo ?? null] : []), row[itemField]]);
    const previous = items.get(itemId);
    if (previous && conflict(previous, row)) return reject('동일 물품 식별값의 표 내용이 충돌하여 수집하지 않습니다.');
    if (!previous) items.set(itemId, row);
  }
  const result: ProcurementObservation[] = [];
  for (const [encoded, parent] of parents) {
    const id: string[] = JSON.parse(encoded);
    const fields: JsonRow = copy(detail ? { ...unit.pointInfo, ...parent } : parent);
    if (detail) for (const entry of entries.filter(entry => isContent(entry.key))) for (const row of entry.rows) {
      if (conflict(fields, row)) return reject('화면 내용과 상세 표 값이 충돌하여 수집하지 않습니다.');
      for (const [key, value] of Object.entries(copy(row))) if (!Object.hasOwn(fields, key) || !present(fields[key])) Object.defineProperty(fields, key, { value, enumerable: true, configurable: true, writable: true });
    }
    const children: NestedDataset[] = [];
    for (const entry of entries) {
      // A list row is already the parent's content; do not make a redundant child.
      if (!detail && entry.kind === 'other') continue;
      const rows = detail ? entry.rows : entry.rows.filter(row => JSON.stringify(identity(row, profile)) === encoded);
      const duplicate = rows.length > 0 && children.some(child => child.kind === entry.kind && stable(child.rows) === stable(rows) && /Excel/i.test(child.key + entry.key));
      if (!duplicate) children.push({ key: entry.key, label: entry.key, kind: entry.kind, rows: copy(rows) });
    }
    result.push({ stage: profile.stage, identity: id, fields, children, rawJson: JSON.stringify(unit.original), source: { url: unit.url, areaCd: String(unit.pointInfo.areaCd), depth1: String(unit.pointInfo.depth1), depth2: String(unit.pointInfo.depth2), ...(present(depth3) ? { depth3: String(depth3) } : {}), framePath: unit.framePath }, capturedAt });
  }
  return result;
}

/** Pure normalization: raw and every source table remain available; extraction never writes storage. */
export function extractCapture(raw: unknown, sourceUrl?: string, screenRules?: CaptureScreenRule[]): ExtractionResult {
  const warnings: string[] = object(raw) && Array.isArray(raw.warnings) ? raw.warnings.filter((entry): entry is string => typeof entry === 'string') : [];
  const parsed = units(raw, sourceUrl, warnings);
  const views: ExtractionView[] = [];
  const groups: ProcurementObservation[][] = [];
  const usedKeys = new Set<string>();
  const capturedAt = new Date().toISOString();
  for (const unit of parsed) {
    const stage = structuralStage(unit);
    for (const [tableKey, rows] of Object.entries(unit.tables)) {
      let key = tableKey;
      if (usedKeys.has(key)) key = unit.framePath + '::' + tableKey;
      const initial = key; let suffix = 2;
      while (usedKeys.has(key)) key = initial + '#' + suffix++;
      usedKeys.add(key);
      views.push({ key, label: tableKey, ...(stage ? { stage } : {}), rows: copy(rows) });
    }
    const observations = observe(unit, warnings, capturedAt, screenRules);
    if (observations.length) groups.push(observations);
  }
  let observations = groups.flat();
  if (groups.length > 1) {
    const signature = (group: ProcurementObservation[]): string => stable(group.map(entry => ({ stage: entry.stage, identity: entry.identity, fields: entry.fields, children: entry.children })));
    if (groups.some(group => signature(group) !== signature(groups[0]))) {
      warnings.push('여러 frame의 업무 문맥이 서로 달라 수집하지 않습니다. 각 화면에서 다시 추출하세요.');
      observations = [];
    } else observations = groups[0];
  }
  return { raw, views, observations, warnings: [...new Set(warnings)] };
}

/** The default temporary grid contains tables only; pointInfo remains in raw and scope checks. */
export function extractionViews(result: ExtractionResult, mode: MvpSettings['extractionMode'] = 'tables'): ExtractionView[] {
  const tables = result.views.map(view => ({ ...view, rows: copy(view.rows) }));
  if (mode !== 'all') return tables;
  const parsed = units(result.raw, undefined, []);
  const used = new Set(tables.map(view => view.key));
  for (const unit of parsed) {
    let key = '$pointInfo:' + unit.framePath, suffix = 2;
    const initial = key;
    while (used.has(key)) key = initial + '#' + suffix++;
    used.add(key);
    const stage = structuralStage(unit);
    tables.push({ key, label: 'pointInfo (' + unit.framePath + ')', ...(stage ? { stage } : {}), rows: [copy(unit.pointInfo)] });
  }
  return tables;
}

export function loadJson(text: string, sourceUrl?: string): ExtractionResult {
  return extractCapture(JSON.parse(text.replace(/^\uFEFF/, '')), sourceUrl);
}

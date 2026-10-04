import type { CaptureScreenRule, FieldDictionary, MvpColumnFormat, MvpColumnType, MvpSettings } from './contracts';

const SCHEMA = 'g2b-helper-shared-settings';
export const SHARED_SETTINGS_MAX_BYTES = 1024 * 1024;
export const SHARED_SETTINGS_HISTORY_LIMIT = 10;
export const SHARED_SETTINGS_HISTORY_MAX_BYTES = 3 * SHARED_SETTINGS_MAX_BYTES;
const MAX_ENTRIES = 5000;
const MAX_TEXT = 4096;
export interface SharedSettingsData {
  dictionary: FieldDictionary;
  columnTypes: Record<string, MvpColumnType>;
  columnFormats: Record<string, MvpColumnFormat>;
  columnLocks: Record<string, boolean>;
  /** null selects built-in rules; [] deliberately allows no user screens. */
  screenRules: CaptureScreenRule[] | null;
}
export interface SharedSettingsPackage { schema: typeof SCHEMA; schemaVersion: 1; label: string; version: string; exportedAt: string; data: SharedSettingsData; }
export interface SharedSettingsRevision { id: string; label: string; version: string; createdAt: string; action: 'import' | 'restore'; before: SharedSettingsData; after: SharedSettingsData; }
export interface SharedSettingsState { history: SharedSettingsRevision[]; }
type Owner = MvpSettings & { sharedSettings?: SharedSettingsState };
type Section = 'keys' | 'values' | 'columnTypes' | 'columnFormats' | 'columnLocks' | 'screenRules';
export interface SharedSettingsChange { id: string; section: Section; key: string; valueKey?: string; local: unknown; incoming: unknown; localPresent: boolean; incomingPresent: boolean; conflict: boolean; }
export interface SharedSettingsPreview { label: string; version: string; action: 'import' | 'restore'; changes: SharedSettingsChange[]; }
export type SharedSettingsDecisions = Record<string, 'local' | 'incoming'>;

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function invalid(message: string): never { throw new Error(message); }
function text(value: unknown, label: string, max = MAX_TEXT): string { if (typeof value !== 'string' || value.length > max) invalid(`${label}: 문자열 길이 또는 형식을 확인하세요.`); return value; }
// Python str.strip() also treats these control separators as whitespace.
function blankRuleText(value: string): boolean { return /^[\s\u001c-\u001f\u0085]*$/u.test(value); }
function fields(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid(`${label}: 지원하지 않는 항목 또는 형식입니다.`);
  return value;
}
function map<T>(value: unknown, parse: (value: unknown) => T, label: string): Record<string, T> {
  if (!object(value) || Object.keys(value).length > MAX_ENTRIES) invalid(`${label}: 항목 수 또는 형식을 확인하세요.`);
  const result: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value)) { text(key, label, 512); put(result, key, parse(entry)); }
  return result;
}
function put(target: object, key: string, value: unknown) { Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true }); }
function format(value: unknown): MvpColumnFormat {
  const item = fields(value, ['decimals', 'grouping', 'dateFormat'], '열 서식');
  if (Object.hasOwn(item, 'decimals') && (!Number.isInteger(item.decimals) || Number(item.decimals) < 0 || Number(item.decimals) > 20)) invalid('소수 자릿수는 0~20입니다.');
  if (Object.hasOwn(item, 'grouping') && typeof item.grouping !== 'boolean') invalid('천 단위 구분은 체크값입니다.');
  if (Object.hasOwn(item, 'dateFormat') && !['dot', 'dash', 'compact'].includes(String(item.dateFormat))) invalid('지원하지 않는 날짜 표기입니다.');
  return structuredClone(item) as MvpColumnFormat;
}
function rules(value: unknown): CaptureScreenRule[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 500) invalid('수집 조건 수 또는 형식을 확인하세요.');
  const ids = new Set<string>();
  return value.map(entry => {
    const item = fields(entry, ['id', 'stage', 'urlPattern', 'areaCd', 'depth1', 'depth2', 'depth3'], '수집 조건');
    const id = text(item.id, '조건 ID', 512);
    if (blankRuleText(id) || ids.has(id)) invalid('조건 ID는 비어 있거나 중복될 수 없습니다.');
    ids.add(id);
    if (!['receipt', 'bid', 'contract'].includes(String(item.stage))) invalid('지원하지 않는 수집 업무입니다.');
    for (const key of ['urlPattern', 'areaCd', 'depth1', 'depth2']) if (blankRuleText(text(item[key], key))) invalid(`${key}: 필수 수집 조건을 입력하세요.`);
    if (Object.hasOwn(item, 'depth3')) text(item.depth3, 'depth3');
    return structuredClone(item) as unknown as CaptureScreenRule;
  });
}
function data(value: unknown): SharedSettingsData {
  const item = fields(value, ['dictionary', 'columnTypes', 'columnFormats', 'columnLocks', 'screenRules'], '공유 설정');
  const dictionary = fields(item.dictionary, ['keys', 'values'], '사전');
  const result: SharedSettingsData = {
    dictionary: { keys: map(dictionary.keys, value => text(value, '표시명'), '키 사전'), values: map(dictionary.values, value => map(value, label => text(label, '표시명'), '값 사전'), '값 사전') },
    columnTypes: map(item.columnTypes, value => { if (typeof value !== 'string' || !['text', 'number', 'money', 'percent', 'date', 'datetime', 'boolean'].includes(value)) invalid('지원하지 않는 열 타입입니다.'); return value as MvpColumnType; }, '열 타입'),
    columnFormats: map(item.columnFormats, format, '열 서식'),
    columnLocks: map(item.columnLocks, value => { if (typeof value !== 'boolean') invalid('열 잠금은 체크값입니다.'); return value; }, '열 잠금'),
    screenRules: rules(item.screenRules),
  };
  const count = Object.keys(result.dictionary.keys).length + Object.values(result.dictionary.values).reduce((sum, values) => sum + Object.keys(values).length, 0) + Object.keys(result.columnTypes).length + Object.keys(result.columnFormats).length + Object.keys(result.columnLocks).length;
  if (count > MAX_ENTRIES) invalid('공유 설정은 전체 5,000항목 이하여야 합니다.');
  if (new TextEncoder().encode(JSON.stringify(result)).length > SHARED_SETTINGS_MAX_BYTES - 1024) invalid('공유 설정 파일은 1MB 이하여야 합니다.');
  return result;
}
function shared(settings: MvpSettings): SharedSettingsData {
  return data({ dictionary: settings.dictionary, columnTypes: settings.columnTypes ?? {}, columnFormats: settings.columnFormats ?? {}, columnLocks: settings.columnLocks ?? {}, screenRules: settings.screenRules ?? null });
}
export function createSharedSettingsPackage(settings: MvpSettings, label: string, version: string, now = new Date().toISOString()): SharedSettingsPackage {
  const result: SharedSettingsPackage = { schema: SCHEMA, schemaVersion: 1, label: text(label, '이름', 200), version: text(version, '버전', 100), exportedAt: text(now, '시각', 100), data: shared(settings) };
  parseSharedSettingsPackage(JSON.stringify(result));
  return result;
}
export function parseSharedSettingsPackage(source: string): SharedSettingsPackage {
  if (new TextEncoder().encode(source).length > SHARED_SETTINGS_MAX_BYTES) invalid('공유 설정 파일은 1MB 이하여야 합니다.');
  let value: unknown; try { value = JSON.parse(source); } catch { invalid('올바른 JSON 파일이 아닙니다.'); }
  const item = fields(value, ['schema', 'schemaVersion', 'label', 'version', 'exportedAt', 'data'], '설정 파일');
  if (item.schema !== SCHEMA || item.schemaVersion !== 1) invalid('지원하지 않는 공유 설정 형식 또는 버전입니다.');
  const exportedAt = text(item.exportedAt, '시각', 100); if (!Number.isFinite(Date.parse(exportedAt))) invalid('내보낸 시각이 올바르지 않습니다.');
  const result: SharedSettingsPackage = { schema: SCHEMA, schemaVersion: 1, label: text(item.label, '이름', 200), version: text(item.version, '버전', 100), exportedAt, data: data(item.data) };
  return result;
}
function entries(value: SharedSettingsData): Map<string, Omit<SharedSettingsChange, 'local' | 'localPresent' | 'conflict'>> {
  const result = new Map<string, Omit<SharedSettingsChange, 'local' | 'localPresent' | 'conflict'>>();
  const add = (section: Section, key: string, incoming: unknown, valueKey?: string) => { const id = JSON.stringify([section, key, valueKey ?? null]); result.set(id, { id, section, key, ...(valueKey === undefined ? {} : { valueKey }), incoming, incomingPresent: true }); };
  for (const [key, label] of Object.entries(value.dictionary.keys)) add('keys', key, label);
  for (const [key, values] of Object.entries(value.dictionary.values)) for (const [valueKey, label] of Object.entries(values)) add('values', key, label, valueKey);
  for (const section of ['columnTypes', 'columnFormats', 'columnLocks'] as const) for (const [key, entry] of Object.entries(value[section])) add(section, key, entry);
  add('screenRules', '', value.screenRules);
  return result;
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((entry, index) => same(entry, b[index]));
  return object(a) && object(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}
export function previewSharedSettingsImport(settings: MvpSettings, incoming: SharedSettingsPackage): SharedSettingsPreview {
  const validated = parseSharedSettingsPackage(JSON.stringify(incoming)), local = entries(shared(settings)), changes: SharedSettingsChange[] = [];
  for (const [id, entry] of entries(validated.data)) { const current = local.get(id); if (!current || !same(current.incoming, entry.incoming)) changes.push({ ...entry, local: current?.incoming, localPresent: Boolean(current), conflict: Boolean(current) }); }
  return { label: validated.label, version: validated.version, action: 'import', changes };
}
export function previewSharedSettingsRestore(settings: MvpSettings, revisionId: string): SharedSettingsPreview {
  const revision = (settings as Owner).sharedSettings?.history.find(entry => entry.id === revisionId);
  if (!revision) invalid('되돌릴 설정 이력을 찾을 수 없습니다.');
  const before = entries(data(revision.before)), after = entries(data(revision.after)), local = entries(shared(settings)), changes: SharedSettingsChange[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(id), applied = after.get(id), current = local.get(id);
    if (Boolean(previous) === Boolean(applied) && same(previous?.incoming, applied?.incoming)) continue;
    if (Boolean(current) === Boolean(previous) && same(current?.incoming, previous?.incoming)) continue;
    const entry = previous ?? applied!;
    changes.push({ ...entry, incoming: previous?.incoming, incomingPresent: Boolean(previous), local: current?.incoming, localPresent: Boolean(current), conflict: Boolean(current) !== Boolean(applied) || !same(current?.incoming, applied?.incoming) });
  }
  return { label: revision.label, version: revision.version, action: 'restore', changes };
}
export function applySharedSettingsPreview(settings: MvpSettings, preview: SharedSettingsPreview, decisions: SharedSettingsDecisions = {}, now = new Date().toISOString()): Owner {
  const before = shared(settings), current = entries(before), after = structuredClone(before);
  for (const change of preview.changes) {
    const entry = current.get(change.id);
    if (Boolean(entry) !== change.localPresent || !same(entry?.incoming, change.local)) invalid('미리보기 이후 설정이 바뀌었습니다. 차이를 다시 확인하세요.');
    if ((decisions[change.id] ?? (change.conflict ? 'local' : 'incoming')) !== 'incoming') continue;
    let target: Record<string, unknown>;
    if (change.section === 'screenRules') { after.screenRules = structuredClone(change.incoming) as SharedSettingsData['screenRules']; continue; }
    if (change.section === 'keys') target = after.dictionary.keys;
    else if (change.section === 'values') { if (!Object.hasOwn(after.dictionary.values, change.key)) put(after.dictionary.values, change.key, {}); target = after.dictionary.values[change.key]; }
    else target = after[change.section];
    const key = change.valueKey ?? change.key;
    if (change.incomingPresent) put(target, key, structuredClone(change.incoming)); else delete target[key];
    if (change.section === 'values' && !Object.keys(target).length) delete after.dictionary.values[change.key];
  }
  const validated = data(after), result = structuredClone(settings) as Owner;
  if (same(before, validated)) return result;
  result.dictionary = validated.dictionary; result.columnTypes = validated.columnTypes; result.columnFormats = validated.columnFormats; result.columnLocks = validated.columnLocks;
  if (validated.screenRules === null) delete result.screenRules; else result.screenRules = validated.screenRules;
  const history = (result.sharedSettings?.history ?? []).slice(-(SHARED_SETTINGS_HISTORY_LIMIT - 1));
  history.push({ id: crypto.randomUUID(), label: preview.label, version: preview.version, createdAt: now, action: preview.action, before: structuredClone(before), after: structuredClone(validated) });
  while (history.length > 1 && new TextEncoder().encode(JSON.stringify(history)).length > SHARED_SETTINGS_HISTORY_MAX_BYTES) history.shift();
  result.sharedSettings = { history };
  return result;
}

export interface SharedSettingsPanelOptions { getSettings(): MvpSettings; setDraft(settings: MvpSettings): void; onNotice?(message: string, error?: boolean): void; }
/** All mutations stay in the settings-dialog draft. The caller's normal Save persists them. */
export function renderSharedSettingsPanel(container: HTMLElement, options: SharedSettingsPanelOptions): void {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, content = '') => { const el = document.createElement(tag); el.textContent = content; return el; };
  const note = make('p', '사전·열 타입/서식/잠금·수집 조건만 공유합니다. 적용 후 설정창의 저장을 누르세요.'); note.className = 'demo-mark';
  const name = make('input'), version = make('input'); name.placeholder = '설정 이름'; name.value = '공유 설정'; name.setAttribute('aria-label', '공유 설정 이름'); version.placeholder = '버전'; version.value = '1'; version.setAttribute('aria-label', '공유 설정 버전');
  const controls = make('div'), output = make('div'), history = make('div'), status = make('p'); controls.className = 'shared-settings-controls'; output.className = 'shared-settings-preview'; history.className = 'shared-settings-history'; status.setAttribute('role', 'status');
  const report = (message: string, error = false) => { status.textContent = message; options.onNotice?.(message, error); };
  const button = (label: string, action: () => void) => { const el = make('button', label); el.type = 'button'; el.onclick = action; return el; };
  const drawPreview = (preview: SharedSettingsPreview) => {
    output.replaceChildren(make('h3', `${preview.action === 'restore' ? '되돌리기' : '가져오기'}: ${preview.label} (${preview.version})`));
    output.append(make('p', `${preview.changes.length}개 변경 · 충돌은 유지/적용을 직접 선택하세요. 수집 조건은 현재 나라장터 화면에서 별도 확인해야 합니다.`));
    const decisions: SharedSettingsDecisions = {}, table = make('table'); table.className = 'dictionary-grid';
    const head = make('tr'); for (const text of ['항목', '현재', '적용 값', '선택']) head.append(make('th', text)); table.append(head);
    for (const change of preview.changes) {
      const row = make('tr'), choice = make('select'); choice.setAttribute('aria-label', `${change.section} ${change.key} 선택`);
      for (const [value, label] of [['local', '현재 유지'], ['incoming', '적용']]) { const option = make('option', label); option.value = value; choice.append(option); }
      choice.value = change.conflict ? 'local' : 'incoming'; decisions[change.id] = choice.value as 'local' | 'incoming'; choice.onchange = () => { decisions[change.id] = choice.value as 'local' | 'incoming'; };
      for (const content of [`${change.section}: ${change.key}${change.valueKey === undefined ? '' : ` / ${change.valueKey}`}${change.conflict ? ' (충돌)' : ''}`, change.localPresent ? JSON.stringify(change.local) : '(없음)', change.incomingPresent ? JSON.stringify(change.incoming) : '(삭제)']) { const cell = make('td', content); cell.title = content; row.append(cell); }
      const cell = make('td'); cell.append(choice); row.append(cell); table.append(row);
    }
    const apply = button('선택한 변경 적용', () => { try { const next = applySharedSettingsPreview(options.getSettings(), preview, decisions); options.setDraft(next); output.replaceChildren(); drawHistory(); report('임시 설정에 적용했습니다. 설정창의 저장을 누르세요.'); } catch (error) { report((error as Error).message, true); } }); apply.disabled = !preview.changes.length;
    output.append(table, apply, button('미리보기 취소', () => output.replaceChildren()));
  };
  const drawHistory = () => {
    history.replaceChildren(make('h3', '최근 적용 이력'));
    const revisions = (options.getSettings() as Owner).sharedSettings?.history ?? [];
    if (!revisions.length) history.append(make('p', '저장된 공유 설정 적용 이력이 없습니다.'));
    for (const revision of [...revisions].reverse()) { const line = make('div'); line.append(make('span', `${revision.label} (${revision.version}) · ${revision.createdAt} · ${revision.action === 'restore' ? '되돌리기' : '가져오기'} `), button('되돌리기 미리보기', () => { try { drawPreview(previewSharedSettingsRestore(options.getSettings(), revision.id)); } catch (error) { report((error as Error).message, true); } })); history.append(line); }
  };
  const file = make('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', '공유 설정 JSON 가져오기');
  file.onchange = async () => {
    const selected = file.files?.[0]; if (!selected) return;
    try { if (selected.size > SHARED_SETTINGS_MAX_BYTES) invalid('공유 설정 파일은 1MB 이하여야 합니다.'); const source = await selected.text(); if (!file.isConnected) return; drawPreview(previewSharedSettingsImport(options.getSettings(), parseSharedSettingsPackage(source))); report('차이를 확인하고 적용할 항목을 선택하세요.'); } catch (error) { if (file.isConnected) report((error as Error).message, true); } finally { file.value = ''; }
  };
  const exportButton = button('JSON 내보내기', () => {
    try { const pkg = createSharedSettingsPackage(options.getSettings(), name.value, version.value), url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })), link = make('a'); link.href = url; link.download = 'G2B_Helper_shared_settings.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); report('공유 설정 JSON을 내보냈습니다.'); } catch (error) { report((error as Error).message, true); }
  });
  controls.append(name, version, exportButton, file); container.append(note, controls, status, output, history); drawHistory();
}

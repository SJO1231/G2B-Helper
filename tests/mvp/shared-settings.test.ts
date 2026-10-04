import { describe, expect, it } from 'vitest';
import type { MvpSettings } from '../../apps/mvp/contracts';
import { applySharedSettingsPreview, createSharedSettingsPackage, parseSharedSettingsPackage, previewSharedSettingsImport, previewSharedSettingsRestore, SHARED_SETTINGS_HISTORY_LIMIT, SHARED_SETTINGS_HISTORY_MAX_BYTES, SHARED_SETTINGS_MAX_BYTES } from '../../apps/mvp/shared-settings';

function settings(): MvpSettings {
  return { theme: 'dark', extractionMode: 'all', hideEmptyColumns: false, hideUnmappedColumns: false, dictionary: { keys: { code: '로컬 이름', keep: '남김' }, values: { status: { '0': '미완료', false: '거짓' } } }, columnTypes: { amount: 'money' }, columnFormats: { amount: { decimals: 0, grouping: false } }, columnLocks: { amount: false }, launchers: [{ id: 'private', label: '개인', script: 'private script' }], shortcuts: { collect: 'Alt+Shift+S' }, documentProfiles: { contract: 'private/path' }, userColumns: { contract: ['private memo'] } };
}
function incoming() {
  const value = settings(); value.dictionary = { keys: { code: '공유 이름', added: '새 키' }, values: { status: { '0': '수신 미완료', '1': '완료' } } }; value.columnTypes = { amount: 'number', added: 'text' }; return createSharedSettingsPackage(value, '팀 설정', '2026.1');
}

describe('shared settings packages and reversible draft merge (synthetic configuration)', () => {
  it('exports only the allowlisted shared configuration, retaining false, zero, identifiers and raw-value dictionary keys', () => {
    const local = settings(), pkg = createSharedSettingsPackage(local, '검사', '1');
    expect(Object.keys(pkg.data).sort()).toEqual(['columnFormats', 'columnLocks', 'columnTypes', 'dictionary', 'screenRules']);
    expect(JSON.stringify(pkg)).not.toContain('private'); expect(JSON.stringify(pkg)).not.toContain('launchers'); expect(JSON.stringify(pkg)).not.toContain('theme');
    expect(pkg.data.columnFormats.amount).toEqual({ decimals: 0, grouping: false }); expect(pkg.data.columnLocks.amount).toBe(false);
    expect(pkg.data.dictionary.values.status['0']).toBe('미완료'); expect(pkg.data.dictionary.values.status.false).toBe('거짓');
    expect(parseSharedSettingsPackage(JSON.stringify(pkg))).toEqual(pkg); expect(pkg.data.screenRules).toBeNull();
    pkg.data.dictionary.keys.code = '패키지만 변경'; expect(local.dictionary.keys.code).toBe('로컬 이름');
  });
  it.each(['{', 'null', '[]', '{}'])('rejects malformed or incomplete JSON: %s', source => { expect(() => parseSharedSettingsPackage(source)).toThrow(); });
  it('rejects unsupported schema versions, unknown executable/business entries and invalid metadata', () => {
    const pkg = incoming();
    for (const changed of [{ ...pkg, schemaVersion: 2 }, { ...pkg, launchers: [] }, { ...pkg, data: { ...pkg.data, records: [{ raw: 'business' }] } }, { ...pkg, exportedAt: 'invalid' }, { ...pkg, version: 1 }]) expect(() => parseSharedSettingsPackage(JSON.stringify(changed))).toThrow();
    expect(() => parseSharedSettingsPackage(' '.repeat(SHARED_SETTINGS_MAX_BYTES + 1))).toThrow('1MB');
  });
  it('validates leaf types, formats and collection rules instead of coercing them', () => {
    const pkg = incoming();
    for (const changed of [{ ...pkg.data, columnTypes: { a: 'script' } }, { ...pkg.data, columnLocks: { a: 0 } }, { ...pkg.data, columnFormats: { a: { decimals: 21 } } }, { ...pkg.data, columnFormats: { a: { grouping: 'false' } } }, { ...pkg.data, dictionary: { keys: { a: false }, values: {} } }, { ...pkg.data, screenRules: [{ id: 'x', stage: 'unknown' }] }]) expect(() => parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: changed }))).toThrow();
    const rule = { id: 'x', stage: 'contract', urlPattern: 'https://www.g2b.go.kr/*', areaCd: '14', depth1: '01', depth2: '02' };
    expect(() => parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: { ...pkg.data, screenRules: [rule, rule] } }))).toThrow('중복');
    expect(() => parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: { ...pkg.data, columnFormats: { a: { constructor: 'x' } } } }))).toThrow();
  });
  it('bounds total entries and string lengths', () => {
    const pkg = incoming(), keys = Object.fromEntries(Array.from({ length: 5001 }, (_, index) => [String(index), 'label']));
    expect(() => parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: { ...pkg.data, dictionary: { keys, values: {} } } }))).toThrow();
    expect(() => createSharedSettingsPackage(settings(), 'x'.repeat(201), '1')).toThrow();
    expect(() => parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: { ...pkg.data, dictionary: { keys: { a: 'x'.repeat(4097) }, values: {} } } }))).toThrow();
  });
  it.each(['id', 'urlPattern', 'areaCd', 'depth1', 'depth2'])('rejects empty and whitespace-only required screen rule %s, preserving accepted source strings', key => {
    const pkg = incoming(), rule = { id: 'rule', stage: 'contract', urlPattern: 'https://www.g2b.go.kr/*', areaCd: '14', depth1: '01', depth2: '02', depth3: '' };
    for (const value of ['', ' ', '\t\r\n', '\u3000', '\u0085', '\u001c']) expect(() => parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: { ...pkg.data, screenRules: [{ ...rule, [key]: value }] } }))).toThrow();
    const accepted = { ...rule, [key]: ` ${rule[key as keyof typeof rule]} ` };
    expect(parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: { ...pkg.data, screenRules: [accepted] } })).data.screenRules![0]).toEqual(accepted);
  });
  it('matches Native screen-rule count bound and allows optional empty depth3', () => {
    const pkg = incoming(), rules = Array.from({ length: 500 }, (_, index) => ({ id: String(index), stage: 'contract', urlPattern: 'https://www.g2b.go.kr/*', areaCd: '14', depth1: '01', depth2: '02', depth3: '' }));
    expect(parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: { ...pkg.data, screenRules: rules } })).data.screenRules).toHaveLength(500);
    expect(() => parseSharedSettingsPackage(JSON.stringify({ ...pkg, data: { ...pkg.data, screenRules: [...rules, { ...rules[0], id: '500' }] } }))).toThrow();
  });
  it('round-trips special source keys as own values without changing object prototypes', () => {
    const local = settings(), pkg = incoming(); pkg.data.dictionary.keys = JSON.parse('{"__proto__":"표시명","constructor":"생성자","prototype":"원천"}');
    pkg.data.dictionary.values = JSON.parse('{"__proto__":{"__proto__":"값 이름","constructor":"값 생성자"}}'); pkg.data.columnLocks = JSON.parse('{"__proto__":false}');
    const parsed = parseSharedSettingsPackage(JSON.stringify(pkg)), next = applySharedSettingsPreview(local, previewSharedSettingsImport(local, parsed));
    expect(Object.getPrototypeOf(next.dictionary.keys)).toBe(Object.prototype); expect(Object.hasOwn(next.dictionary.keys, '__proto__')).toBe(true); expect(next.dictionary.keys.__proto__).toBe('표시명');
    expect(next.dictionary.values.__proto__.__proto__).toBe('값 이름'); expect(next.columnLocks!.__proto__).toBe(false); expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('previews conflicts and keeps local conflict values unless incoming is explicitly chosen', () => {
    const local = settings(), preview = previewSharedSettingsImport(local, incoming());
    expect(preview.changes.find(change => change.section === 'keys' && change.key === 'code')?.conflict).toBe(true);
    expect(preview.changes.find(change => change.section === 'keys' && change.key === 'added')?.conflict).toBe(false);
    const next = applySharedSettingsPreview(local, preview);
    expect(next.dictionary.keys).toEqual({ code: '로컬 이름', keep: '남김', added: '새 키' }); expect(next.dictionary.values.status).toEqual({ '0': '미완료', '1': '완료', false: '거짓' });
    expect(next.columnTypes!.amount).toBe('money'); expect(local.dictionary.keys.added).toBeUndefined();
    const code = preview.changes.find(change => change.section === 'keys' && change.key === 'code')!;
    expect(applySharedSettingsPreview(local, preview, { [code.id]: 'incoming' }).dictionary.keys.code).toBe('공유 이름');
  });
  it('preserves all unrelated personal settings, document paths and subsequent unrelated edits', () => {
    const local = settings(), preview = previewSharedSettingsImport(local, incoming()); local.theme = 'light'; local.dictionary.keys.afterPreview = '이후 추가';
    const next = applySharedSettingsPreview(local, preview);
    for (const key of ['theme', 'extractionMode', 'hideEmptyColumns', 'hideUnmappedColumns', 'launchers', 'shortcuts', 'documentProfiles', 'userColumns'] as const) expect(next[key]).toEqual(local[key]);
    expect(next.dictionary.keys.afterPreview).toBe('이후 추가');
  });
  it('rejects a stale preview when an affected local value changed', () => {
    const local = settings(), preview = previewSharedSettingsImport(local, incoming()); local.dictionary.keys.code = '그 사이 수정';
    expect(() => applySharedSettingsPreview(local, preview)).toThrow('다시 확인');
  });
  it('treats built-in versus explicitly empty user screen rules as a visible conflict', () => {
    const local = settings(), pkg = incoming(); pkg.data.screenRules = [];
    const preview = previewSharedSettingsImport(local, pkg), change = preview.changes.find(change => change.section === 'screenRules')!;
    expect(change.local).toBeNull(); expect(change.incoming).toEqual([]); expect(change.conflict).toBe(true);
    expect(applySharedSettingsPreview(local, preview).screenRules).toBeUndefined();
    expect(applySharedSettingsPreview(local, preview, { [change.id]: 'incoming' }).screenRules).toEqual([]);
  });
  it('restores built-in rules by deleting screenRules, and restores explicitly empty custom rules as an own property', () => {
    const local = settings(), pkg = incoming(); pkg.data.screenRules = [];
    const preview = previewSharedSettingsImport(local, pkg), change = preview.changes.find(entry => entry.section === 'screenRules')!;
    const custom = applySharedSettingsPreview(local, preview, { [change.id]: 'incoming' });
    expect(Object.hasOwn(custom, 'screenRules')).toBe(true);
    const restoredDefault = applySharedSettingsPreview(custom, previewSharedSettingsRestore(custom, custom.sharedSettings!.history[0].id));
    expect(Object.hasOwn(restoredDefault, 'screenRules')).toBe(false); expect(restoredDefault.screenRules).toBeUndefined();
    pkg.data.screenRules = null;
    const defaultPreview = previewSharedSettingsImport(custom, pkg), defaultChange = defaultPreview.changes.find(entry => entry.section === 'screenRules')!;
    const defaultApplied = applySharedSettingsPreview(custom, defaultPreview, { [defaultChange.id]: 'incoming' });
    expect(Object.hasOwn(defaultApplied, 'screenRules')).toBe(false);
    const restoredCustom = applySharedSettingsPreview(defaultApplied, previewSharedSettingsRestore(defaultApplied, defaultApplied.sharedSettings!.history.at(-1)!.id));
    expect(Object.hasOwn(restoredCustom, 'screenRules')).toBe(true); expect(restoredCustom.screenRules).toEqual([]);
  });
  it('restores only entries changed by that application, removing added entries and retaining unrelated local work', () => {
    const local = settings(), preview = previewSharedSettingsImport(local, incoming());
    const decisions = Object.fromEntries(preview.changes.map(change => [change.id, 'incoming' as const]));
    const applied = applySharedSettingsPreview(local, preview, decisions); applied.dictionary.keys.later = '이후 추가'; applied.theme = 'light';
    const restore = previewSharedSettingsRestore(applied, applied.sharedSettings!.history[0].id);
    expect(restore.changes.every(change => !change.conflict)).toBe(true);
    const next = applySharedSettingsPreview(applied, restore);
    expect(next.dictionary.keys).toEqual({ ...local.dictionary.keys, later: '이후 추가' }); expect(next.dictionary.values).toEqual(local.dictionary.values); expect(next.columnTypes).toEqual(local.columnTypes); expect(next.theme).toBe('light');
    expect(next.sharedSettings!.history.at(-1)!.action).toBe('restore');
  });
  it('lets users preserve or overwrite subsequent edits when restoring an earlier revision', () => {
    const local = settings(), applied = applySharedSettingsPreview(local, previewSharedSettingsImport(local, incoming())); applied.dictionary.keys.added = 'ユーザー後編集';
    const restore = previewSharedSettingsRestore(applied, applied.sharedSettings!.history[0].id), conflict = restore.changes.find(change => change.key === 'added' && change.section === 'keys')!;
    expect(conflict.conflict).toBe(true); expect(conflict.incomingPresent).toBe(false);
    expect(applySharedSettingsPreview(applied, restore).dictionary.keys.added).toBe('ユーザー後編集');
    expect(Object.hasOwn(applySharedSettingsPreview(applied, restore, { [conflict.id]: 'incoming' }).dictionary.keys, 'added')).toBe(false);
  });
  it('bounds history and skips history entries when all choices keep local', () => {
    let local = settings();
    for (let index = 0; index < 12; index++) { const pkg = incoming(); pkg.data.dictionary.keys.unique = String(index); const preview = previewSharedSettingsImport(local, pkg); local = applySharedSettingsPreview(local, preview, Object.fromEntries(preview.changes.map(change => [change.id, 'incoming' as const]))); }
    const owner = local as ReturnType<typeof applySharedSettingsPreview>; expect(owner.sharedSettings!.history).toHaveLength(SHARED_SETTINGS_HISTORY_LIMIT);
    const pkg = incoming(); pkg.data.dictionary.keys.unique = 'different'; const preview = previewSharedSettingsImport(local, pkg), kept = applySharedSettingsPreview(local, preview, Object.fromEntries(preview.changes.map(change => [change.id, 'local' as const])));
    expect(kept.sharedSettings).toEqual(owner.sharedSettings);
    expect(() => previewSharedSettingsRestore(local, 'missing')).toThrow('이력');
  });
  it('evicts old large snapshots by byte budget while retaining the newest reversible application', () => {
    let local = settings(); local.dictionary.keys = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`large${index}`, 'x'.repeat(3000)]));
    for (let index = 0; index < 10; index++) {
      const pkg = createSharedSettingsPackage(local, '큰 설정', String(index)); pkg.data.dictionary.keys.large0 = String(index);
      const preview = previewSharedSettingsImport(local, pkg); local = applySharedSettingsPreview(local, preview, Object.fromEntries(preview.changes.map(change => [change.id, 'incoming' as const])));
    }
    const owner = local as ReturnType<typeof applySharedSettingsPreview>, history = owner.sharedSettings!.history;
    expect(new TextEncoder().encode(JSON.stringify(history)).length).toBeLessThanOrEqual(SHARED_SETTINGS_HISTORY_MAX_BYTES); expect(history.length).toBeLessThan(SHARED_SETTINGS_HISTORY_LIMIT); expect(history.at(-1)!.version).toBe('9');
    const restored = applySharedSettingsPreview(local, previewSharedSettingsRestore(local, history.at(-1)!.id)); expect(restored.dictionary.keys.large0).toBe('8');
  });
});

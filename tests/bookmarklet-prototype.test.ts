import { renderTextTemplate } from '../apps/bookmarklet/template-model';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../apps/bookmarklet/capture-identity';
import { mergeVisibleRows, validateDataset } from '../apps/bookmarklet/dataset-model';
import { parsePrototypeBackup, parseRawCapture, parseTransferBundle, validatePrototypeValue } from '../apps/bookmarklet/storage';
import type { PrototypeDataset } from '../apps/bookmarklet/contracts';

describe('bookmarklet prototype contracts', () => {
  it('replay ignores object key order but distinguishes types and array order', () => {
    expect(canonicalJson({ b: [{ z: false, a: 0 }], a: '01' })).toBe(canonicalJson({ a: '01', b: [{ a: 0, z: false }] }));
    expect(canonicalJson({ a: '01' })).not.toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson([false, 0])).not.toBe(canonicalJson([0, false]));
  });
  it('raw files preserve missing/null, false, zero and nested values', () => {
    const payload = { pointInfo: { code: '01', active: false }, tables: { sample: [{ amount: '35608652.5', count: 0, empty: null, nested: { code: '0001' } }] } };
    expect(parseRawCapture(payload)).toEqual(payload);
    expect(Object.hasOwn(parseRawCapture(payload).tables.sample[0], 'missing')).toBe(false);
  });
  it('rejects malformed capture rows and frame provenance', () => {
    expect(() => parseRawCapture({ pointInfo: {}, tables: { bad: [null] } })).toThrow('객체 행');
    expect(() => parseRawCapture({ pointInfo: {}, tables: {}, frames: [{ framePath: 'top', url: 'https://example.test', pointInfo: {}, tables: { bad: 'not rows' } }] })).toThrow('객체 행');
  });
  it('transfer and full backup formats cannot be interchanged', () => {
    const backup = { format: 'pce-bookmarklet-backup', version: 1, origin: 'https://example.test', exportedAt: new Date().toISOString(), captures: [], settings: [] };
    expect(parsePrototypeBackup(backup)).toEqual(backup);
    expect(() => parseTransferBundle(backup)).toThrow('전달 JSON');
    expect(() => parsePrototypeBackup({ ...backup, version: 2 })).toThrow('전체 백업');
  });
  it('rejects forged document ownership and duplicated setting keys before restore', () => {
    const backup = { format: 'pce-bookmarklet-backup', version: 1, origin: 'https://example.test', exportedAt: new Date().toISOString(), captures: [], settings: [['prototype:notes:one', { namespace: 'templates', documentId: 'one', storeVersion: 1, value: { name: 'wrong owner', body: '' } }]] };
    expect(() => parsePrototypeBackup(backup)).toThrow('문서 형식');
    expect(() => parsePrototypeBackup({ ...backup, settings: [['keyLabels', {}], ['keyLabels', {}]] })).toThrow('반복');
  });
  it('merging filtered edits retains hidden rows and removes virtual values', () => {
    const rows = [{ __rowId: 'hidden', __storeVersion: 1, code: '' }, { __rowId: 'visible', __storeVersion: 1, code: '01' }];
    expect(mergeVisibleRows(rows, [{ ...rows[1], code: '0002', __virtualPath: 'display only' }])).toEqual([rows[0], { ...rows[1], code: '0002' }]);
    expect(mergeVisibleRows(rows, [], ['visible'])).toEqual([rows[0]]);
  });
  it('typed dataset validates a whole edit batch before writes', () => {
    const value: PrototypeDataset = { name: 'prices', category: 'reference', columns: [{ field: 'code', label: '코드', kind: 'code' }, { field: 'amount', label: '단가', kind: 'decimal' }], rows: [{ __rowId: 'r', __storeVersion: 1, code: '0001', amount: '35608652.5' }] };
    expect(() => validateDataset(value)).not.toThrow();
    expect(() => validateDataset({ ...value, rows: [{ ...value.rows[0], amount: 'not a number' }] })).toThrow('소수');
    expect(() => validateDataset({ ...value, columns: [...value.columns, value.columns[0]] })).toThrow('반복');
  });
  it('template references preserve zero, false and nested codes without evaluating code', () => {
    expect(renderTextTemplate('{{count}} / {{active}} / {{info.codes.0}} / {{missing}}', { count: 0, active: false, info: { codes: ['01'] } })).toBe('0 / false / 01 / [누락: missing]');
    expect(renderTextTemplate('{{constructor}}', {})).toBe('[누락: constructor]');
  });
  it('launcher validates HTTP(S) links and leaves scripts as explicit manual content', () => {
    expect(() => validatePrototypeValue('launchers', { name: 'bad', kind: 'url', target: 'javascript:alert(1)' })).toThrow('http/https');
    expect(() => validatePrototypeValue('launchers', { name: 'manual', kind: 'script', target: 'alert(1)' })).not.toThrow();
  });
});

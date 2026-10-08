import { describe, expect, it } from 'vitest';
import type { MvpSettings } from '../../apps/mvp/contracts';
import { GridModel, compareValues, dateColumnKeys, dateParts, editedValue, excelFormat, excelValue, exportMatrix, formatValue, matchesView, nestedPreview, parseClipboard, valueToken, type GridFilter } from '../../apps/mvp/grid-model';

const settings: MvpSettings = { theme: 'light', extractionMode: 'tables', hideEmptyColumns: true, hideUnmappedColumns: false, dictionary: { keys: {}, values: {} }, launchers: [] };
describe('MVP worksheet model (synthetic data)', () => {
  it('lists only declared date and datetime columns, including empty dates and excluding date-shaped identifiers', () => {
    const rows = [{ itemIdnfNo: '20263140', identifier: '20261002', due: '', changed: false }, { due: null, recorded: 'invalid', memo: '20261002' }];
    expect(dateColumnKeys(rows, { ...settings, columnTypes: { due: 'date', recorded: 'datetime', identifier: 'text', changed: 'boolean', missing: 'date' } })).toEqual(['due', 'recorded']);
    expect(dateColumnKeys(rows, settings)).toEqual([]);
  });
  it.each([
    ['number', ['-10', '-2', '-3원']], ['money', ['-10', '-2', '-3원']], ['percent', ['-10%', '-2%', '-3원']],
    ['date', ['20260101', '2026.01.20', '2026.02.30']],
    ['datetime', ['20260101 00:00', '2026.01.20 00:00', '2026.02.30 00:00']],
  ] as const)('orders mixed %s values consistently in every input permutation', (type, expected) => {
    for (let first = 0; first < 3; first++) for (let second = 0; second < 3; second++) {
      if (first === second) continue;
      const input = [expected[first], expected[second], expected[3 - first - second]];
      expect(input.sort((a, b) => compareValues(a, b, type))).toEqual(expected);
    }
    expect(compareValues(expected[0], expected[2], type)).toBeLessThan(0);
  });
  it('sorts exact numeric strings and mixed valid dates without rounding through Number', () => {
    expect(['1.2', '-2', '1.02', '-10'].sort((a, b) => compareValues(a, b, 'money'))).toEqual(['-10', '-2', '1.02', '1.2']);
    expect([0.1, 1e-7, -1e-7, 1e22, 2e21, '0.01', 'unknown'].sort((a, b) => compareValues(a, b, 'number'))).toEqual([-1e-7, 1e-7, '0.01', 0.1, 2e21, 1e22, 'unknown']);
    expect(compareValues('12345678901234567890.0000000001', '12345678901234567890.0000000002', 'number')).toBe(-1);
    expect(['2026-02-01', '20260101', '2026.01.20'].sort((a, b) => compareValues(a, b, 'date'))).toEqual(['20260101', '2026.01.20', '2026-02-01']);
    expect(dateParts('0001-01-01')).toEqual(['0001', '01', '01']); expect(dateParts('2024-02.29')).toBeUndefined();
  });
  it('accepts grouped decimals, percentage points and calendar timestamps while retaining precise values', () => {
    expect(editedValue('1,234.000000000000000001', '', 'money')).toBe('1234.000000000000000001');
    for (const value of ['1,23', '1e3', 'NaN', '1,,234']) expect(() => editedValue(value, '', 'number')).toThrow();
    expect(editedValue('12.5%', '', 'percent')).toBe('12.5'); expect(formatValue('12.5', 'percent')).toBe('12.5%');
    expect(editedValue('false', 'true', 'boolean')).toBe('false'); expect(editedValue('false', true, 'boolean')).toBe(false);
    expect(formatValue(editedValue('2024-02-29T23:59:59.001', '', 'datetime'), 'datetime', { dateFormat: 'dash' })).toBe('2024-02-29 23:59:59.001');
    expect(compareValues('2024-02-29 12:00:00.1', '2024-02-29 12:00:00.100', 'datetime')).toBe(0);
    for (const value of ['2026-02-29 12:00', '2024-02.29 12:00', '2024-02-29 24:00', '2024-02-29 12:60']) expect(() => editedValue(value, '', 'datetime')).toThrow();
  });
  it('limits rounding to display and safe Excel numbers, preserving identifiers and long decimals as text', () => {
    const value = '12345678901234567890.123456789'; expect(formatValue(value, 'money', { decimals: 2 })).toBe('12,345,678,901,234,567,890.12'); expect(excelValue(value, 'money')).toBe(value);
    expect(excelValue('000123', 'number')).toBe('000123'); expect(excelValue('1234.5', 'money')).toBe(1234.5); expect(excelValue('1234', 'text')).toBe('1234');
    expect(excelFormat('percent', { decimals: 1 })).toBe('0.0"%"'); expect(formatValue('20261002', 'date', { dateFormat: 'dash' })).toBe('2026-10-02');
  });
  it('previews a representative item name while keeping generic nested JSON and raw values untouched', () => {
    for (const name of ['dtlsPrnm', 'dtlsPrnmNm', 'itemCfnm', '품명']) {
      const items = [{ [name]: '합성 물품', quantity: 0, completed: false }, { [name]: '둘째 물품' }];
      expect(nestedPreview(items, 'items')).toBe('합성 물품 (전체 2개 품목)');
      expect(nestedPreview(items, 'other')).toBe(JSON.stringify(items));
      expect(items[0].quantity).toBe(0); expect(items[0].completed).toBe(false);
    }
    expect(nestedPreview([{ dtlsPrnm: null }, { itemCfnm: '둘째 물품' }], 'items')).toBe('둘째 물품 (전체 2개 품목)');
    expect(nestedPreview([0, false, { code: '0001' }], 'items')).toBe('[0,false,{"code":"0001"}]');
    expect(nestedPreview([{ 품명: '복합기', 수량: 0, 단가: '1.000000000000000001' }], '물품')).toBe('복합기');
    expect(nestedPreview([{ 품명: '복합기' }], '품목')).toBe('복합기');
  });
  it('shows the representative item by amount with its quantity, unit and amount instead of 외 N건 (#30)', () => {
    const contract = [{ ctrtItemSqno: '2', ctrtItemNm: '큰 품목', ctrtQty: '3', ctrtUntVal: '대', ctrtAmt: '1000' }, { ctrtItemSqno: '1', ctrtItemNm: '앞 순번', ctrtQty: '2', ctrtUntVal: '박스', ctrtAmt: '1,000' }, { ctrtItemSqno: '3', ctrtItemNm: '작은 품목', ctrtAmt: '5' }];
    expect(nestedPreview(contract, 'items')).toBe('앞 순번 · 2 박스 · 1,000 (전체 3개 품목)');
    const bid = [{ bidClsfNo: '1', bidPbancItemSqno: '2', ctrtDmndRcptItemSqno: '9', dtlsPrnmNm: '공고 품목', prchsDtlItemQty: '1', prchsDtlItemUntVal: '식', rowAmtSum: '700' }];
    expect(nestedPreview(bid, 'items')).toBe('공고 품목 · 1 식 · 700');
    const receipt = [{ ctrtDmndRcptItemSqno: '2', dtlsPrnm: '뒤' }, { ctrtDmndRcptItemSqno: '10', dtlsPrnm: '더 뒤' }, { ctrtDmndRcptItemSqno: '1', dtlsPrnm: '앞', ctrtDmndQty: 0 }];
    expect(nestedPreview(receipt, 'items')).toBe('앞 · 0 (전체 3개 품목)');
    expect(contract[0].ctrtAmt).toBe('1000');
  });
  it('round-trips every source key, missing field, and empty source row through safe aliases', () => {
    const source = [JSON.parse('{"":"empty key","a.b":"00123","__rowId":0,"__proto__":false,"constructor":1,"amount":1234.56789,"nested":[{"x":0}]}'), {}];
    const model = new GridModel(source), encoded = model.encode(source);
    expect(model.columns.map(column => column.field)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
    expect(model.rows([...encoded, ...model.slots(20)])).toEqual(source);
    const decoded = model.rows(encoded);
    (decoded[0].nested as { x: number }[])[0].x = 9;
    expect(source[0].nested[0].x).toBe(0);
    expect(Object.hasOwn(decoded[0], '__proto__')).toBe(true);
  });
  it('retains zero and false in edited blank worksheet slots without exporting untouched padding', () => {
    const model = new GridModel([{ value: '' }]), original = model.encode([{ value: '' }]), slots = model.slots(3);
    slots[0].f0 = 0; slots[1].f0 = false;
    expect(model.rows([...original, ...slots])).toEqual([{ value: '' }, { value: 0 }, { value: false }]);
  });
  it('keeps source identifiers and numeric precision; rejects malformed boolean edits', () => {
    expect(editedValue('000123', '000001')).toBe('000123');
    expect(editedValue('false', true)).toBe(false);
    expect(editedValue('0', 1)).toBe(0);
    expect(editedValue('0003', 3)).toBe('0003');
    expect(editedValue('12345678901234567890.123456789', 1.1)).toBe('12345678901234567890.123456789');
    expect(editedValue('9007199254740993', 1)).toBe('9007199254740993');
    expect(() => editedValue('0', true)).toThrow('true 또는 false');
    expect(editedValue('1.000000000000000001', 1, 'money')).toBe('1.000000000000000001');
  });
  it('formats money and dates only for presentation without rounding or timezone conversion', () => {
    expect(formatValue('001234567.123456789', 'money')).toBe('001,234,567.123456789');
    expect(formatValue(1234.56789, 'money')).toBe('1,234.56789');
    expect(formatValue('20261001', 'date')).toBe('2026.10.01');
    expect(formatValue('2026-10-01', 'date')).toBe('2026.10.01');
    expect(formatValue('2024.02.29', 'date')).toBe('2024.02.29');
    expect(formatValue('2026.02.30', 'date')).toBe('2026.02.30');
    expect(formatValue('20260230', 'date')).toBe('20260230');
    expect(formatValue('2026-02-30', 'date')).toBe('2026-02-30');
    expect(formatValue('2024-02.29', 'date')).toBe('2024-02.29');
    expect(formatValue('unknown', 'date')).toBe('unknown');
  });
  it('validates typed dates against the Gregorian calendar while preserving raw valid input spelling', () => {
    for (const value of ['20240229', '2024.02.29', '2000-02-29', '2026.10.01']) expect(editedValue(value, '', 'date')).toBe(value);
    for (const value of ['2026.02.30', '19000229', '20260229', '2024-02.29', '00000000', '20241301', '20240100']) expect(() => editedValue(value, '', 'date')).toThrow('유효한');
    expect(editedValue('', '20260101', 'date')).toBe('');
  });
  it('hides only empty columns by default and restores unlabelled source columns when configured', () => {
    const source = [{ blank: null, zero: 0, flag: false, code: '001' }];
    const model = new GridModel(source);
    expect(model.columns.map(column => model.visible(column, source, settings))).toEqual([false, true, true, true]);
    expect(model.columns.map(column => model.visible(column, source, { ...settings, hideEmptyColumns: false }))).toEqual([true, true, true, true]);
    expect(model.columns.map(column => model.visible(column, source, { ...settings, hideUnmappedColumns: true, dictionary: { keys: { zero: '수량' }, values: {} } }))).toEqual([false, true, false, false]);
  });
  it('combines multi-term column filters with AND/OR while keeping tokens type-sensitive', () => {
    const row = { a: 'Alpha', b: false };
    const view = { search: '', combine: 'and' as 'and' | 'or', filters: new Map<string, GridFilter>([['a', { mode: 'exact', terms: ['beta', 'alpha'] }], ['b', { mode: 'values', values: [valueToken('false')] }]]) };
    expect(matchesView(row, view)).toBe(false);
    view.combine = 'or'; expect(matchesView(row, view)).toBe(true);
    view.combine = 'and'; view.filters.set('b', { mode: 'values', values: [valueToken(false)] });
    expect(matchesView(row, view)).toBe(true);
    expect(matchesView(row, { search: '', combine: 'and', filters: new Map([['a', { mode: 'exclude', terms: ['lph', 'z'] }]]) })).toBe(false);
    expect(matchesView(row, { search: 'missing', combine: 'or', filters: view.filters })).toBe(false);
    expect(valueToken(undefined)).not.toBe(valueToken(null));
    expect(valueToken(0)).not.toBe(valueToken('0'));
  });
  it('allows loaded user-column deletion while rejecting source-column deletion', () => {
    const model = new GridModel([{ source: 'raw', memo: 'user' }], ['memo']), buffer = model.encode([{ source: 'raw', memo: 'user' }]);
    expect(() => model.removeColumn('source')).toThrow('원천 열');
    model.removeColumn('memo'); expect(model.rows(buffer)).toEqual([{ source: 'raw' }]);
    const added = model.addColumn('note'); expect(added.user).toBe(true);
    expect(() => model.addColumn('source')).toThrow('이미 있는');
  });
  it('exports mapped headers in selected order with raw number, boolean, identifier and nested JSON', () => {
    expect(exportMatrix([{ code: '0007', amount: 1234.56789, flag: false, nested: [0, false] }], [
      { key: 'amount', label: '금액' }, { key: 'code', label: '번호' }, { key: 'flag', label: '여부' }, { key: 'nested', label: '상세' },
    ])).toEqual([['금액', '번호', '여부', '상세'], [1234.56789, '0007', false, '[0,false]']]);
  });
  it('parses Excel TSV without leaking CR into boolean values or splitting quoted newlines', () => {
    expect(parseClipboard('0001\tfalse\r\n0002\ttrue\r\n')).toEqual([['0001', 'false'], ['0002', 'true']]);
    expect(parseClipboard('"line\nwith\ttab"\t"a""b"\n')).toEqual([['line\nwith\ttab', 'a"b']]);
    expect(() => parseClipboard('"unfinished')).toThrow('따옴표');
  });
});

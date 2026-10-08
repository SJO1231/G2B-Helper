/** Public synthetic fixtures only. */
import { describe, expect, it } from 'vitest';
import { childRowCount, displayChanges, documentCandidates, documentValue, generationItem, planFields, studioKey } from '../../apps/mvp/document-fields';
import type { DocumentItem } from '../../apps/mvp/contracts';

const labels = { ctrtNo: '계약번호', ctrtNm: '계약건명', ctrtAmt: '계약금액', ctrtItemNm: '계약물품명', dmstUntyGrpNm: '수요기관명', 다른키: '계약건명' };
const children = [
  { key: 'items', label: '물품', kind: 'items' as const, rows: [{ ctrtItemNm: '합성 품목', ctrtAmt: '5', ctrtQty: '2' }, { ctrtItemNm: '합성 품목 둘', ctrtAmt: '7', ctrtQty: '1' }] },
  { key: 'files', label: '첨부', kind: 'other' as const, rows: [{ name: 'a' }] }
];
const item = (fields: Record<string, unknown>): DocumentItem => ({ stage: 'contract', identity: ['0000123', '00'], fields, userValues: { 담당: '합성 담당', 종결: false }, children, source: { url: 'https://www.g2b.go.kr/', framePath: 'top' } });

describe('Studio 1st-edition key rule', () => {
  it('rejects the empty-name and other keys Studio refuses, accepts Korean, spaces, dots and hyphens', () => {
    expect([studioKey(''), studioKey('ctrtNo#2'), studioKey('금액(원)'), studioKey('a.__proto__')]).toEqual([false, false, false, false]);
    expect([studioKey('계약번호'), studioKey('합계_금액'), studioKey('대표 품명'), studioKey('a.b-c')]).toEqual([true, true, true, true]);
  });
});

describe('only the record\'s stored values fill templates (user, 2026-10-08)', () => {
  it('counts the child rows that are left out', () => {
    expect(childRowCount(item({}))).toBe(3);
  });
  it('never takes a value from a child table, and computes no representative or total', () => {
    const plan = planFields(['계약물품명', 'ctrtQty', '합계_금액', '대표_ctrtItemNm', '품목수'], item({ ctrtNo: '1' }), labels);
    expect(plan.unmatched).toEqual(['계약물품명', 'ctrtQty', '합계_금액', '대표_ctrtItemNm', '품목수']);
    const keys = [...documentCandidates(item({ ctrtNo: '1' })).keys()];
    expect(keys).toEqual(['ctrtNo', '담당', '종결']);
  });
  it('uses the record value even when a child row has the same key', () => {
    expect(planFields(['ctrtAmt'], item({ ctrtAmt: '38400000' }), labels).values).toEqual({ ctrtAmt: '38400000' });
  });
});

describe('template field matching (user, 2026-10-07)', () => {
  const fields = { ctrtNo: '0000123', ctrtNm: '합성 건명', ctrtAmt: '38400000', dmstUntyGrpNm: '', 다른키: 'x', '': '화면 잔여', nested: { a: 1 }, long: 'x'.repeat(50000) };
  it('uses a saved link, then the same source key, then exactly one display label (recorded quietly)', () => {
    const plan = planFields(['ctrtNo', '계약금액', '담당부서', '수요기관명', '계약건명', '담당'], item(fields), labels, { 담당부서: 'dmstUntyGrpNm' });
    expect(plan.sources).toEqual({ ctrtNo: 'ctrtNo', 계약금액: 'ctrtAmt', 담당부서: 'dmstUntyGrpNm', 수요기관명: 'dmstUntyGrpNm', 담당: '담당' });
    expect(plan.learned).toEqual({ 계약금액: 'ctrtAmt', 수요기관명: 'dmstUntyGrpNm' });
    expect(plan.unmatched).toEqual(['계약건명']); // two source keys carry this label
    expect(plan.empty).toEqual(['담당부서', '수요기관명']);
  });
  it('asks when a name equals one source key and another key\'s label', () => {
    expect(planFields(['ctrtNo'], item({ ctrtNo: '1', other: '2' }), { other: 'ctrtNo' }).unmatched).toEqual(['ctrtNo']);
  });
  it('offers only values Studio accepts as candidates', () => {
    const keys = [...documentCandidates(item(fields)).keys()];
    expect(keys).toContain('ctrtNo'); expect(keys).toContain('담당');
    expect(keys.some(key => ['', 'nested', 'long'].includes(key))).toBe(false);
  });
});

describe('generation item', () => {
  const source = item({ ctrtNo: '0000123', ctrtAmt: '38400000', 담당: '원천 담당', '': '화면 잔여', nested: { a: 1 }, zero: 0, flag: false, blank: '' });
  const plan = planFields(['계약금액', '비고', '수요기관명'], source, { ...labels, blank: '수요기관명' });
  it('sends acceptable values, planned names and no child rows; empty planned values stay null until accepted', () => {
    const sent = generationItem(source, plan);
    expect(sent.children).toEqual([]);
    expect(sent.fields).toMatchObject({ ctrtNo: '0000123', 계약금액: '38400000', zero: 0, flag: false, blank: '', 수요기관명: null });
    expect(Object.hasOwn(sent.fields, '') || Object.hasOwn(sent.fields, 'nested') || Object.hasOwn(sent.fields, '비고')).toBe(false);
    expect(Object.hasOwn(sent.userValues, '담당')).toBe(false); // already sent as a source field: no FIELD_COLLISION
    expect(sent.userValues).toEqual({ 종결: false });
  });
  it('fills accepted empty values and names left blank, and drops colliding keys', () => {
    const sent = generationItem(source, plan, { acceptEmpty: true, blank: ['비고'], drop: ['ctrtNo'] });
    expect(sent.fields).toMatchObject({ 수요기관명: '', 비고: '' });
    expect(Object.hasOwn(sent.fields, 'ctrtNo')).toBe(false);
  });
});

describe('document strings by column type and format (#26)', () => {
  it('groups amounts, drops the percent sign and keeps numbers it cannot read', () => {
    expect(documentValue('881818182', 'money')).toBe('881,818,182');
    expect(documentValue(38400000, 'money')).toBe('38,400,000');
    expect(documentValue('1234.5', 'money')).toBe('1,234.5');
    expect(documentValue('1234.567', 'money', { decimals: 1 })).toBe('1,234.6');
    expect(documentValue('12345', 'number')).toBe('12345');
    expect(documentValue('12345', 'number', { grouping: true })).toBe('12,345');
    expect(documentValue('87.5%', 'percent')).toBe('87.5');
    expect(documentValue('금 일천원', 'money')).toBe('금 일천원');
  });
  it('writes dates and times in the merge workbook form unless the column chose a date format', () => {
    expect(documentValue('20261027', 'date')).toBe('2026. 10. 27.');
    expect(documentValue('2025-06-02', 'date')).toBe('2025. 6. 2.');
    expect(documentValue('2025/06/02 14:00:00', 'datetime')).toBe('2025. 6. 2. 14:00');
    expect(documentValue('2025-06-05 09:30', 'datetime')).toBe('2025. 6. 5. 09:30');
    expect(documentValue('20261027', 'date', { dateFormat: 'dash' })).toBe('2026-10-27');
    expect(documentValue('20250602 14:00', 'datetime', { dateFormat: 'dot' })).toBe('2025.06.02 14:00');
    expect([documentValue('20260230', 'date'), documentValue('2025-06-02 25:00', 'datetime'), documentValue('미정', 'date')]).toEqual(['20260230', '2025-06-02 25:00', '미정']);
  });
  it('leaves untyped values, identifiers, text, checks and empty values as they are', () => {
    expect([documentValue('0000123'), documentValue('0000123', 'text'), documentValue(false, 'money'), documentValue('', 'date'), documentValue(null, 'money'), documentValue(0, 'number')]).toEqual(['0000123', '0000123', false, '', null, '0']);
  });
  it('sends template values as document strings by their source key type, and lists what changed', () => {
    const source = item({ ctrtNo: '0000123', ctrtAmt: '38400000', ctrtDt: '20261027', 비고: '그대로' });
    const plan = planFields(['계약금액', 'ctrtDt', 'ctrtNo', '비고'], source, labels);
    const display = { columnTypes: { ctrtAmt: 'money' as const, ctrtDt: 'date' as const }, columnFormats: {} };
    const sent = generationItem(source, plan, { display });
    expect(sent.fields).toMatchObject({ 계약금액: '38,400,000', ctrtDt: '2026. 10. 27.', ctrtNo: '0000123', 비고: '그대로', ctrtAmt: '38400000' });
    expect(displayChanges(plan, display)).toEqual([['계약금액', '38400000', '38,400,000'], ['ctrtDt', '20261027', '2026. 10. 27.']]);
    expect(generationItem(source, plan).fields.계약금액).toBe('38400000');
  });
});

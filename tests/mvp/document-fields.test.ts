/** Public synthetic fixtures only. */
import { describe, expect, it } from 'vitest';
import { childRowCount, documentCandidates, excludedNames, generationItem, outputColumn, planFields, studioKey, type OutputKind } from '../../apps/mvp/document-fields';
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

describe('output rule (user, 2026-10-09, #46)', () => {
  const settings = { dictionary: { keys: { ctrtNo: '계약번호', blank: '' }, values: {} } };
  it('sends labelled columns, user columns and Helper-named columns by default; 속성 flips any column', () => {
    expect([outputColumn('ctrtNo', 'source', settings), outputColumn('ctrtAmt', 'source', settings), outputColumn('blank', 'source', settings)]).toEqual([true, false, false]);
    expect([outputColumn('메모', 'user', settings), outputColumn('업종제한', 'computed', settings), outputColumn('deptNm', 'computed', settings)]).toEqual([true, true, false]);
    const flipped = { ...settings, outputColumns: { ctrtNo: false, deptNm: true } };
    expect([outputColumn('ctrtNo', 'source', flipped), outputColumn('deptNm', 'computed', flipped)]).toEqual([false, true]);
  });
  it('sends only output columns, no empty values, false and N kept, computed values with the user values', () => {
    const source: DocumentItem = { ...item({ ctrtNo: '1', ctrtAmt: '2', lcnsLmtYn: 'N', flag: false, blank: '' }), computed: { 업종제한: '[A(1)] 업종', deptNm: '부서', 지체일수: '' } };
    const output = (key: string, kind: OutputKind) => outputColumn(key, kind, { dictionary: { keys: { ctrtNo: '계약번호', lcnsLmtYn: '업종제한 여부', flag: '체크' }, values: {} } });
    const sent = generationItem(source, planFields([], source, {}), { output });
    expect(sent.fields).toEqual({ ctrtNo: '1', lcnsLmtYn: 'N', flag: false });
    expect(sent.userValues).toEqual({ 담당: '합성 담당', 종결: false, 업종제한: '[A(1)] 업종' });
    expect([...documentCandidates(source, output).keys()]).toEqual(['ctrtNo', 'lcnsLmtYn', 'flag', '담당', '종결', '업종제한', '지체일수']);
    expect(excludedNames(['계약금액', 'deptNm', '없는 이름'], source, { ctrtAmt: '계약금액' }, output)).toEqual(['계약금액', 'deptNm']);
    // A saved link to an excluded column is not a match either: the hint is shown instead of an empty-value question.
    const linked = planFields(['번호', '금액'], source, {}, { 번호: 'ctrtAmt', 금액: 'missingKey' }, output);
    expect([linked.unmatched, linked.empty]).toEqual([['번호'], ['금액']]);
    expect(excludedNames(linked.unmatched, source, {}, output, { 번호: 'ctrtAmt' })).toEqual(['번호']);
  });
});

describe('generation item', () => {
  const source = item({ ctrtNo: '0000123', ctrtAmt: '38400000', 담당: '원천 담당', '': '화면 잔여', nested: { a: 1 }, zero: 0, flag: false, blank: '' });
  const plan = planFields(['계약금액', '비고', '수요기관명'], source, { ...labels, blank: '수요기관명' });
  it('sends acceptable values, planned names and no child rows; empty planned values stay null until accepted', () => {
    const sent = generationItem(source, plan);
    expect(sent.children).toEqual([]);
    expect(sent.fields).toMatchObject({ ctrtNo: '0000123', 계약금액: '38400000', zero: 0, flag: false, 수요기관명: null });
    expect(Object.hasOwn(sent.fields, 'blank')).toBe(false); // empty values are not sent (#46)
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

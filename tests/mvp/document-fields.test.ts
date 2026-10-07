/** Public synthetic fixtures only. */
import { describe, expect, it } from 'vitest';
import { documentCandidates, generationItem, planFields, studioKey, summarizeChildren } from '../../apps/mvp/document-fields';
import type { DocumentItem } from '../../apps/mvp/contracts';

const labels = { ctrtNo: '계약번호', ctrtNm: '계약건명', ctrtAmt: '계약금액', ctrtItemNm: '계약물품명', ctrtQty: '계약수량', ctrtUntVal: '단위', dmstUntyGrpNm: '수요기관명', 다른키: '계약건명' };
const items = (rows: Record<string, unknown>[]) => [{ key: 'items', label: '물품', kind: 'items' as const, rows }, { key: 'files', label: '첨부', kind: 'other' as const, rows: [{ name: 'a' }, { name: 'b' }] }];
const item = (fields: Record<string, unknown>, children = items([])): DocumentItem => ({ stage: 'contract', identity: ['0000123', '00'], fields, userValues: { 담당: '합성 담당', 종결: false }, children, source: { url: 'https://www.g2b.go.kr/', framePath: 'top' } });

describe('Studio 1st-edition key rule', () => {
  it('rejects the empty-name and other keys Studio refuses, accepts Korean, spaces, dots and hyphens', () => {
    expect([studioKey(''), studioKey('ctrtNo#2'), studioKey('금액(원)'), studioKey('a.__proto__')]).toEqual([false, false, false, false]);
    expect([studioKey('계약번호'), studioKey('합계_금액'), studioKey('대표 품명'), studioKey('a.b-c')]).toEqual([true, true, true, true]);
  });
});

describe('child table aggregation (user, 2026-10-07)', () => {
  const rows = [
    { ctrtItemSqno: '2', ctrtItemNm: '합성 둘', ctrtAmt: '1000', ctrtQty: '3', ctrtUntVal: '개' },
    { ctrtItemSqno: '1', ctrtItemNm: '합성 하나', ctrtAmt: '1000', ctrtQty: '2.5', ctrtUntVal: '박스', spec: { nested: true } },
    { ctrtItemSqno: '3', ctrtItemNm: '합성 셋', ctrtAmt: '999', ctrtQty: '1', ctrtUntVal: 'EA' }
  ];
  it('picks the largest amount (tie: smaller item order) with all its values, sums quantity across units and uses its unit', () => {
    const summary = summarizeChildren(item({}, items(rows)), labels);
    expect(summary).toMatchObject({ itemRows: 3, otherRows: 2 });
    expect(summary.values).toMatchObject({ 대표_ctrtItemSqno: '1', 대표_ctrtItemNm: '합성 하나', 대표_계약물품명: '합성 하나', 대표_계약금액: '1000', 합계_수량: '6.5', 합계_금액: '2999', 합계_단위: '박스', 품목수: 3 });
    expect(Object.hasOwn(summary.values, '대표_spec')).toBe(false);
  });
  it('keeps exact decimals and reports an unusable total as empty instead of guessing', () => {
    const big = summarizeChildren(item({}, items([{ ctrtAmt: '12345678901234567890.0001', ctrtQty: '1' }, { ctrtAmt: '1,000', ctrtQty: '' }])), labels).values;
    expect(big).toMatchObject({ 합계_금액: '12345678901234568890.0001', 합계_수량: null, 대표_ctrtAmt: '12345678901234567890.0001' });
    expect(summarizeChildren(item({}, items([{ ctrtAmt: '', ctrtQty: '0' }])), labels).values).toMatchObject({ 합계_수량: '0', 합계_금액: null, 합계_단위: null, 품목수: 1 });
    expect(summarizeChildren(item({}), labels)).toEqual({ values: {}, itemRows: 0, otherRows: 2 });
  });
});

describe('template field matching (user, 2026-10-07)', () => {
  const fields = { ctrtNo: '0000123', ctrtNm: '합성 건명', ctrtAmt: '38400000', dmstUntyGrpNm: '', 다른키: 'x', '': '화면 잔여', nested: { a: 1 } };
  it('uses a saved link, then the same source key, then exactly one display label (recorded quietly)', () => {
    const plan = planFields(['ctrtNo', '계약금액', '담당부서', '수요기관명', '계약건명', '담당', '합계_금액'], item(fields, items([{ ctrtAmt: '5' }])), labels, { 담당부서: 'dmstUntyGrpNm' });
    expect(plan.sources).toEqual({ ctrtNo: 'ctrtNo', 계약금액: 'ctrtAmt', 담당부서: 'dmstUntyGrpNm', 수요기관명: 'dmstUntyGrpNm', 담당: '담당', 합계_금액: '합계_금액' });
    expect(plan.learned).toEqual({ 계약금액: 'ctrtAmt', 수요기관명: 'dmstUntyGrpNm' });
    expect(plan.unmatched).toEqual(['계약건명']); // two source keys carry this label
    expect(plan.empty).toEqual(['담당부서', '수요기관명']);
  });
  it('asks when a name equals one source key and another key\'s label', () => {
    expect(planFields(['ctrtNo'], item({ ctrtNo: '1', other: '2' }), { other: 'ctrtNo' }).unmatched).toEqual(['ctrtNo']);
  });
  it('offers only values Studio accepts as candidates', () => {
    const keys = [...documentCandidates(item(fields), labels).keys()];
    expect(keys).toContain('ctrtNo'); expect(keys).toContain('담당');
    expect(keys.includes('') || keys.includes('nested')).toBe(false);
  });
});

describe('generation item', () => {
  const source = item({ ctrtNo: '0000123', ctrtAmt: '38400000', 담당: '원천 담당', '': '화면 잔여', nested: { a: 1 }, zero: 0, flag: false, blank: '' }, items([{ ctrtAmt: '1' }]));
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

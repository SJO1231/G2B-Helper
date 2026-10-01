import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { contractUserColumns, withContractValues } from '../../apps/mvp/user-fields';
import type { MvpSettings } from '../../apps/mvp/contracts';

const settings: MvpSettings = { theme: 'light', extractionMode: 'tables', hideEmptyColumns: true, hideUnmappedColumns: false, dictionary: { keys: {}, values: {} }, launchers: [] };
describe('contract user fields', () => {
  it('exposes contract-only inputs and derived columns', () => {
    expect(contractUserColumns).toEqual(['종결', '지정일', '지체일수', '종결금액', '미종결금액', '선금보증기한', '선금보증금액']);
    expect(withContractValues({}, {}, settings)).toMatchObject({ 종결: false, 지정일: '', 지체일수: '', 종결금액: '', 미종결금액: '', 선금보증기한: '', 선금보증금액: '' });
  });
  it.each([['20260228', '2026-03-01', 1], ['2024.02.29', '2024-03-01', 1], ['20261027', '2026.10.26', -1], ['2026-10-27', '20261027', 0]])('subtracts dates in UTC for %s and %s', (due, designated, difference) => {
    expect(withContractValues({ dlvgdsTermYmd: due }, { 지정일: designated }, settings).지체일수).toBe(difference);
  });
  it.each(['', '20260229', '2026-13-01', '2026.02-01', '2026-02-30', false, 0])('keeps invalid or absent date blank: %s', date => {
    expect(withContractValues({ dlvgdsTermYmd: '20261027' }, { 지정일: date }, settings).지체일수).toBe('');
  });
  it('calculates decimals without binary or default precision rounding', () => {
    const globalPrecision = Decimal.precision;
    const output = withContractValues({ ctrtAmt: '123456789012345678901234567890.123456789' }, { 종결금액: '0.023456788' }, settings);
    expect(output.미종결금액).toBe('123456789012345678901234567890.100000001');
    expect(Decimal.precision).toBe(globalPrecision);
    expect(withContractValues({ ctrtAmt: '0.3' }, { 종결금액: '0.1' }, settings).미종결금액).toBe('0.2');
  });
  it('preserves zero, false, negative remainder and unedited source fields', () => {
    const raw = { ctrtAmt: 0, quantity: 0, checked: false };
    const user = { 종결: false, 종결금액: 0 };
    expect(withContractValues(raw, user, settings)).toMatchObject({ ...raw, ...user, 미종결금액: '0' });
    expect(withContractValues({ ctrtAmt: '100' }, { 종결금액: '120' }, settings).미종결금액).toBe('-20');
    expect(withContractValues({ ctrtAmt: false }, { 종결금액: 0 }, settings).미종결금액).toBe('');
    expect(raw).toEqual({ ctrtAmt: 0, quantity: 0, checked: false }); expect(user).toEqual({ 종결: false, 종결금액: 0 });
  });
  it('treats blank completed amount as zero without changing the user input', () => {
    const user = { 종결금액: '' };
    expect(withContractValues({ ctrtAmt: '133,107,100' }, user, settings).미종결금액).toBe('133107100');
    expect(user.종결금액).toBe('');
    for (const value of ['bad', false, '1,00', 'Infinity']) expect(withContractValues({ ctrtAmt: '100' }, { 종결금액: value }, settings).미종결금액).toBe('');
  });
  it('uses explicit basis fields and recomputes rather than trusting stored derived values', () => {
    expect(withContractValues({ end: '20261027', amount: '1000.55' }, { 지정일: '20261028', 종결금액: '100.05', 지체일수: 999, 미종결금액: '999' }, { ...settings, contractEndField: 'end', contractAmountField: 'amount' })).toMatchObject({ 지체일수: 1, 미종결금액: '900.5' });
    expect(withContractValues({}, { 종결금액: '0' }, settings).미종결금액).toBe('');
  });
});

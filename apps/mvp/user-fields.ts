import Decimal from 'decimal.js';
import type { JsonRow, MvpSettings } from './contracts';

export const contractUserColumns = ['종결', '지정일', '지체일수', '종결금액', '미종결금액', '선금보증기한', '선금보증금액'];
/** Representative item and bundle totals the Native host fills on collection (#30); editable user columns. */
export const summaryColumns = ['대표 품명', '대표 단위', '합계 수량', '합계 금액', '품목 수'];
type ContractSettings = MvpSettings & { contractEndField?: string; contractAmountField?: string };
const defaults: JsonRow = { 종결: false, 지정일: '', 종결금액: '', 선금보증기한: '', 선금보증금액: '' };

function utcDate(value: unknown): number | undefined {
  if (typeof value !== 'string') return;
  const match = /^(\d{4})(?:(\d{2})(\d{2})|([.-])(\d{2})\4(\d{2}))$/.exec(value);
  if (!match) return;
  const year = Number(match[1]), month = Number(match[2] ?? match[5]), day = Number(match[3] ?? match[6]);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return;
  return date.getTime();
}

function money(value: unknown): string | undefined {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return;
  const text = String(value);
  return /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text) ? text.replaceAll(',', '') : undefined;
}

/** Derived display values are recomputed; caller-owned raw and user values remain unchanged. */
export function withContractValues(fields: JsonRow, userValues: JsonRow, settings: ContractSettings): JsonRow {
  const user = { ...defaults, ...userValues };
  const designated = utcDate(user.지정일), due = utcDate(fields[settings.contractEndField ?? 'dlvgdsTermYmd']);
  const amount = money(fields[settings.contractAmountField ?? 'ctrtAmt']);
  const completed = user.종결금액 === '' || user.종결금액 === undefined || user.종결금액 === null ? '0' : money(user.종결금액);
  let remaining = '';
  if (amount !== undefined && completed !== undefined) {
    const Exact = Decimal.clone({ precision: Math.max(32, amount.length + completed.length + 2) });
    remaining = new Exact(amount).minus(completed).toFixed();
  }
  return { ...fields, ...user, 지체일수: designated === undefined || due === undefined ? '' : (designated - due) / 86400000, 미종결금액: remaining };
}

import Decimal from 'decimal.js';
import type { DocumentItem, JsonRow, ProcurementStage } from './contracts';

/** Studio lite 1st-edition column-name rule (studio-lite core keyOK). Any other key makes Studio reject the whole item. */
export const studioKey = (key: string): boolean => /^[\p{L}\p{N}_][\p{L}\p{N}_ .-]{0,79}$/u.test(key) && !key.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part));
/** Single values Studio accepts (studio-lite core checkRecords: scalar, finite, shorter than 50,000 characters). */
const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length < 50000;
const empty = (value: unknown): boolean => value === undefined || value === null || value === '';

/** Item-table keys per stage, as they appear in the G2B captures (#21). Order keys follow the Native item keys. */
export const itemKeys: Record<ProcurementStage, { amount: string; quantity: string; unit: string; order: string[] }> = {
  receipt: { amount: 'ctrtDmndAmt', quantity: 'ctrtDmndQty', unit: 'qtyUntNm', order: ['ctrtDmndRcptItemSqno'] },
  bid: { amount: 'rowAmtSum', quantity: 'prchsDtlItemQty', unit: 'prchsDtlItemUntVal', order: ['bidClsfNo', 'bidPbancItemSqno'] },
  contract: { amount: 'ctrtAmt', quantity: 'ctrtQty', unit: 'ctrtUntVal', order: ['ctrtItemSqno'] }
};
const number = (value: unknown): Decimal | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? new Decimal(value) : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return /^[+-]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(text) ? new Decimal(text.replaceAll(',', '')) : undefined;
};

export interface ChildSummary { values: JsonRow; itemRows: number; otherRows: number; }
/**
 * Studio's 1st edition rejects child rows, so item rows go as aggregates (user, 2026-10-07):
 * representative = largest amount (ties: smaller item order) with all its values; quantities are summed
 * regardless of unit and the representative's unit is used. Other child tables are not sent.
 */
export function summarizeChildren(item: DocumentItem, labels: Record<string, string>): ChildSummary {
  const keys = itemKeys[item.stage];
  const rows = item.children.filter(child => child.kind === 'items').flatMap(child => child.rows);
  const otherRows = item.children.filter(child => child.kind !== 'items').reduce((count, child) => count + child.rows.length, 0);
  if (!rows.length) return { values: {}, itemRows: 0, otherRows };
  // Item order: each order key numerically when both are numbers, otherwise as text; then row position.
  const earlier = (a: JsonRow, ai: number, b: JsonRow, bi: number): boolean => {
    for (const key of keys.order) {
      const x = number(a[key]), y = number(b[key]);
      if (x && y) { if (!x.eq(y)) return x.lt(y); continue; }
      const sx = String(a[key] ?? ''), sy = String(b[key] ?? '');
      if (sx !== sy) return sx < sy;
    }
    return ai < bi;
  };
  let best: { row: JsonRow; amount: Decimal; index: number } | undefined;
  rows.forEach((row, index) => {
    const amount = number(row[keys.amount]); if (!amount) return;
    if (!best || amount.gt(best.amount) || amount.eq(best.amount) && earlier(row, index, best.row, best.index)) best = { row, amount, index };
  });
  const values: JsonRow = {};
  if (best) {
    const used = new Set(Object.keys(best.row).map(key => '대표_' + key));
    for (const [key, value] of Object.entries(best.row)) {
      if (!key || !scalar(value) || !studioKey('대표_' + key)) continue;
      values['대표_' + key] = value;
      const label = labels[key], name = '대표_' + label;
      if (label && !used.has(name) && Object.entries(best.row).filter(([other]) => labels[other] === label).length === 1) { values[name] = value; used.add(name); }
    }
  }
  const sum = (key: string): string | null => {
    const parts = rows.map(row => number(row[key])), valid = parts.filter((part): part is Decimal => !!part);
    if (valid.length !== parts.length) return null;
    // Decimal rounds results to 20 significant digits by default: allow the widest integer part plus the longest
    // fraction plus carry digits so the total stays exact.
    const integer = Math.max(...valid.map(part => part.abs().trunc().toFixed().length)), fraction = Math.max(...valid.map(part => part.decimalPlaces()));
    const Exact = Decimal.clone({ precision: integer + fraction + String(valid.length).length + 2 });
    return valid.reduce((total, part) => total.plus(part.toFixed()), new Exact(0)).toFixed();
  };
  values['합계_수량'] = sum(keys.quantity);
  values['합계_금액'] = sum(keys.amount);
  values['합계_단위'] = best && scalar(best.row[keys.unit]) ? best.row[keys.unit] as string | number | boolean | null : null;
  values['품목수'] = rows.length;
  return { values, itemRows: rows.length, otherRows };
}

interface Candidate { value: unknown; from: 'fields' | 'userValues' | 'summary'; }
/** Every value Studio can accept for this item, keyed by the name a template could use. */
export function documentCandidates(item: DocumentItem, labels: Record<string, string>): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();
  for (const [from, source] of [['fields', item.fields], ['userValues', item.userValues], ['summary', summarizeChildren(item, labels).values]] as const)
    for (const [key, value] of Object.entries(source)) if (studioKey(key) && scalar(value) && !candidates.has(key)) candidates.set(key, { value, from });
  return candidates;
}

export interface FieldPlan { values: Record<string, unknown>; sources: Record<string, string>; unmatched: string[]; empty: string[]; learned: Record<string, string>; }
/**
 * Match Studio's template field names to this item (user, 2026-10-07): saved link, then a source key of the
 * same name, then exactly one display label (its source key is recorded quietly). Unused keys are ignored.
 */
export function planFields(names: string[], item: DocumentItem, labels: Record<string, string>, links: Record<string, string> = {}): FieldPlan {
  const candidates = documentCandidates(item, labels), byLabel = new Map<string, string[]>();
  for (const key of candidates.keys()) { const label = labels[key]; if (label) byLabel.set(label, [...byLabel.get(label) || [], key]); }
  const plan: FieldPlan = { values: {}, sources: {}, unmatched: [], empty: [], learned: {} };
  for (const name of new Set(names)) {
    let source = links[name];
    const matches = [...new Set([...(candidates.has(name) ? [name] : []), ...byLabel.get(name) || []])];
    if (!source && matches.length === 1) { source = matches[0]; if (source !== name) plan.learned[name] = source; }
    if (!source) { plan.unmatched.push(name); continue; }
    plan.sources[name] = source; plan.values[name] = candidates.get(source)?.value;
    if (empty(plan.values[name])) plan.empty.push(name);
  }
  return plan;
}

/**
 * The item Studio receives: acceptable source values plus the planned template names. Child rows go only as
 * aggregates. Empty planned values are sent as '' only when the user accepted them; otherwise Studio reports them.
 */
export function generationItem(item: DocumentItem, plan: FieldPlan, options: { acceptEmpty?: boolean; blank?: string[]; drop?: string[] } = {}): DocumentItem {
  const drop = new Set(options.drop), keep = (source: JsonRow): JsonRow => Object.fromEntries(Object.entries(source).filter(([key, value]) => studioKey(key) && scalar(value) && !drop.has(key)));
  const fields = keep(item.fields);
  for (const [name, value] of Object.entries(plan.values)) if (!drop.has(name)) fields[name] = empty(value) ? (options.acceptEmpty ? '' : null) : value;
  for (const name of options.blank || []) if (plan.unmatched.includes(name) && !drop.has(name)) fields[name] = '';
  const userValues = Object.fromEntries(Object.entries(keep(item.userValues)).filter(([key]) => !Object.hasOwn(fields, key)));
  return { stage: item.stage, identity: item.identity, fields, userValues, children: [], source: item.source };
}

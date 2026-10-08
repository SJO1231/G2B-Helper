import type { DocumentItem, JsonRow, MvpColumnFormat, MvpColumnType, MvpSettings } from './contracts';
import { dateParts, formatValue } from './grid-model';

/** Studio lite 1st-edition column-name rule (studio-lite core keyOK). Any other key makes Studio reject the whole item. */
export const studioKey = (key: string): boolean => /^[\p{L}\p{N}_][\p{L}\p{N}_ .-]{0,79}$/u.test(key) && !key.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part));
/** Single values Studio accepts (studio-lite core checkRecords: scalar, finite, shorter than 50,000 characters). */
const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length < 50000;
const empty = (value: unknown): boolean => value === undefined || value === null || value === '';
const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined => map && Object.hasOwn(map, key) ? map[key] : undefined;
const numeric = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
const sameText = (left: unknown, right: unknown): boolean => String(left) === String(right);

/**
 * The string a document prints for a typed Helper column (#26). Values are document strings (contract-list-manager
 * principle): amounts with digit grouping and every stored digit kept (no rounding, so Studio still refuses decimal
 * money), a ratio without '%', and dates in the merge workbook's form (2025. 6. 2. / 2025. 6. 2. 14:00) unless the
 * column chose the dash or compact date form. Untyped, text, check, zero-padded and unreadable values are sent
 * unchanged; nothing is guessed.
 */
export function documentValue(value: unknown, type?: MvpColumnType, format: MvpColumnFormat = {}): unknown {
  if (empty(value) || typeof value === 'boolean' || typeof value === 'object') return value;
  if (type === 'money' || type === 'number' || type === 'percent') {
    const text = type === 'percent' ? String(value).trim().replace(/%$/, '') : String(value).trim();
    return numeric.test(text) && !/^[+-]?0\d/.test(text) ? formatValue(text, type === 'percent' ? 'number' : type, { grouping: format.grouping }) : value;
  }
  if (type === 'date' || type === 'datetime') {
    const text = String(value).trim().replace(/^(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3');
    const time = type === 'datetime' ? /^(\S+)[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(text) : null;
    const parts = dateParts(time ? time[1] : text);
    if (!parts || time && (Number(time[2]) > 23 || Number(time[3]) > 59 || Number(time[4] || '0') > 59)) return value;
    // The column format window shows the dot form even when nothing was chosen, so only dash and compact override the merge form.
    const day = format.dateFormat === 'dash' || format.dateFormat === 'compact' ? parts.join(format.dateFormat === 'dash' ? '-' : '') : `${parts[0]}. ${Number(parts[1])}. ${Number(parts[2])}.`;
    return time ? `${day} ${time[2]}:${time[3]}` : day;
  }
  return value;
}
export type DocumentDisplay = Pick<MvpSettings, 'columnTypes' | 'columnFormats'>;
const shownValue = (plan: FieldPlan, name: string, display: DocumentDisplay | undefined, raw: string[] = []): unknown =>
  raw.includes(name) ? plan.values[name] : documentValue(plan.values[name], own(display?.columnTypes, plan.sources[name]), own(display?.columnFormats, plan.sources[name]));
/** Planned template values whose document string differs from the stored value: [template name, stored, document]. */
export const displayChanges = (plan: FieldPlan, display: DocumentDisplay, raw: string[] = []): [string, unknown, unknown][] =>
  Object.entries(plan.values).flatMap(([name, value]): [string, unknown, unknown][] => { const shown = shownValue(plan, name, display, raw); return sameText(shown, value) ? [] : [[name, value, shown]]; });

/** Child rows are not sent (user, 2026-10-08); the dialog shows how many are left out. */
export const childRowCount = (item: DocumentItem): number => item.children.reduce((count, child) => count + child.rows.length, 0);

/**
 * Every value Studio can accept for this item, keyed by the name a template could use. Only the record's own
 * stored values (including user edits and user columns) are candidates; child tables are not (user, 2026-10-08).
 */
export function documentCandidates(item: DocumentItem): Map<string, unknown> {
  const candidates = new Map<string, unknown>();
  for (const source of [item.fields, item.userValues])
    for (const [key, value] of Object.entries(source)) if (studioKey(key) && scalar(value) && !candidates.has(key)) candidates.set(key, value);
  return candidates;
}

export interface FieldPlan { values: Record<string, unknown>; sources: Record<string, string>; unmatched: string[]; empty: string[]; learned: Record<string, string>; }
/**
 * Match Studio's template field names to this item (user, 2026-10-07): saved link, then a source key of the
 * same name, then exactly one display label (its source key is recorded quietly). Unused keys are ignored.
 */
export function planFields(names: string[], item: DocumentItem, labels: Record<string, string>, links: Record<string, string> = {}): FieldPlan {
  const candidates = documentCandidates(item), byLabel = new Map<string, string[]>();
  for (const key of candidates.keys()) { const label = labels[key]; if (label) byLabel.set(label, [...byLabel.get(label) || [], key]); }
  const plan: FieldPlan = { values: {}, sources: {}, unmatched: [], empty: [], learned: {} };
  for (const name of new Set(names)) {
    let source = links[name];
    const matches = [...new Set([...(candidates.has(name) ? [name] : []), ...byLabel.get(name) || []])];
    if (!source && matches.length === 1) { source = matches[0]; if (source !== name) plan.learned[name] = source; }
    if (!source) { plan.unmatched.push(name); continue; }
    plan.sources[name] = source; plan.values[name] = candidates.get(source);
    if (empty(plan.values[name])) plan.empty.push(name);
  }
  return plan;
}

/**
 * The item Studio receives: acceptable stored values plus the planned template names as document strings, and no child rows.
 * Names Studio reported only for Block conditions (`raw`) keep their stored value, because conditions compare raw values.
 * Empty planned values are sent as '' only when the user accepted them; otherwise Studio reports them.
 */
export function generationItem(item: DocumentItem, plan: FieldPlan, options: { acceptEmpty?: boolean; blank?: string[]; drop?: string[]; display?: DocumentDisplay; raw?: string[] } = {}): DocumentItem {
  const drop = new Set(options.drop), keep = (source: JsonRow): JsonRow => Object.fromEntries(Object.entries(source).filter(([key, value]) => studioKey(key) && scalar(value) && !drop.has(key)));
  const fields = keep(item.fields);
  for (const [name, value] of Object.entries(plan.values)) if (!drop.has(name)) fields[name] = empty(value) ? (options.acceptEmpty ? '' : null) : shownValue(plan, name, options.display, options.raw);
  for (const name of options.blank || []) if (plan.unmatched.includes(name) && !drop.has(name)) fields[name] = '';
  const userValues = Object.fromEntries(Object.entries(keep(item.userValues)).filter(([key]) => !Object.hasOwn(fields, key)));
  return { stage: item.stage, identity: item.identity, fields, userValues, children: [], source: item.source };
}

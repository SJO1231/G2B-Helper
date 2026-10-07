import type { DocumentItem, JsonRow } from './contracts';

/** Studio lite 1st-edition column-name rule (studio-lite core keyOK). Any other key makes Studio reject the whole item. */
export const studioKey = (key: string): boolean => /^[\p{L}\p{N}_][\p{L}\p{N}_ .-]{0,79}$/u.test(key) && !key.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part));
/** Single values Studio accepts (studio-lite core checkRecords: scalar, finite, shorter than 50,000 characters). */
const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length < 50000;
const empty = (value: unknown): boolean => value === undefined || value === null || value === '';

/** Child rows are not sent (user, 2026-10-08); the dialog shows how many are left out. */
export const childRowCount = (item: DocumentItem): number => item.children.reduce((count, child) => count + child.rows.length, 0);

interface Candidate { value: unknown; from: 'fields' | 'userValues'; }
/**
 * Every value Studio can accept for this item, keyed by the name a template could use. Only the record's own
 * stored values (including user edits and user columns) are candidates; child tables are not (user, 2026-10-08).
 */
export function documentCandidates(item: DocumentItem): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();
  for (const [from, source] of [['fields', item.fields], ['userValues', item.userValues]] as const)
    for (const [key, value] of Object.entries(source)) if (studioKey(key) && scalar(value) && !candidates.has(key)) candidates.set(key, { value, from });
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
    plan.sources[name] = source; plan.values[name] = candidates.get(source)?.value;
    if (empty(plan.values[name])) plan.empty.push(name);
  }
  return plan;
}

/**
 * The item Studio receives: acceptable stored values plus the planned template names, and no child rows.
 * Empty planned values are sent as '' only when the user accepted them; otherwise Studio reports them.
 */
export function generationItem(item: DocumentItem, plan: FieldPlan, options: { acceptEmpty?: boolean; blank?: string[]; drop?: string[] } = {}): DocumentItem {
  const drop = new Set(options.drop), keep = (source: JsonRow): JsonRow => Object.fromEntries(Object.entries(source).filter(([key, value]) => studioKey(key) && scalar(value) && !drop.has(key)));
  const fields = keep(item.fields);
  for (const [name, value] of Object.entries(plan.values)) if (!drop.has(name)) fields[name] = empty(value) ? (options.acceptEmpty ? '' : null) : value;
  for (const name of options.blank || []) if (plan.unmatched.includes(name) && !drop.has(name)) fields[name] = '';
  const userValues = Object.fromEntries(Object.entries(keep(item.userValues)).filter(([key]) => !Object.hasOwn(fields, key)));
  return { stage: item.stage, identity: item.identity, fields, userValues, children: [], source: item.source };
}

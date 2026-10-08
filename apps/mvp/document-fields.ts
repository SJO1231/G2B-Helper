import type { DocumentItem, JsonRow, MvpSettings } from './contracts';

/** Studio lite 1st-edition column-name rule (studio-lite core keyOK). Any other key makes Studio reject the whole item. */
export const studioKey = (key: string): boolean => /^[\p{L}\p{N}_][\p{L}\p{N}_ .-]{0,79}$/u.test(key) && !key.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part));
/** Single values Studio accepts (studio-lite core checkRecords: scalar, finite, shorter than 50,000 characters). */
const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length < 50000;
const empty = (value: unknown): boolean => value === undefined || value === null || value === '';

/** Child rows are not sent (user, 2026-10-08); the dialog shows how many are left out. */
export const childRowCount = (item: DocumentItem): number => item.children.reduce((count, child) => count + child.rows.length, 0);

export type OutputKind = 'source' | 'user' | 'computed';
export type Output = (key: string, kind: OutputKind) => boolean;
/** Helper-made columns whose own name is their label: the 업종제한 sentence (#45) and the contract calculations. */
const helperNamed = new Set(['업종제한', '지체일수', '미종결금액']);
/**
 * Output rule (user, 2026-10-09, #46): a column with a label goes to documents and one without does not; the 속성 panel's
 * '출력 제외' flips any source, user or computed column. A user column's name is its label. View hiding and filters do not count.
 */
export function outputColumn(key: string, kind: OutputKind, settings: Pick<MvpSettings, 'dictionary' | 'outputColumns'>): boolean {
  if (settings.outputColumns && Object.hasOwn(settings.outputColumns, key)) return settings.outputColumns[key];
  return kind === 'user' || helperNamed.has(key) || !!(Object.hasOwn(settings.dictionary.keys, key) && settings.dictionary.keys[key]);
}
const everything: Output = () => true;
/** The contract's default user columns are always defined; removing one never removes its values. */
export const contractUserColumnsGuard = (stage: string, name: string): boolean => stage === 'contract' && ['종결', '지정일', '지체일수', '종결금액', '미종결금액', '선금보증기한', '선금보증금액'].includes(name);
const sources = (item: DocumentItem): [JsonRow, OutputKind][] => [[item.fields, 'source'], [item.userValues, 'user'], [item.computed || {}, 'computed']];

/**
 * Every value Studio can accept for this item, keyed by the name a template could use. Only the record's own
 * stored values (including user edits and user columns) and its computed columns are candidates, and only the
 * output columns (#46); child tables are not (user, 2026-10-08).
 */
export function documentCandidates(item: DocumentItem, output: Output = everything): Map<string, unknown> {
  const candidates = new Map<string, unknown>();
  for (const [source, kind] of sources(item))
    for (const [key, value] of Object.entries(source)) if (studioKey(key) && scalar(value) && output(key, kind) && !candidates.has(key)) candidates.set(key, value);
  return candidates;
}

/** Template names that only an output-excluded column with a value could fill: the user is told to label or include it (#46). */
export function excludedNames(names: string[], item: DocumentItem, labels: Record<string, string>, output: Output): string[] {
  return names.filter(name => sources(item).some(([source, kind]) => Object.entries(source).some(([key, value]) => (key === name || labels[key] === name) && !output(key, kind) && !empty(value))));
}

export interface FieldPlan { values: Record<string, unknown>; sources: Record<string, string>; unmatched: string[]; empty: string[]; learned: Record<string, string>; }
/**
 * Match Studio's template field names to this item (user, 2026-10-07): saved link, then a source key of the
 * same name, then exactly one display label (its source key is recorded quietly). Unused keys are ignored.
 */
export function planFields(names: string[], item: DocumentItem, labels: Record<string, string>, links: Record<string, string> = {}, output: Output = everything): FieldPlan {
  const candidates = documentCandidates(item, output), byLabel = new Map<string, string[]>();
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
 * The item Studio receives: the output columns' non-empty values (#46) plus the planned template names, and no child
 * rows; computed columns travel with the user values. Empty planned values are sent as '' only when the user accepted
 * them; otherwise Studio reports them.
 */
export function generationItem(item: DocumentItem, plan: FieldPlan, options: { acceptEmpty?: boolean; blank?: string[]; drop?: string[]; output?: Output } = {}): DocumentItem {
  const drop = new Set(options.drop), output = options.output || everything;
  const keep = (source: JsonRow, kind: OutputKind): JsonRow => Object.fromEntries(Object.entries(source).filter(([key, value]) => studioKey(key) && scalar(value) && !empty(value) && !drop.has(key) && output(key, kind)));
  const fields = keep(item.fields, 'source');
  for (const [name, value] of Object.entries(plan.values)) if (!drop.has(name)) fields[name] = empty(value) ? (options.acceptEmpty ? '' : null) : value;
  for (const name of options.blank || []) if (plan.unmatched.includes(name) && !drop.has(name)) fields[name] = '';
  const userValues = Object.fromEntries(Object.entries({ ...keep(item.computed || {}, 'computed'), ...keep(item.userValues, 'user') }).filter(([key]) => !Object.hasOwn(fields, key)));
  return { stage: item.stage, identity: item.identity, fields, userValues, children: [], source: item.source };
}

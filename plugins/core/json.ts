import type { JsonPresentation } from '../../packages/contracts/src/index';

export const isBlank = (value: unknown): boolean => value == null || (typeof value === 'string' && value.trim() === '');
export function getPath(value: unknown, path: string[] = []): unknown {
  let cursor = value;
  for (const segment of path) {
    if (['__proto__','prototype','constructor'].includes(segment) || cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor, segment)) return undefined;
    cursor = (cursor as Record<string,unknown>)[segment];
  }
  return cursor;
}
export function jsonSummary(value: unknown): string {
  if (value === undefined) return '(누락)';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `배열 · ${value.length}개`;
  if (typeof value === 'object') return `객체 · ${Object.keys(value).length}개 필드`;
  return String(value);
}
export function projectJson(value: unknown, presentation: JsonPresentation): unknown {
  const selected = getPath(value, presentation.path ?? []);
  if (presentation.mode === 'summary') return jsonSummary(selected);
  if (presentation.mode === 'raw') return selected === undefined ? presentation.missingLabel ?? '(누락)' : JSON.stringify(selected, null, 2);
  if (presentation.mode === 'array') {
    if (!Array.isArray(selected)) throw new Error('선택한 JSON 경로는 배열이 아닙니다.');
    return selected.map(entry => typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? {...entry} : {value:entry});
  }
  return selected;
}
export function projectRows(rows: Record<string,unknown>[], options: {hideEmptyRows?:boolean;hideEmptyColumns?:boolean}, keyLabels?:Record<string,string>) {
  const columns = [...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!key.startsWith('__'));
  const allowed = keyLabels ? columns.filter(key=>!!keyLabels[key]) : columns;
  const visibleRows = options.hideEmptyRows ? rows.filter(row=>allowed.some(key=>!isBlank(row[key]))) : [...rows];
  const fields = options.hideEmptyColumns ? allowed.filter(key=>visibleRows.some(row=>!isBlank(row[key]))) : allowed;
  return {fields,columns:fields,rows:visibleRows.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]])))};
}

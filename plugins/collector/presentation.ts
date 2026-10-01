import type { CapturePayload } from '../../packages/contracts/src/index';
export type ExtractionMode = 'mappedTables' | 'mappedAll' | 'allTables' | 'all';
export interface ExtractionOptions { mode: ExtractionMode; hideEmptyTables: boolean; hideEmptyRows: boolean; hideEmptyColumns: boolean; }
export const defaultExtractionOptions: ExtractionOptions = { mode: 'mappedTables', hideEmptyTables: true, hideEmptyRows: true, hideEmptyColumns: true };
export function isDisplayEmpty(value: unknown): boolean { return value == null || typeof value === 'string' && value.trim() === ''; }
export function presentCapture(payload: CapturePayload, labels: Record<string, string>, options: ExtractionOptions) {
  const mappedOnly = options.mode === 'mappedTables' || options.mode === 'mappedAll';
  const tables: { source: string; columns: string[]; rows: Record<string, unknown>[] }[] = [];
  for (const [source, originalRows] of Object.entries(payload.tables)) {
    if (!Array.isArray(originalRows)) continue;
    let columns = [...new Set(originalRows.flatMap(row => Object.keys(row)))];
    if (mappedOnly) columns = columns.filter(key => !!labels[key]?.trim());
    let rows = originalRows.slice();
    if (options.hideEmptyRows) rows = rows.filter(row => columns.some(key => !isDisplayEmpty(row[key])));
    if (options.hideEmptyColumns) columns = columns.filter(key => rows.some(row => !isDisplayEmpty(row[key])));
    if (options.hideEmptyTables && (!rows.length || !columns.length)) continue;
    if (mappedOnly && !columns.length) continue;
    tables.push({ source, columns, rows: rows.map(row => Object.fromEntries(columns.map(key => [key, row[key]]))) });
  }
  const pointInfo = options.mode === 'mappedAll' || options.mode === 'all'
    ? Object.fromEntries(Object.entries(payload.pointInfo).filter(([key]) => !mappedOnly || !!labels[key]?.trim())) : {};
  return { tables, pointInfo };
}


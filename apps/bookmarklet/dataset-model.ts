import type { ColumnDefinition, TableRow } from '../../packages/contracts/src/index';
import type { LocalDocument, PrototypeDataset } from './contracts';
import { putDocument, validatePrototypeValue } from './storage';

export function inferColumns(rows: Record<string, unknown>[]): ColumnDefinition[] {
  return [...new Set(rows.flatMap(row => Object.keys(row)))].filter(field => !field.startsWith('__')).map(field => ({
    field, label: field, kind: rows.some(row => row[field] !== null && typeof row[field] === 'object') ? 'json' : rows.some(row => typeof row[field] === 'boolean') ? 'boolean' : 'text',
  }));
}
export function makeRows(rows: Record<string, unknown>[]): TableRow[] {
  return rows.map(row => ({ ...structuredClone(row), __rowId: crypto.randomUUID(), __storeVersion: 1 }));
}
export async function createLocalDataset(name: string, rows: Record<string, unknown>[] = [], columns = inferColumns(rows), category: PrototypeDataset['category'] = 'reference'): Promise<LocalDocument<PrototypeDataset>> {
  const value: PrototypeDataset = { name: name.trim(), category, columns, rows: makeRows(rows) };
  validateDataset(value);
  return putDocument('datasets', crypto.randomUUID(), null, value);
}
export function validateDataset(value: PrototypeDataset): void {
  validatePrototypeValue('datasets', value as unknown as Record<string, unknown>);
  for (const row of value.rows) for (const column of value.columns) {
    const cell = row[column.field];
    if (cell === '' || cell == null) { if (column.required) throw new Error(`${column.label}: 필수값입니다.`); continue; }
    const text = String(cell);
    if (column.kind === 'integer' && !/^[+-]?\d+$/.test(text)) throw new Error(`${column.label}: 정수만 입력하세요.`);
    if (column.kind === 'decimal' && !/^[+-]?\d+(\.\d+)?$/.test(text)) throw new Error(`${column.label}: 소수 값 형식을 확인하세요.`);
    if (column.kind === 'boolean' && typeof cell !== 'boolean') throw new Error(`${column.label}: true 또는 false를 입력하세요.`);
    if (column.kind === 'json' && typeof cell !== 'object') throw new Error(`${column.label}: JSON 형식을 확인하세요.`);
    if (column.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) throw new Error(`${column.label}: 올바른 날짜를 입력하세요.`);
  }
}
export function mergeVisibleRows(previous: TableRow[], incoming: TableRow[], deleted: string[] = []): TableRow[] {
  const removed = new Set(deleted), replacements = new Map(incoming.map(row => [row.__rowId, row]));
  const existing = new Set(previous.map(row => row.__rowId));
  const sanitize = (row: TableRow) => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__virtual'))) as TableRow;
  return [...previous.filter(row => !removed.has(row.__rowId)).map(row => sanitize({ ...row, ...replacements.get(row.__rowId) })), ...incoming.filter(row => !existing.has(row.__rowId) && !removed.has(row.__rowId)).map(sanitize)];
}

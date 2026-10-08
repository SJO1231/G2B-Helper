import Decimal from 'decimal.js';
import type { JsonRow, MvpColumnType, MvpColumnFormat, MvpSettings, GridFilter } from './contracts';
export type { GridFilter } from './contracts';

export interface GridView { search: string; combine: 'and' | 'or'; filters: Map<string, GridFilter>; }
export interface GridColumn { key: string; field: string; user: boolean; }
export type GridBufferRow = Record<string, unknown> & { _mvpRow: number };
export const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === '';
export const rawText = (value: unknown): string => value === undefined ? '' : value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export const valueToken = (value: unknown): string => JSON.stringify([value === undefined ? 'missing' : value === null ? 'null' : typeof value, value]);
export const choiceText = (value: unknown): string => value === undefined ? '(누락)' : value === null ? '(null)' : value === '' ? '(빈 셀)' : rawText(value);
const own = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
export const dateColumnKeys = (rows: JsonRow[], settings: MvpSettings): string[] => [...new Set(rows.flatMap(Object.keys))].filter(key => own(settings.columnTypes || {}, key) && ['date', 'datetime'].includes(settings.columnTypes![key]));

/** A child table shows its row count and opens on click (user, 2026-10-09, #44); other nested values show as JSON. */
export const nestedPreview = (value: unknown): string => Array.isArray(value) ? '표 ' + value.length + '줄' : rawText(value);

/** Excel TSV supports quoted tabs/newlines and escaped quotes; CRLF is a row separator. */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let value = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else if (quoted || value === '') quoted = !quoted;
      else value += char;
    } else if (!quoted && char === '\t') { row.push(value); value = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(value); rows.push(row.splice(0)); value = '';
    } else value += char;
  }
  if (quoted) throw new Error('붙여넣은 텍스트의 따옴표가 닫히지 않았습니다.');
  if (value || row.length || !rows.length || !/[\r\n]$/.test(text)) { row.push(value); rows.push(row); }
  return rows;
}

export function dateParts(text: string): [string, string, string] | undefined {
  const match = /^(\d{4})(?:(\d{2})(\d{2})|([.-])(\d{2})\4(\d{2}))$/.exec(text);
  if (!match) return;
  const parts: [string, string, string] = [match[1], match[2] ?? match[5], match[3] ?? match[6]];
  const [year, month, day] = parts.map(Number), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return;
  return parts;
}
function numericText(text: string): string | undefined {
  const trimmed = text.trim();
  return /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(trimmed) ? trimmed.replaceAll(',', '') : undefined;
}
function timeParts(text: string): { date: [string, string, string]; time: string } | undefined {
  const match = /^(\d{8}|\d{4}([.-])\d{2}\2\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/.exec(text);
  if (!match) return;
  const date = dateParts(match[1]);
  if (!date || Number(match[3]) > 23 || Number(match[4]) > 59 || Number(match[5] || '0') > 59) return;
  return { date, time: match[3] + ':' + match[4] + ':' + (match[5] || '00') + (match[6] || '') };
}
export function compareValues(a: unknown, b: unknown, type?: MvpColumnType): number {
  const left = rawText(a), right = rawText(b);
  if (['number', 'money', 'percent'].includes(type || '')) {
    const x = typeof a === 'number' && Number.isFinite(a) ? left : numericText(left.replace(/%$/, ''));
    const y = typeof b === 'number' && Number.isFinite(b) ? right : numericText(right.replace(/%$/, ''));
    if (x !== undefined && y !== undefined) return new Decimal(x).cmp(y);
    if (x !== undefined || y !== undefined) return x === undefined ? 1 : -1;
    return left.localeCompare(right, undefined, { numeric: true });
  }
  if (type === 'date') {
    const x = dateParts(left), y = dateParts(right);
    if (x && y) return x.join('').localeCompare(y.join(''));
    if (x || y) return x ? -1 : 1;
    return left.localeCompare(right, undefined, { numeric: true });
  }
  if (type === 'datetime') {
    const x = timeParts(left), y = timeParts(right);
    if (x && y) return (x.date.join('') + x.time.slice(0, 8)).localeCompare(y.date.join('') + y.time.slice(0, 8)) || new Decimal('0' + x.time.slice(8)).cmp('0' + y.time.slice(8));
    if (x || y) return x ? -1 : 1;
    return left.localeCompare(right, undefined, { numeric: true });
  }
  return typeof a === 'number' && typeof b === 'number' ? a - b : left.localeCompare(right, undefined, { numeric: true });
}
export function formatValue(value: unknown, type?: MvpColumnType, format: MvpColumnFormat = {}): string {
  const text = rawText(value);
  if (['number', 'money', 'percent'].includes(type || '')) {
    let number = numericText(type === 'percent' ? text.replace(/%$/, '') : text);
    if (number !== undefined) {
      if (format.decimals !== undefined) number = new Decimal(number).toFixed(format.decimals, Decimal.ROUND_HALF_UP);
      const match = /^([+-]?)(\d+)(\.\d+)?$/.exec(number)!;
      return match[1] + ((format.grouping ?? type === 'money') ? match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : match[2]) + (match[3] || '') + (type === 'percent' ? '%' : '');
    }
  }
  if (type === 'date' || type === 'datetime') {
    const timestamp = type === 'datetime' ? timeParts(text) : undefined;
    const parts = timestamp?.date ?? dateParts(text);
    if (parts) return parts.join(format.dateFormat === 'dash' ? '-' : format.dateFormat === 'compact' ? '' : '.') + (timestamp ? ' ' + timestamp.time : '');
  }
  return text;
}

/** A typed decimal is retained as text rather than rounded through binary Number. */
export function editedValue(text: string, previous: unknown, type?: MvpColumnType): unknown {
  if (text === '' || type === 'text') return text;
  if (type === 'date' || type === 'datetime') {
    if (!(type === 'date' ? dateParts(text) : timeParts(text))) throw new Error(type === 'date' ? '날짜는 유효한 YYYY.MM.DD, YYYY-MM-DD 또는 YYYYMMDD로 입력하세요.' : '날짜·시간은 유효한 YYYY-MM-DD HH:mm:ss로 입력하세요.');
    return text;
  }
  if (type === 'money' || type === 'number' || type === 'percent') {
    const number = numericText(type === 'percent' ? text.replace(/%$/, '') : text);
    if (number === undefined) throw new Error('숫자와 소수점을 입력하세요. 쉼표는 세 자리씩 구분하세요.');
    return number;
  }
  if (type === 'boolean' || typeof previous === 'boolean') {
    if (text === 'true' || text === 'false') return type === 'boolean' && typeof previous === 'string' ? text : text === 'true';
    throw new Error('불리언 값은 true 또는 false로 입력하세요.');
  }
  if (typeof previous === 'number') {
    if (!/^[+-]?\d+(\.\d+)?$/.test(text)) throw new Error('숫자를 입력하세요.');
    if (/^[+-]?(0|[1-9]\d*)$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
  }
  return text;
}

/** Excel numbers have only 15 significant digits; identifiers and precise decimals stay text. */
export function excelValue(value: unknown, type?: MvpColumnType): unknown {
  if (value !== null && typeof value === 'object') return rawText(value);
  if (!['number', 'money', 'percent'].includes(type || '') || typeof value !== 'string') return value;
  const text = numericText(value.replace(/%$/, ''));
  if (text === undefined || /^[+-]?0\d/.test(text) || text.replace(/[^\d]/g, '').replace(/^0+/, '').length > 15) return value;
  const number = Number(text);
  return Number.isFinite(number) && new Decimal(text).eq(String(number)) ? number : value;
}
export function excelFormat(type?: MvpColumnType, format: MvpColumnFormat = {}): string {
  if (!['number', 'money', 'percent'].includes(type || '')) return '@';
  return ((format.grouping ?? type === 'money') ? '#,##0' : '0') + (format.decimals === undefined ? '.####################' : format.decimals ? '.' + '0'.repeat(format.decimals) : '') + (type === 'percent' ? '"%"' : '');
}

export function matchesColumn(row: JsonRow, key: string, filter: GridFilter): boolean {
  if (filter.mode === 'values') return filter.values.includes(valueToken(row[key]));
  const text = rawText(row[key]).toLocaleLowerCase();
  const terms = filter.terms.map(term => term.toLocaleLowerCase());
  return filter.mode === 'exact' ? terms.some(term => text === term)
    : filter.mode === 'includes' ? terms.some(term => text.includes(term))
    : !terms.some(term => text.includes(term));
}
export function matchesView(row: JsonRow, view: GridView): boolean {
  if (view.search && !Object.values(row).some(value => rawText(value).toLocaleLowerCase().includes(view.search.toLocaleLowerCase()))) return false;
  const results = [...view.filters].map(([key, rule]) => matchesColumn(row, key, rule));
  return !results.length || (view.combine === 'or' ? results.some(Boolean) : results.every(Boolean));
}

export class GridModel {
  readonly columns: GridColumn[] = [];
  readonly originalIds = new Set<number>();
  private nextField = 0;
  private nextRow = 0;
  constructor(rows: JsonRow[], userColumnKeys: string[] = []) {
    const users = new Set(userColumnKeys);
    for (const key of new Set([...rows.flatMap(row => Object.keys(row)), ...userColumnKeys])) {
      this.columns.push({ key, field: 'f' + this.nextField++, user: users.has(key) });
    }
  }
  label(column: GridColumn, settings: MvpSettings): string {
    return own(settings.dictionary.keys, column.key) ? settings.dictionary.keys[column.key] : column.key || '(빈 키)';
  }
  encode(rows: JsonRow[]): GridBufferRow[] {
    return structuredClone(rows).map(row => {
      const id = this.nextRow++;
      this.originalIds.add(id);
      return Object.fromEntries([['_mvpRow', id], ...this.columns.filter(column => own(row, column.key)).map(column => [column.field, row[column.key]])]) as GridBufferRow;
    });
  }
  slots(count: number): GridBufferRow[] {
    return Array.from({ length: count }, () => Object.fromEntries([['_mvpRow', this.nextRow++], ...this.columns.map(column => [column.field, ''])]) as GridBufferRow);
  }
  blankSlot(row: GridBufferRow): boolean {
    return !this.originalIds.has(row._mvpRow) && this.columns.every(column => isEmpty(row[column.field]));
  }
  decode(row: GridBufferRow): JsonRow {
    return Object.fromEntries(this.columns.filter(column => own(row, column.field)).map(column => [column.key, structuredClone(row[column.field])]));
  }
  rows(buffer: GridBufferRow[]): JsonRow[] { return buffer.filter(row => !this.blankSlot(row)).map(row => this.decode(row)); }
  addColumn(key: string): GridColumn {
    if (!key.trim()) throw new Error('사용자 열의 이름을 입력하세요.');
    if (this.columns.some(column => column.key === key)) throw new Error('이미 있는 열입니다.');
    const column = { key, field: 'f' + this.nextField++, user: true };
    this.columns.push(column);
    return column;
  }
  removeColumn(key: string): GridColumn | undefined {
    const index = this.columns.findIndex(column => column.key === key);
    if (index === -1) return;
    if (!this.columns[index].user) throw new Error('원천 열은 삭제할 수 없습니다. 열 숨기기를 사용하세요.');
    return this.columns.splice(index, 1)[0];
  }
  visible(column: GridColumn, rows: JsonRow[], settings: MvpSettings): boolean {
    return column.user || ((!settings.hideEmptyColumns || rows.some(row => !isEmpty(row[column.key]))) &&
      (!settings.hideUnmappedColumns || own(settings.dictionary.keys, column.key)));
  }
}
export function exportMatrix(rows: JsonRow[], columns: { key: string; label: string }[]): (string | number | boolean | null | undefined)[][] {
  return [columns.map(column => column.label), ...rows.map(row => columns.map(column => {
    const value = row[column.key];
    return value !== null && typeof value === 'object' ? JSON.stringify(value) : value as string | number | boolean | null | undefined;
  }))];
}

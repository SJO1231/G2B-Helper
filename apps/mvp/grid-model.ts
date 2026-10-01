import type { JsonRow, MvpColumnType, MvpSettings } from './contracts';

export type GridFilter = { mode: 'values'; values: string[] } | { mode: 'exact' | 'includes' | 'exclude'; terms: string[] };
export interface GridView { search: string; combine: 'and' | 'or'; filters: Map<string, GridFilter>; }
export interface GridColumn { key: string; field: string; user: boolean; }
export type GridBufferRow = Record<string, unknown> & { _mvpRow: number };
export const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === '';
export const rawText = (value: unknown): string => value === undefined ? '' : value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export const valueToken = (value: unknown): string => JSON.stringify([value === undefined ? 'missing' : value === null ? 'null' : typeof value, value]);
export const choiceText = (value: unknown): string => value === undefined ? '(누락)' : value === null ? '(null)' : value === '' ? '(빈 셀)' : rawText(value);
const own = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** Item names are a preview only; the nested value remains available unchanged. */
export function nestedPreview(value: unknown, key: string): string {
  if (!['items', '물품', '품목'].includes(key) || value === null || typeof value !== 'object') return rawText(value);
  const items = Array.isArray(value) ? value : [value];
  const names = ['dtlsPrnm', 'dtlsPrnmNm', 'itemCfnm', 'prdctNm', 'prnm', '품명', '세부품명', 'name'];
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    for (const name of names) {
      if (own(item, name) && !isEmpty((item as JsonRow)[name]) && typeof (item as JsonRow)[name] !== 'object') {
        return rawText((item as JsonRow)[name]) + (items.length > 1 ? ' 외 ' + (items.length - 1) + '건' : '');
      }
    }
  }
  return rawText(value);
}

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

function dateParts(text: string): [string, string, string] | undefined {
  const match = /^(\d{4})(?:(\d{2})(\d{2})|([.-])(\d{2})\4(\d{2}))$/.exec(text);
  if (!match) return;
  const parts: [string, string, string] = [match[1], match[2] ?? match[5], match[3] ?? match[6]];
  const [year, month, day] = parts.map(Number), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return;
  return parts;
}
export function formatValue(value: unknown, type?: MvpColumnType): string {
  const text = rawText(value);
  if (type === 'money') {
    const match = /^([+-]?)(\d+)(\.\d+)?$/.exec(text);
    if (match) return match[1] + match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (match[3] || '');
  }
  if (type === 'date') {
    const parts = dateParts(text);
    if (parts) return parts.join('.');
  }
  return text;
}

/** A typed decimal is retained as text rather than rounded through binary Number. */
export function editedValue(text: string, previous: unknown, type?: MvpColumnType): unknown {
  if (text === '' || type === 'text') return text;
  if (type === 'date') {
    if (!dateParts(text)) throw new Error('날짜는 유효한 YYYY.MM.DD, YYYY-MM-DD 또는 YYYYMMDD로 입력하세요.');
    return text;
  }
  if (type === 'money') {
    if (!/^[+-]?\d+(\.\d+)?$/.test(text)) throw new Error('금액은 쉼표 없이 숫자와 소수점으로 입력하세요.');
    return text;
  }
  if (typeof previous === 'boolean') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    throw new Error('불리언 값은 true 또는 false로 입력하세요.');
  }
  if (typeof previous === 'number') {
    if (!/^[+-]?\d+(\.\d+)?$/.test(text)) throw new Error('숫자를 입력하세요.');
    if (/^[+-]?(0|[1-9]\d*)$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
  }
  return text;
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

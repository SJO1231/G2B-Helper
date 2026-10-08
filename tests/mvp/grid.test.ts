import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MvpSettings } from '../../apps/mvp/contracts';
import * as XLSX from 'xlsx';

const state = vi.hoisted(() => ({ tables: [] as any[], files: [] as any[] }));
vi.mock('xlsx', async importOriginal => ({ ...await importOriginal<any>(), writeFile: (book: unknown, name: string) => state.files.push({ book, name }) }));
vi.mock('tabulator-tables', () => {
  class MockTable {
    options: any; data: any[]; columns: any[]; listeners = new Map<string, Function[]>(); filter?: Function; destroyed = false;
    rowCache = new WeakMap<object, any>(); rangeCells: any[][] = [];
    sorters: any[] = [];
    constructor(_host: unknown, options: any) {
      this.options = options; this.data = structuredClone(options.data);
      this.columns = options.columns.map((definition: any) => this.column(definition)); state.tables.push(this);
    }
    column(definition: any) {
      let visible = definition.visible !== false;
      let width = definition.width || 150;
      return { definition, getWidth: () => width, setWidth: (next: number) => { width = next; }, getField: () => definition.field, getElement: () => new FakeElement(), isVisible: () => visible, show: () => { visible = true; }, hide: () => { visible = false; } };
    }
    on(name: string, listener: Function) { this.listeners.set(name, [...this.listeners.get(name) || [], listener]); }
    fire(name: string, ...args: unknown[]) { this.listeners.get(name)?.forEach(listener => listener(...args)); }
    row(data: any) {
      const cached = this.rowCache.get(data); if (cached) return cached;
      const self = this;
      const row = { getData: () => data, reformat: vi.fn(), getCell: (field: string) => { let old: unknown; const cell = {
        getField: () => field, getRow: () => row, getValue: () => data[field], getElement: () => new FakeElement(),
        getOldValue: () => old, setValue: (value: unknown) => { old = data[field]; data[field] = value; self.fire('cellEdited', cell); }, edit: vi.fn(),
      }; return cell; } };
      this.rowCache.set(data, row); return row;
    }
    getRows(range?: string) { return this.data.filter(row => range !== 'active' || !this.filter || this.filter(row)).map(row => this.row(row)); }
    getRow(id: number) { const data = this.data.find(row => row._mvpRow === id); return data ? this.row(data) : false; }
    getSorters() { return this.sorters; }
    setSort(sorters: any[]) { this.sorters = sorters.map(sort => ({ field: sort.column, dir: sort.dir })); }
    getColumns() { return this.columns; }
    blockRedraw() {}
    restoreRedraw() {}
    getColumn(field: string) { return this.columns.find(column => column.getField() === field); }
    showColumn(field: string) { this.getColumn(field).show(); }
    hideColumn(field: string) { this.getColumn(field).hide(); }
    getRanges() { return this.rangeCells.length ? [{ getCells: () => this.rangeCells, remove: () => { this.rangeCells = []; } }] : []; }
    addRange(first: any) { this.rangeCells = [[first]]; }
    setFilter(filter: Function) { this.filter = filter; this.fire('dataFiltered'); }
    updateColumnDefinition(field: string, definition: any) { this.getColumn(field).definition = definition; return Promise.resolve(); }
    addColumn(definition: any) { this.columns.push(this.column(definition)); return Promise.resolve(); }
    deleteColumn(field: string) { this.columns = this.columns.filter(column => column.getField() !== field); }
    moveColumn(from: string, to: string, after: boolean) {
      const column = this.getColumn(from); this.columns = this.columns.filter(item => item !== column);
      const index = this.columns.findIndex(item => item.getField() === to); this.columns.splice(index + Number(after), 0, column);
    }
    addData(data: any[]) { this.data.push(...data); return Promise.resolve(); }
    deleteRow(id: number) { this.data = this.data.filter(row => row._mvpRow !== id); return Promise.resolve(); }
    destroy() { this.destroyed = true; }
  }
  return { TabulatorFull: MockTable };
});

class FakeElement {
  children: FakeElement[] = []; dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; listeners = new Map<string, Function[]>();
  hidden = false; textContent = ''; className = ''; type = ''; value = ''; tabIndex = 0; clientHeight = 240;
  checked = false; indeterminate = false; placeholder = ''; title = ''; parent?: FakeElement;
  classList = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() };
  append(...nodes: FakeElement[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: FakeElement[]) { this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  addEventListener(name: string, listener: Function) { this.listeners.set(name, [...this.listeners.get(name) || [], listener]); }
  removeEventListener(name: string, listener: Function) { this.listeners.set(name, this.listeners.get(name)?.filter(item => item !== listener) || []); }
  querySelector(selector: string): FakeElement | undefined { return this.children.find(child => selector === 'input' && child.type === 'text') || this.children.map(child => child.querySelector(selector)).find(Boolean); }
  closest(selector: string) { return selector.split(',').some(item => item.startsWith('.') && this.className.split(' ').includes(item.slice(1))) ? this : undefined; }
  getBoundingClientRect() { return { x: 0, width: 100 }; }
  focus() {}
  select() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  fire(name: string, event: any = { preventDefault() {}, stopPropagation() {} }) { this.listeners.get(name)?.forEach(listener => listener(event)); }
}
import { renderGrid } from '../../apps/mvp/grid';

const settings: MvpSettings = { theme: 'light', extractionMode: 'tables', hideEmptyColumns: true, hideUnmappedColumns: false, dictionary: { keys: { code: '번호', amount: '금액', flag: '여부' }, values: { flag: { false: '아니오' } } }, launchers: [], columnTypes: { amount: 'money', date: 'date' } };
beforeEach(() => {
  state.tables = []; state.files = [];
  vi.stubGlobal('document', { createElement: () => new FakeElement(), createElementNS: () => new FakeElement() });
  vi.stubGlobal('Element', FakeElement);
});
afterEach(() => { vi.unstubAllGlobals(); });
describe('MVP GridRenderer DOM adapter (synthetic mocks)', () => {
  it('returns selected active source rows once with hidden values intact and excludes blank slots', () => {
    const handle=renderGrid(new FakeElement() as unknown as HTMLElement,{label:'문서 선택',rows:[{code:'0001',amount:'12345678901234567890.001',flag:false,blank:'',zero:0},{code:'0002'}],settings});
    const table=state.tables[0];table.fire('tableBuilt');expect(handle.getSelectedRows()).toEqual([]);
    const [a,b]=table.getRows();table.rangeCells=[[b.getCell('f0'),a.getCell('f0'),a.getCell('f1')]];
    expect(handle.getSelectedRows()).toHaveLength(2);handle.setRowFilter(row=>row.code==='0001');
    const selected=handle.getSelectedRows();expect(selected).toEqual([{sourceIndex:0,row:{code:'0001',amount:'12345678901234567890.001',flag:false,blank:'',zero:0}}]);
    selected[0].row.code='changed';expect(handle.getSelectedRows()[0].row.code).toBe('0001');
    handle.setRowFilter(()=>false);expect(handle.getSelectedRows()).toEqual([]);
  });
  it('keeps the sheet and selection intact when settings close unchanged or only the theme changes', async () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '설정 닫기', rows: [{ code: '001', amount: '1234' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt');
    table.rangeCells = [[table.getRows()[0].getCell('f0')]];
    const update = vi.spyOn(table, 'updateColumnDefinition');
    handle.setSettings(structuredClone(settings));
    handle.setSettings({ ...settings, theme: 'dark', shortcuts: { launcher: 'Alt+Shift+L' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled(); expect(table.getRanges()).toHaveLength(1);
    expect(handle.rows()).toEqual([{ code: '001', amount: '1234' }]); handle.destroy();
  });
  it('keeps the selected rows when the document dialog saves a profile link', async () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '문서 서식 연결', rows: [{ code: '001', amount: '1234' }, { code: '002', amount: '5' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt');
    table.rangeCells = [[table.getRows()[1].getCell('f0')]];
    const before = handle.getSelectedRows();
    const update = vi.spyOn(table, 'updateColumnDefinition');
    handle.setSettings({ ...settings, documentProfiles: { contract: 'profile-1' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled(); expect(table.getRanges()).toHaveLength(1);
    expect(before).toEqual([{ sourceIndex: 1, row: { code: '002', amount: '5' } }]); expect(handle.getSelectedRows()).toEqual(before);
    handle.destroy();
  });
  it('still redraws columns when a column setting changes', async () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '열 설정 변경', rows: [{ code: '001', amount: '1234' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt');
    const update = vi.spyOn(table, 'updateColumnDefinition');
    handle.setSettings({ ...settings, dictionary: { ...settings.dictionary, keys: { ...settings.dictionary.keys, code: '계약번호' } } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(update).toHaveBeenCalled(); handle.destroy();
  });
  it('redraws cells when a column format is applied from the header menu', async () => {
    const parent = new FakeElement(), onColumnFormat = vi.fn();
    const handle = renderGrid(parent as unknown as HTMLElement, { label: '열 서식', rows: [{ code: '001', amount: '1234.5' }], settings, onColumnFormat });
    const table = state.tables[0]; table.fire('tableBuilt');
    const update = vi.spyOn(table, 'updateColumnDefinition');
    table.options.columns[1].headerContextMenu.find((entry: any) => entry.label === '열 서식').action();
    const find = (node: FakeElement): FakeElement | undefined => node.textContent === '적용' && node.listeners.has('click') ? node : node.children.map(find).find(Boolean);
    find(parent)!.fire('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onColumnFormat).toHaveBeenCalledWith('amount', { grouping: true }); expect(update).toHaveBeenCalled();
    expect(handle.rows()).toEqual([{ code: '001', amount: '1234.5' }]); handle.destroy();
  });
  it('moves and hides selected columns as a group and undoes both without changing raw rows', () => {
    const parent = new FakeElement(), source = [{ code: '001', amount: '1.000000000000000001', flag: false, extra: 0 }];
    const handle = renderGrid(parent as unknown as HTMLElement, { label: '선택 열', rows: source, settings });
    const table = state.tables[0]; table.fire('tableBuilt');
    table.rangeCells = [[table.getRows()[0].getCell('f1'), table.getRows()[0].getCell('f2')]];
    const data = new Map<string, string>(), dataTransfer = { setData: (kind: string, value: string) => data.set(kind, value), getData: (kind: string) => data.get(kind) || '', effectAllowed: '', types: ['application/x-g2b-grid-column'] };
    table.options.columns[1].titleFormatter().children[2].fire('dragstart', { dataTransfer, stopPropagation() {} });
    table.options.columns[0].titleFormatter().fire('drop', { dataTransfer, clientX: 0, preventDefault() {}, stopPropagation() {} });
    expect(table.getColumns().map((column: any) => column.getField())).toEqual(['f1', 'f2', 'f0', 'f3']);
    table.options.columns[1].headerContextMenu.find((item: any) => item.label === '선택 열 숨기기').action();
    expect(handle.getViewState().columns.filter(column => !column.visible).map(column => column.key)).toEqual(['amount', 'flag']);
    const cancel = table.options.columns[0].headerContextMenu.find((item: any) => item.label === '열 이동·숨김 취소');
    cancel.action(); expect(table.getColumns().every((column: any) => column.isVisible())).toBe(true);
    cancel.action(); expect(handle.getViewState().columns.map(column => column.key)).toEqual(['code', 'amount', 'flag', 'extra']);
    expect(handle.rows()).toEqual(source); handle.destroy();
  });
  it('opens key dictionary editing from the column list and toggles the same chooser', () => {
    const parent = new FakeElement(), rename = vi.fn(), handle = renderGrid(parent as unknown as HTMLElement, { label: '열 목록', rows: [{ code: '001' }], settings, onColumnRename: rename });
    const table = state.tables[0]; table.fire('tableBuilt'); const root = parent.children[0], toggle = root.children[0].children[0];
    toggle.fire('click'); expect(root.children[2].hidden).toBe(false); toggle.fire('click'); expect(root.children[2].hidden).toBe(true);
    toggle.fire('click'); root.children[2].children[1].children[3].children[0].fire('contextmenu');
    const body = root.children[2].children[1]; body.children[1].value = '새 번호'; body.children[2].fire('click');
    expect(rename).toHaveBeenCalledWith('code', '새 번호'); expect(handle.rows()).toEqual([{ code: '001' }]); handle.destroy();
  });
  it('passes selected real cells to batch value dictionaries while excluding padding and unrelated selections', () => {
    const dictionary = vi.fn(), handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '여러 값', rows: [{ code: '001', flag: false }, { code: '002', flag: true }], settings, onValueDictionary: dictionary });
    const table = state.tables[0]; table.fire('tableBuilt'); const rows = table.getRows();
    table.rangeCells = [[rows[0].getCell('f1')], [rows[1].getCell('f1')], [rows[2].getCell('f1')]];
    const menu = table.options.columns[1].contextMenu({}, rows[0].getCell('f1')); menu[0].action();
    expect(dictionary).toHaveBeenLastCalledWith('flag', false, [{ key: 'flag', value: false }, { key: 'flag', value: true }]);
    table.options.columns[0].contextMenu({}, rows[0].getCell('f0'))[0].action(); expect(dictionary).toHaveBeenLastCalledWith('code', '001');
    expect(handle.rows()).toEqual([{ code: '001', flag: false }, { code: '002', flag: true }]); handle.destroy();
  });
  it('retains nested objects and arrays as JSON in the written Excel file', () => {
    const source = [{ items: [{ code: '0001', amount: '12345678901234567890.123456789', quantity: 0, flag: false }], meta: JSON.parse('{"__proto__":false,"text":"한글\\n상세"}') }, { items: [], meta: {} }];
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '중첩 내보내기', rows: source, settings });
    state.tables[0].fire('tableBuilt'); handle.exportExcel('중첩'); handle.exportCsv('중첩');
    const book = XLSX.read(XLSX.write(state.files[0].book, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]], csv = state.files[1].book.Sheets['자료'];
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([['items', 'meta'], ...source.map(row => [JSON.stringify(row.items), JSON.stringify(row.meta)])]);
    expect(sheet.A2.v).toBe(csv.A2.v); expect(sheet.B2.v).toBe(csv.B2.v);
    expect(handle.rows()).toEqual(source); handle.destroy();
  });
  it('undoes a paste batch and recalculates derived cells outside history', () => {
    const parent = new FakeElement(); let handle: ReturnType<typeof renderGrid>;
    handle = renderGrid(parent as unknown as HTMLElement, { label: '실행 취소', rows: [{ amount: '100', total: '200' }], settings, readOnlyColumnKeys: ['total'], onRowsChanged: () => handle.updateDerivedValues(row => ({ total: String(Number(row.amount) * 2) })) });
    const table = state.tables[0]; table.fire('tableBuilt'); table.rangeCells = [[table.getRows()[0].getCell('f0')]];
    table.options.clipboardPasteAction([['1,234']]); expect(handle.rows()).toEqual([{ amount: '1234', total: '2468' }]);
    const key = (value: string, shiftKey = false) => parent.children[0].fire('keydown', { target: parent.children[0].children[4], key: value, ctrlKey: true, shiftKey, preventDefault() {}, stopImmediatePropagation() {} });
    key('z'); expect(handle.rows()).toEqual([{ amount: '100', total: '200' }]); key('z', true); expect(handle.rows()).toEqual([{ amount: '1234', total: '2468' }]);
    handle.setSettings({ ...settings, columnLocks: { amount: true } }); key('z'); expect(handle.rows()[0].amount).toBe('1234'); handle.destroy();
  });
  it('restores ordered columns, widths and sorting while exports share visible rows and headers', () => {
    const source = [{ code: '001', amount: '1234.5', flag: false }, { code: '002', amount: '9999999999999999.1', flag: true }];
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '보기 복원', rows: source, settings, viewState: { search: '001', combine: 'or', filters: [], columns: [{ key: 'amount', width: 210, visible: true }, { key: 'code', width: 180, visible: true }, { key: 'flag', width: 150, visible: false }], sorters: [{ key: 'amount', dir: 'desc' }] } });
    const table = state.tables[0]; table.fire('tableBuilt'); expect(handle.getViewState().columns.map(c => c.key)).toEqual(['amount', 'code', 'flag']); expect(handle.getViewState().sorters).toEqual([{ key: 'amount', dir: 'desc' }]);
    handle.exportExcel('보기'); handle.exportCsv('보기'); const [excel, csv] = state.files.map(file => file.book.Sheets['자료']);
    expect(excel.A1.v).toBe(csv.A1.v); expect(excel.B2.v).toBe(csv.B2.v); expect(excel['!ref']).toBe(csv['!ref']); expect(excel.A2).toMatchObject({ t: 'n', v: 1234.5 }); expect(excel.A2.z).toContain('#,##0'); expect(excel['!cols'][0].wpx).toBe(210);
    expect(handle.rows()).toEqual(source); handle.destroy();
  });
  it('keeps whole-sheet cloning linear while building and refreshing column definitions', async () => {
    const source = Array.from({ length: 40 }, (_, row) => Object.fromEntries(Array.from({ length: 24 }, (_, column) => ['key' + column, column === 0 ? 0 : column === 1 ? false : `${row}:${column}`])));
    const clone = vi.spyOn(globalThis, 'structuredClone'); let handle: ReturnType<typeof renderGrid> | undefined;
    try {
      handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '넓은 표', rows: source, settings });
      expect(clone.mock.calls.length).toBeLessThan(source.length * 24 * 10);
      const table = state.tables[0]; table.fire('tableBuilt'); clone.mockClear();
      const update = vi.spyOn(table, 'updateColumnDefinition');
      handle.setSettings({ ...settings, hideEmptyColumns: false });
      await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(24));
      expect(clone.mock.calls.length).toBeLessThan(source.length * 24 * 10);
      expect(handle.rows()).toEqual(source);
    } finally { handle?.destroy(); clone.mockRestore(); }
  });
  it('retains Unicode insertText and committed IME text without opening an editor on selection', () => {
    const parent = new FakeElement(), handle = renderGrid(parent as unknown as HTMLElement, { label: '한글 입력', rows: [{ code: '원래 값' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt'); const cell = table.getRows()[0].getCell('f0'); table.rangeCells = [[cell]];
    const root = parent.children[0], proxy = root.children[4], target = new FakeElement(); target.className = 'tabulator-cell';
    root.children[1].fire('click', { target, detail: 1 }); expect(cell.edit).not.toHaveBeenCalled();
    let input: FakeElement | undefined;
    cell.edit.mockImplementation(() => { input = table.options.columns[0].editor(cell, (run: Function) => run(), vi.fn(), vi.fn()); });
    proxy.value = '입력'; proxy.fire('input', { isComposing: false }); expect(input?.value).toBe('입력'); expect(proxy.value).toBe('');
    proxy.fire('compositionstart'); proxy.value = '한'; proxy.fire('input', { isComposing: true }); expect(cell.edit).toHaveBeenCalledTimes(1);
    proxy.value = '한글'; proxy.fire('compositionend'); expect(input?.value).toBe('한글'); expect(cell.edit).toHaveBeenCalledTimes(2);
    handle.setSettings({ ...settings, columnLocks: { code: true } }); proxy.value = '금지'; proxy.fire('input', { isComposing: false });
    expect(cell.edit).toHaveBeenCalledTimes(2); expect(handle.rows()).toEqual([{ code: '원래 값' }]); handle.destroy();
  });
  it('keeps proxy clipboard copying raw TSV and pasting atomic across locked columns', () => {
    const parent = new FakeElement(), handle = renderGrid(parent as unknown as HTMLElement, { label: '클립보드', rows: [{ code: '00\t01', flag: false }], settings });
    const table = state.tables[0]; table.fire('tableBuilt'); const first = table.getRows()[0], proxy = parent.children[0].children[4];
    table.rangeCells = [[first.getCell('f0'), first.getCell('f1')]];
    const setData = vi.fn(); proxy.fire('copy', { clipboardData: { setData }, preventDefault() {}, stopPropagation() {} }); expect(setData).toHaveBeenCalledWith('text/plain', '"00\t01"\tfalse');
    handle.setSettings({ ...settings, columnLocks: { flag: true } });
    proxy.fire('paste', { clipboardData: { getData: () => '0002\ttrue' }, preventDefault() {}, stopPropagation() {} });
    expect(handle.rows()).toEqual([{ code: '00\t01', flag: false }]); handle.setSettings(settings);
    proxy.fire('paste', { clipboardData: { getData: () => '0002\ttrue' }, preventDefault() {}, stopPropagation() {} }); expect(handle.rows()).toEqual([{ code: '0002', flag: true }]); handle.destroy();
  });
  it('routes notices to the shared bottom line or keeps its fallback at the grid bottom', () => {
    const onNotice = vi.fn(), parent = new FakeElement();
    const handle = renderGrid(parent as unknown as HTMLElement, { label: '알림', rows: [{ amount: 1 }], settings, onNotice });
    const table = state.tables[0]; table.fire('tableBuilt'); const cell = table.getRows()[0].getCell('f0'); table.rangeCells = [[cell]];
    table.options.clipboardPasteAction([['invalid']]); expect(onNotice).toHaveBeenLastCalledWith('숫자와 소수점을 입력하세요. 쉼표는 세 자리씩 구분하세요.');
    const root = parent.children[0]; expect(root.children[3].hidden).toBe(true); expect(root.children[0].children.some(child => child.className === 'mvp-grid-status')).toBe(false);
    table.options.clipboardPasteAction([['1.000000000000000001']]); expect(onNotice).toHaveBeenLastCalledWith(''); handle.destroy();
    const fallbackParent = new FakeElement(), fallback = renderGrid(fallbackParent as unknown as HTMLElement, { label: '독립 알림', rows: [{ amount: 1 }], settings });
    const fallbackTable = state.tables[1]; fallbackTable.fire('tableBuilt'); fallbackTable.rangeCells = [[fallbackTable.getRows()[0].getCell('f0')]]; fallbackTable.options.clipboardPasteAction([['invalid']]);
    const fallbackRoot = fallbackParent.children[0]; expect(fallbackRoot.children[3].className).toBe('mvp-grid-status');
    expect(fallbackRoot.children[3].title).toContain('숫자'); fallback.destroy();
  });
  it('uses the same visible-checkbox meaning for all, empty, unmapped and user column groups', () => {
    const parent = new FakeElement(), handle = renderGrid(parent as unknown as HTMLElement, { label: '열 보기', rows: [{ blank: null, code: '001', unmapped: false, memo: 'user' }], userColumnKeys: ['memo'], settings: { ...settings, hideUnmappedColumns: true } });
    const table = state.tables[0]; table.fire('tableBuilt'); parent.children[0].children[0].children[0].fire('click');
    const panel = parent.children[0].children[2], body = panel.children[1], groups = body.children[2], list = body.children[3];
    expect(panel.classList.add).toHaveBeenCalledWith('mvp-grid-column-panel');
    expect(groups.children).toHaveLength(4); expect(list.children).toHaveLength(4);
    expect(groups.children[0].children[0].children[0].indeterminate).toBe(true);
    let empty = groups.children[1].children[0].children[0]; empty.checked = true; empty.fire('change'); expect(table.getColumn('f0').isVisible()).toBe(true);
    groups.children[0].children[2].fire('click'); expect(table.getColumns().some((column: any) => column.isVisible())).toBe(false);
    let users = groups.children[3].children[0].children[0]; users.checked = true; users.fire('change'); expect(table.getColumn('f3').isVisible()).toBe(true);
    body.children[0].value = '번호'; body.children[0].fire('input'); expect(list.children).toHaveLength(1);
    let all = groups.children[0].children[0].children[0]; all.checked = true; all.fire('change');
    expect(table.getColumn('f1').isVisible()).toBe(true); expect(table.getColumn('f2').isVisible()).toBe(false);
    handle.setSettings({ ...settings, theme: 'dark', hideUnmappedColumns: true }); expect(table.getColumn('f1').isVisible()).toBe(true); expect(table.getColumn('f2').isVisible()).toBe(false); handle.destroy();
  });
  it('resets header filters while preserving the global search term and explains the boundary', () => {
    const parent = new FakeElement(), handle = renderGrid(parent as unknown as HTMLElement, { label: '검색', rows: [{ code: '001' }, { code: '002' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt'); handle.setSearch('001');
    const toolbar = parent.children[0].children[0]; expect(toolbar.children[1].children.map(option => option.textContent)).toEqual(['모두 충족 (AND)', '하나 이상 충족 (OR)']);
    table.options.columns[0].headerContextMenu.find((entry: any) => entry.label === '열 필터').action();
    const body = parent.children[0].children[2].children[1], choices = body.children[3];
    const first = choices.children[0].children[0]; first.checked = false; first.fire('change'); body.children[5].children[1].fire('click');
    expect(table.filter(table.data[0])).toBe(false);
    const reset = toolbar.children[2]; expect(reset.textContent).toBe('열 필터 해제'); expect(reset.title).toContain('전체 검색어는 유지'); reset.fire('click');
    expect(table.filter(table.data[0])).toBe(true); expect(table.filter(table.data[1])).toBe(false); handle.destroy();
  });
  it('renders representative item names and right-aligned money while nested details keep the full raw data', () => {
    const onNested = vi.fn(), source = [{ items: [{ dtlsPrnmNm: '합성 품명', code: '0001', quantity: 0, flag: false }, { itemCfnm: '다른 품명' }], amount: '1.000000000000000001' }];
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '품목', rows: source, settings, onNested });
    const table = state.tables[0]; table.fire('tableBuilt'); const cell = table.getRows()[0].getCell('f0'), preview = table.options.columns[0].formatter(cell);
    expect(preview.textContent).toBe('합성 품명 (전체 2개 품목)'); expect(preview.title).toBe(JSON.stringify(source[0].items));
    preview.fire('click'); expect(onNested).toHaveBeenCalledWith(source[0], 'items', source[0].items);
    expect(table.options.columns[1].hozAlign).toBe('right'); expect(handle.rows()).toEqual(source); handle.destroy();
  });
  it('single-click selects a cell without editing; F2 opens editing and typing replaces the value', () => {
    const parent = new FakeElement(), handle = renderGrid(parent as unknown as HTMLElement, { label: '편집', rows: [{ code: '001' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt');
    const cell = table.getRows()[0].getCell('f0'), target = new FakeElement(); target.className = 'tabulator-cell'; table.rangeCells = [[cell]];
    const requestFrame = vi.fn((run: Function) => run()); vi.stubGlobal('requestAnimationFrame', requestFrame);
    parent.children[0].children[1].fire('click', { target, detail: 1 }); expect(cell.edit).not.toHaveBeenCalled();
    const key = (value: string) => parent.children[0].fire('keydown', { target, key: value, preventDefault() {}, stopImmediatePropagation() {} });
    key('F2'); expect(cell.edit).toHaveBeenCalledTimes(1);
    let input: FakeElement | undefined;
    cell.edit.mockImplementation(() => { input = table.options.columns[0].editor(cell, (run: Function) => run(), vi.fn(), vi.fn()); });
    key('7'); expect(cell.edit).toHaveBeenCalledTimes(2);
    expect(input?.value).toBe('7'); handle.destroy();
  });
  it('respects persisted column locks for direct edits, atomic paste and boolean toggles', () => {
    const onColumnLock = vi.fn(), parent = new FakeElement();
    const handle = renderGrid(parent as unknown as HTMLElement, { label: '잠금', rows: [{ code: '001', completed: false, derived: 0 }], userColumnKeys: ['completed'], readOnlyColumnKeys: ['derived'], settings: { ...settings, columnLocks: { completed: true } }, onColumnLock });
    const table = state.tables[0]; table.fire('tableBuilt');
    const cell = table.getRows()[0].getCell('f1'); expect(table.options.columns[1].editable(cell)).toBe(false);
    table.rangeCells = [[table.getRows()[0].getCell('f0')]]; expect(table.options.clipboardPasteAction([['002', 'true']])).toEqual([]);
    handle.toggleSelectedBoolean('completed'); expect(handle.rows()).toEqual([{ code: '001', completed: false, derived: 0 }]);
    table.options.columns[1].headerContextMenu.find((entry: any) => entry.label === '열 잠금 해제').action();
    expect(onColumnLock).toHaveBeenCalledWith('completed', false); expect(table.options.columns[1].editable(cell)).toBe(true);
    const readonlyMenu = table.options.columns[2].headerContextMenu.find((entry: any) => entry.label.includes('잠금'));
    expect(readonlyMenu.disabled).toBe(true); readonlyMenu.action(); expect(table.options.columns[2].editable(table.getRows()[0].getCell('f2'))).toBe(false);
    handle.destroy();
  });
  it('adds the raw cell value to its dictionary and deletes only real rows in source order', async () => {
    const changed = vi.fn(), dictionary = vi.fn(), handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '임시', rows: [{ code: '001', flag: false }, { code: '002', flag: true }], settings, allowRowDelete: true, onRowsChanged: changed, onValueDictionary: dictionary });
    const table = state.tables[0]; table.fire('tableBuilt');
    const flag = table.getRows()[0].getCell('f1');
    table.options.columns[1].contextMenu({}, flag).find((entry: any) => entry.label === '값 사전 추가').action();
    expect(dictionary).toHaveBeenCalledWith('flag', false);
    const padding = table.getRows()[2], menu = table.options.rowContextMenu({}, padding); expect(menu[0].disabled).toBe(true);
    table.options.rowContextMenu({}, table.getRows()[0])[0].action(); await Promise.resolve();
    expect(handle.rows()).toEqual([{ code: '002', flag: true }]); expect(changed).toHaveBeenLastCalledWith([{ code: '002', flag: true }], [1]); handle.destroy();
  });
  it('delegates DB deletion using original zero-based indices after sorting without mutating the buffer', () => {
    const onDeleteRows = vi.fn(), handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: 'DB', rows: [{ code: '001' }, { code: '002' }], settings, allowRowDelete: true, onDeleteRows });
    const table = state.tables[0]; table.fire('tableBuilt'); [table.data[0], table.data[1]] = [table.data[1], table.data[0]];
    table.options.rowContextMenu({}, table.getRows()[0])[0].action();
    expect(onDeleteRows).toHaveBeenCalledWith([{ code: '002' }], [1]); expect(handle.rows()).toEqual([{ code: '001' }, { code: '002' }]); handle.destroy();
  });
  it('preserves hostile source names and empty source rows; buffer edits never mutate source', () => {
    const source = [JSON.parse('{"":"value","a.b":"0001","__rowId":false,"__proto__":0,"nested":[{"id":"001"}]}'), {}];
    const parent = new FakeElement(), changed = vi.fn();
    const handle = renderGrid(parent as unknown as HTMLElement, { label: '표', rows: source, settings, onRowsChanged: changed });
    const table = state.tables[0]; table.fire('tableBuilt');
    expect(table.options.headerSortClickElement).toBe('icon');
    expect(table.options.columns.map((column: any) => column.field)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    expect(table.options.rowHeader.formatter).toBe('rownum');
    expect(table.data.length).toBeGreaterThan(2);
    table.getRows()[0].getCell('f1').setValue('0002');
    expect(source[0]['a.b']).toBe('0001');
    expect(handle.rows()).toEqual([{ ...source[0], 'a.b': '0002' }, {}]);
    expect(changed).toHaveBeenCalled();
    handle.destroy(); expect(table.destroyed).toBe(true); expect(parent.children).toHaveLength(0);
  });
  it('keeps edited buffer and instance when search/settings change; restores hidden empty source columns', () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '자료', rows: [{ blank: '', code: '001' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt');
    expect(table.getColumn('f0').isVisible()).toBe(false);
    table.getRows()[0].getCell('f1').setValue('002');
    handle.setSearch('002'); handle.setSettings({ ...settings, theme: 'dark', hideEmptyColumns: false });
    expect(state.tables).toHaveLength(1); expect(handle.rows()).toEqual([{ blank: '', code: '002' }]);
    expect(table.getColumn('f0').isVisible()).toBe(true);
  });
  it('opens nested source arrays from a cell without losing primitive false/zero values', () => {
    const onNested = vi.fn(), source = [{ items: [0, false, { name: '물품' }] }];
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '물품', rows: source, settings, onNested });
    const table = state.tables[0]; table.fire('tableBuilt');
    const cell = table.getRows()[0].getCell('f0');
    table.options.columns[0].formatter(cell).fire('click');
    expect(onNested).toHaveBeenCalledWith(source[0], 'items', [{ value: 0 }, { value: false }, { name: '물품' }]);
    expect(table.options.columns[0].editable(cell)).toBe(false);
    handle.destroy();
  });
  it('exports filtered visible columns with mapped headers and native raw XLSX cell types', () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '파일', rows: [{ code: '0001', amount: 1234.56789, flag: false, blank: null }, { code: '0002', amount: 2.1, flag: true, blank: '' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt'); handle.setSearch('0001'); handle.exportExcel('합성자료');
    const file = state.files[0], sheet = file.book.Sheets['자료'];
    expect(file.name).toBe('합성자료.xlsx'); expect(sheet['!ref']).toBe('A1:C2');
    expect(sheet.A1.v).toBe('번호'); expect(sheet.A2.v).toBe('0001'); expect(sheet.A2.t).toBe('s');
    expect(sheet.B2.v).toBe(1234.56789); expect(sheet.B2.t).toBe('n');
    expect(sheet.C2.v).toBe(false); expect(sheet.C2.t).toBe('b');
    expect(table.options.columns[1].formatter(table.getRows()[0].getCell('f1')).textContent).toBe('1,234.56789');
    handle.destroy();
  });
  it('supports deleting loaded user columns while readOnly prevents editing and schema changes', () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: 'DB', rows: [{ source: 0, note: 'user' }], userColumnKeys: ['note'], settings });
    state.tables[0].fire('tableBuilt'); handle.removeColumn('note'); expect(handle.rows()).toEqual([{ source: 0 }]);
    expect(() => handle.removeColumn('source')).toThrow('원천 열'); handle.destroy();
    const locked = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '조회', rows: [{ source: false }], settings, readOnly: true });
    const table = state.tables[1]; table.fire('tableBuilt');
    expect(table.options.columns[0].editor).toBeUndefined(); expect(table.options.clipboardPasteAction([['true']])).toEqual([]);
    locked.addColumn('forbidden'); locked.removeColumn('source'); expect(locked.rows()).toEqual([{ source: false }]); locked.destroy();
  });
  it('adds user columns to detached buffer without rebuilding the renderer', async () => {
    const changed = vi.fn(), handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '입력', rows: [{ source: '001' }], settings, onRowsChanged: changed });
    state.tables[0].fire('tableBuilt'); handle.addColumn('memo'); await Promise.resolve();
    expect(state.tables).toHaveLength(1); expect(handle.rows()).toEqual([{ source: '001', memo: '' }]);
    expect(changed).toHaveBeenCalled(); handle.removeColumn('memo'); expect(handle.rows()).toEqual([{ source: '001' }]); handle.destroy();
  });
  it('protects computed columns and validates all paste cells before changing any buffer value', () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '계산', rows: [{ code: '001', computed: 12 }], settings, readOnlyColumnKeys: ['computed'] });
    const table = state.tables[0]; table.fire('tableBuilt');
    const first = table.getRows()[0].getCell('f0'), computed = table.getRows()[0].getCell('f1'); table.rangeCells = [[first]];
    expect(table.options.columns[1].editable(computed)).toBe(false);
    expect(table.options.clipboardPasteAction(table.options.clipboardPasteParser('002\t13\r\n'))).toEqual([]);
    expect(handle.rows()).toEqual([{ code: '001', computed: 12 }]);
    table.options.clipboardPasteAction(table.options.clipboardPasteParser('002\r\n'));
    expect(handle.rows()).toEqual([{ code: '002', computed: 12 }]); handle.destroy();
  });
  it('keeps user column visibility across settings updates and restores through the public control', () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '사용자', rows: [{ source: '001', memo: 'value' }], userColumnKeys: ['memo'], settings });
    const table = state.tables[0]; table.fire('tableBuilt'); handle.setUserColumnsVisible(false);
    handle.setSettings({ ...settings, theme: 'dark' }); expect(table.getColumn('f1').isVisible()).toBe(false);
    handle.setUserColumnsVisible(true); expect(table.getColumn('f1').isVisible()).toBe(true); handle.destroy();
  });
  it('commits Enter/Tab and cancels Escape without interpreting markup or rounding typed decimals', async () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '편집', rows: [{ amount: 1.2, code: '<img src=x onerror=alert(1)>' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt');
    const cell = table.getRows()[0].getCell('f0'), success = vi.fn(), cancel = vi.fn();
    const input = table.options.columns[0].editor(cell, (run: Function) => run(), success, cancel);
    input.value = '1.000000000000000001'; input.fire('keydown', { key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });
    expect(success).toHaveBeenCalledWith('1.000000000000000001');
    const escaped = table.options.columns[0].editor(cell, (run: Function) => run(), success, cancel); escaped.value = '9';
    escaped.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); expect(cancel).toHaveBeenCalledWith(1.2);
    const tabbed = table.options.columns[0].editor(cell, (run: Function) => run(), success, cancel); tabbed.value = '2.000000000000000002';
    tabbed.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() {}, stopPropagation() {} }); expect(success).toHaveBeenCalledWith('2.000000000000000002');
    expect(table.options.columns[1].formatter(table.getRows()[0].getCell('f1')).textContent).toBe('<img src=x onerror=alert(1)>');
    await Promise.resolve(); handle.destroy();
  });
  it('returns rows in stable input order after sorting while Excel keeps the displayed order', () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '저장 순서', rows: [{ code: '001' }, { code: '002' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt'); [table.data[0], table.data[1]] = [table.data[1], table.data[0]];
    expect(handle.rows()).toEqual([{ code: '001' }, { code: '002' }]);
    handle.exportExcel('순서.xlsx'); const sheet = state.files[0].book.Sheets['자료']; expect(sheet.A2.v).toBe('002'); expect(sheet.A3.v).toBe('001'); handle.destroy();
  });
  it('toggles each selected user boolean row once, ignores padding, and protects source booleans', () => {
    const changed = vi.fn(), handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '종결', rows: [{ source: false, completed: false }, { source: true, completed: true }], userColumnKeys: ['completed'], settings, onRowsChanged: changed });
    const table = state.tables[0]; table.fire('tableBuilt');
    const rows = table.getRows(); table.rangeCells = [[rows[0].getCell('f0'), rows[0].getCell('f1')], [rows[1].getCell('f0'), rows[1].getCell('f1')], [rows[2].getCell('f0')]];
    handle.toggleSelectedBoolean('completed'); expect(handle.rows()).toEqual([{ source: false, completed: true }, { source: true, completed: false }]); expect(changed).toHaveBeenCalledTimes(1);
    handle.toggleSelectedBoolean('source'); expect(handle.rows()).toEqual([{ source: false, completed: true }, { source: true, completed: false }]);
    table.rangeCells = []; handle.toggleSelectedBoolean('completed'); expect(changed).toHaveBeenCalledTimes(1); handle.destroy();
  });
  it('moves columns through a dedicated drag grip while preserving whole-column range selection', () => {
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '이동', rows: [{ code: '001', amount: 1 }], settings });
    const table = state.tables[0]; table.fire('tableBuilt'); const data = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) || '', effectAllowed: '', types: ['application/x-g2b-grid-column'] };
    const source = table.options.columns[1].titleFormatter(), target = table.options.columns[0].titleFormatter();
    source.children[2].fire('dragstart', { dataTransfer, stopPropagation() {} });
    target.fire('drop', { dataTransfer, clientX: 0, preventDefault() {}, stopPropagation() {} });
    expect(table.options.selectableRangeColumns).toBe(true); expect(table.getColumns().map((column: any) => column.getField())).toEqual(['f1', 'f0']);
    expect(handle.rows()).toEqual([{ code: '001', amount: 1 }]); handle.destroy();
  });
  it('updates only declared readonly derived cells without emitting recursively or replacing the buffer', () => {
    const changed = vi.fn(), source = [{ amount: '1.000000000000000001', remaining: 'old' }];
    const handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '계산', rows: source, settings, readOnlyColumnKeys: ['remaining'], onRowsChanged: changed });
    const table = state.tables[0]; table.fire('tableBuilt'); const first = table.getRows()[0];
    handle.updateDerivedValues(row => ({ amount: 'FORBIDDEN', remaining: row.amount }));
    expect(handle.rows()).toEqual([{ amount: '1.000000000000000001', remaining: '1.000000000000000001' }]);
    expect(source[0].remaining).toBe('old'); expect(table.getRows()[0]).toBe(first); expect(changed).not.toHaveBeenCalled();
    expect(state.tables).toHaveLength(1); handle.destroy();
  });
  it('does not start cell editing when the selected cell exists and a header sort icon is clicked', () => {
    const requestFrame = vi.fn(); vi.stubGlobal('requestAnimationFrame', requestFrame);
    const parent = new FakeElement(), handle = renderGrid(parent as unknown as HTMLElement, { label: '정렬', rows: [{ code: '001' }], settings });
    const table = state.tables[0]; table.fire('tableBuilt'); table.rangeCells = [[table.getRows()[0].getCell('f0')]];
    const host = parent.children[0].children[1]; host.fire('click', { target: new FakeElement(), detail: 1 });
    expect(requestFrame).not.toHaveBeenCalled(); handle.destroy();
  });
  it('reports user-column metadata even with zero rows and never deletes readonly derived columns', async () => {
    const columnsChanged = vi.fn(), handle = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '빈 표', rows: [], settings, onUserColumnsChanged: columnsChanged });
    const table = state.tables[0]; table.fire('tableBuilt'); handle.addColumn('empty memo'); await Promise.resolve();
    expect(handle.rows()).toEqual([]); expect(columnsChanged).toHaveBeenLastCalledWith(['empty memo']);
    handle.removeColumn('empty memo'); expect(columnsChanged).toHaveBeenLastCalledWith([]); handle.destroy();
    const derived = renderGrid(new FakeElement() as unknown as HTMLElement, { label: '계산', rows: [{ derived: '1' }], settings, userColumnKeys: ['derived'], readOnlyColumnKeys: ['derived'] });
    state.tables[1].fire('tableBuilt'); derived.removeColumn('derived'); expect(derived.rows()).toEqual([{ derived: '1' }]); derived.destroy();
  });
});

import { TabulatorFull as Tabulator, type CellComponent, type ColumnDefinition, type ColumnComponent, type RowComponent } from 'tabulator-tables';
import * as XLSX from 'xlsx';
import 'tabulator-tables/dist/css/tabulator.min.css';
import './grid.css';
import { setIcon } from './icons';
import { columnTypeLabels, type GridRendererHandle, type GridRendererOptions, type GridViewState, type JsonRow, type MvpColumnType, type MvpColumnFormat, type MvpSettings } from './contracts';
import { GridModel, choiceText, compareValues, editedValue, excelFormat, excelValue, exportMatrix, formatValue, isEmpty, matchesView, nestedPreview, parseClipboard, rawText, valueToken, type GridBufferRow, type GridColumn, type GridView } from './grid-model';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', text);
  node.type = 'button'; node.addEventListener('click', action); return node;
}
function iconButton(kind: Parameters<typeof setIcon>[1], label: string, action: () => void): HTMLButtonElement {
  const node = button('', action); setIcon(node, kind, label); return node;
}
function labelledInput(label: string, type = 'text'): HTMLInputElement {
  const node = element('input'); node.type = type; node.setAttribute('aria-label', label); return node;
}
function filterIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '12'); svg.setAttribute('height', '12'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2 3h12L9.5 8v4L6.5 14V8Z'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.4');
  svg.append(path); return svg;
}

/** An imperative worksheet. View changes leave this instance and its edit buffer intact. */
export function renderGrid(container: HTMLElement, options: GridRendererOptions): GridRendererHandle {
  let settings = structuredClone(options.settings);
  const model = new GridModel(options.rows, options.userColumnKeys);
  const initial = model.encode(options.rows);
  const saved = options.viewState;
  // Column filters always combine with AND (user, 2026-10-08, #28); an older saved OR view opens as AND.
  const view: GridView = { search: saved?.search || '', combine: 'and', filters: new Map(saved?.filters.filter(([key]) => model.columns.some(column => column.key === key))) };
  let rowFilter: ((row: JsonRow) => boolean) | undefined;
  const visibility = new Map<string, boolean>();
  const widths = new Map<string, number>();
  for (const state of saved?.columns || []) {
    const column = model.columns.find(column => column.key === state.key);
    if (column) { visibility.set(column.field, state.visible); widths.set(column.field, state.width); }
  }
  const readOnlyKeys = new Set(options.readOnlyColumnKeys || []);
  let userColumnsVisible = saved?.userColumnsVisible !== false;
  let ready = false, disposed = false, batching = false, extending = false;
  let editSeed: { cell: CellComponent; text: string } | undefined;
  const pending: (() => void)[] = [];
  const root = element('section', undefined, 'mvp-grid');
  root.dataset.theme = settings.theme;
  root.setAttribute('aria-label', options.label);
  const count = element('span', '', 'mvp-grid-count');
  const columnCount = element('span', '', 'mvp-grid-column-count');
  const footer = element('div', undefined, 'mvp-grid-footer'); footer.append(count, columnCount);
  const status = element('span', '', 'mvp-grid-status'); status.setAttribute('role', 'status'); status.hidden = !!options.onNotice;
  const host = element('div', undefined, 'mvp-grid-table'); host.tabIndex = 0;
  // A selected cell needs a real text target before IME/insertText produces a keydown.
  // Keep the sheet in selection mode until committed text starts the visible editor.
  const typingTarget = element('textarea', undefined, 'mvp-grid-typing-target');
  typingTarget.setAttribute('aria-label', '선택 셀에 입력'); typingTarget.tabIndex = -1;
  let composing = false;
  let rangeAnchor: CellComponent | undefined, rangeCursor: CellComponent | undefined;
  const panel = element('div', undefined, 'mvp-grid-panel'); panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  root.append(host, panel, status, typingTarget, footer); container.append(root);
  let table: Tabulator;
  type Edit = { id: number; field: string; before: unknown; after: unknown };
  type ColumnState = { field: string; visible: boolean }[];
  type Change = Edit[] | { before: ColumnState; after: ColumnState };
  // ponytail: 100 edit/view batches per open sheet; persist history only if cross-window undo is needed.
  const undo: Change[] = [], redo: Change[] = [];
  let replaying = false, batchEdits: Edit[] = [];
  const rememberChange = (change: Change): void => { undo.push(change); if (undo.length > 100) undo.shift(); redo.length = 0; };
  const remember = (edits: Edit[]): void => { if (edits.length) rememberChange(edits); };
  const columnState = (): ColumnState => table.getColumns().filter(column => !!getColumn(column.getField())).map(column => ({ field: column.getField(), visible: column.isVisible() }));
  const changeColumns = (run: () => void): void => { const before = columnState(); run(); const after = columnState(); if (JSON.stringify(before) !== JSON.stringify(after)) rememberChange({ before, after }); updateCount(); if (panel.hidden) focusTyping(); };
  const replay = (back: boolean): void => {
    const from = back ? undo : redo, to = back ? redo : undo, edits = from.at(-1);
    if (!edits) return;
    if (!Array.isArray(edits)) {
      const columns = back ? edits.before : edits.after;
      if (columns.some(column => !getColumn(column.field))) return;
      table.blockRedraw();
      try { for (const [index, column] of columns.entries()) { if (index) table.moveColumn(column.field, columns[index - 1].field, true); visibility.set(column.field, column.visible); column.visible ? table.showColumn(column.field) : table.hideColumn(column.field); } }
      finally { table.restoreRedraw(); }
      from.pop(); to.push(edits); updateCount(); return;
    }
    if (edits.some(edit => !table.getRow(edit.id) || !getColumn(edit.field) || !editableColumn(getColumn(edit.field)!))) { notice('읽기 전용 열의 편집은 실행 취소할 수 없습니다.'); return; }
    replaying = true;
    try { batch(() => { for (const edit of back ? [...edits].reverse() : edits) table.getRow(edit.id).getCell(edit.field).setValue(structuredClone(back ? edit.before : edit.after)); }); from.pop(); to.push(edits); }
    finally { replaying = false; }
  };
  const whenReady = (run: () => void): void => { if (disposed) return; if (ready) run(); else pending.push(run); };
  const buffer = (range?: 'active'): GridBufferRow[] => ready ? table.getRows(range).map(row => row.getData() as GridBufferRow) : initial;
  // Persistence pairs rows with record IDs in input order; sorting is presentation only.
  const rows = (): JsonRow[] => model.rows(buffer().slice().sort((a, b) => a._mvpRow - b._mvpRow));
  // The source index of each rows() entry, so a caller can keep where a row came from across a later render.
  const rowIds = (): number[] => buffer().slice().sort((a, b) => a._mvpRow - b._mvpRow).filter(row => !model.blankSlot(row)).map(row => row._mvpRow);
  const notice = (message: string): void => {
    if (options.onNotice) options.onNotice(message);
    else { status.textContent = message; status.title = message; }
  };
  const report = (error: unknown): void => { notice(error instanceof Error ? error.message : String(error)); };
  const emit = (): void => {
    if (disposed || batching) return;
    notice(''); options.onRowsChanged?.(rows(), rowIds()); updateCount();
  };
  const batch = (run: () => void): void => { batching = true; batchEdits = []; try { run(); } finally { batching = false; if (!replaying) remember(batchEdits); batchEdits = []; } emit(); };
  const updateCount = (): void => {
    if (disposed) return;
    const active = buffer('active').filter(row => !model.blankSlot(row)).length;
    count.textContent = active + ' / ' + buffer().filter(row => !model.blankSlot(row)).length + '행';
    columnCount.textContent = ' · ' + visibleColumns().length + ' / ' + model.columns.length + '열';
  };
  const getColumn = (field: string): GridColumn | undefined => model.columns.find(column => column.field === field);
  const typeOf = (column: GridColumn): MvpColumnType | undefined => settings.columnTypes && Object.hasOwn(settings.columnTypes, column.key) ? settings.columnTypes[column.key] : undefined;
  const formatOf = (column: GridColumn): MvpColumnFormat => settings.columnFormats && Object.hasOwn(settings.columnFormats, column.key) ? settings.columnFormats[column.key] : {};
  const editableColumn = (column: GridColumn): boolean => !options.readOnly && !readOnlyKeys.has(column.key);
  const selected = (): CellComponent[] => table.getRanges().flatMap(range => range.getCells().flat()).filter(cell => !!getColumn(cell.getField()));
  let definitionQueue = Promise.resolve();
  const updateDefinition = (column: GridColumn, data?: JsonRow[]): void => {
    // Replacement deletes the old column asynchronously. Overlapping replacements leave duplicate columns.
    const job = definitionQueue.then(async () => {
      if (disposed || !getColumn(column.field)) return;
      table.getRanges().forEach(range => range.remove()); rangeAnchor = rangeCursor = undefined;
      await table.updateColumnDefinition(column.field, definition(column, data));
      if (!disposed && definitionQueue === job) { updateCount(); refreshHeaders(); }
    }).catch(report);
    definitionQueue = job;
  };
  const selectedColumns = (field: string): string[] => {
    const fields = new Set(selected().map(cell => cell.getField()));
    return fields.has(field) ? table.getColumns().map(column => column.getField()).filter(key => fields.has(key)) : [field];
  };
  const focusTyping = (): void => {
    const cell = selected()[0];
    typingTarget.value = ''; composing = false;
    typingTarget.readOnly = !cell || !editableColumn(getColumn(cell.getField())!) || cell.getValue() !== null && typeof cell.getValue() === 'object';
    typingTarget.focus({ preventScroll: true });
  };
  const visibleColumns = (): ColumnComponent[] => table.getColumns().filter(column => !!getColumn(column.getField()) && column.isVisible());
  const replaceRange = (start: CellComponent, end: CellComponent): void => {
    table.getRanges().forEach(range => range.remove());
    // Removing the last range creates an empty one; reuse it instead of retaining an unbounded range.
    const range = table.getRanges()[0];
    if (range) range.setBounds(start, end); else table.addRange(start, end);
  };
  const move = (cell: CellComponent, key: string, reverse: boolean): void => {
    const columns = visibleColumns(), active = table.getRows('active');
    let x = columns.findIndex(column => column.getField() === cell.getField()), y = active.indexOf(cell.getRow());
    if (key === 'Enter') y += reverse ? -1 : 1;
    else if (key === 'ArrowUp' || key === 'ArrowDown') y += key === 'ArrowUp' ? -1 : 1;
    else if (key === 'ArrowLeft' || key === 'ArrowRight') x += key === 'ArrowLeft' ? -1 : 1;
    else {
      x += reverse ? -1 : 1;
      if (x >= columns.length) { x = 0; y++; }
      if (x < 0) { x = columns.length - 1; y--; }
    }
    const next = active[y]?.getCell(columns[x]?.getField());
    if (next) { replaceRange(next, next); rangeAnchor = rangeCursor = next; focusTyping(); }
  };
  const editCell = (cell: CellComponent, onRendered: (run: () => void) => void, success: (value: unknown) => void, cancel: (value: unknown) => void): HTMLElement => {
    const column = getColumn(cell.getField())!;
    const input = labelledInput('셀 편집');
    const seed = editSeed?.cell === cell ? editSeed.text : undefined; editSeed = undefined;
    input.value = seed ?? rawText(cell.getValue());
    let done = false;
    const commit = (): boolean => {
      if (done) return true;
      try { const value = editedValue(input.value, cell.getValue(), typeOf(column)); done = true; success(value); return true; }
      catch (error) { report(error); return false; }
    };
    onRendered(() => { input.focus(); if (seed === undefined) input.select(); else input.setSelectionRange?.(input.value.length, input.value.length); });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done = true; cancel(cell.getValue()); focusTyping(); }
      else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation();
        if (commit()) queueMicrotask(() => { if (!disposed) move(cell, event.key, event.shiftKey); });
      }
    });
    input.addEventListener('blur', () => { if (!done && !commit()) { done = true; cancel(cell.getValue()); } });
    return input;
  };
  const openPanel = (title: string): HTMLDivElement => {
    panel.replaceChildren();
    panel.classList.remove('mvp-grid-column-panel');
    panel.dataset.kind = '';
    panel.setAttribute('aria-label', title);
    const heading = element('div', undefined, 'mvp-grid-panel-heading');
    const close = iconButton('close', '닫기', () => closePanel());
    heading.append(element('strong', title), close);
    const body = element('div', undefined, 'mvp-grid-panel-body');
    panel.append(heading, body); panel.hidden = false;
    queueMicrotask(() => { if (!disposed) panel.querySelector<HTMLElement>('input,select,button')?.focus(); });
    return body;
  };
  const closePanel = (): void => { panel.hidden = true; columnToggle.setAttribute('aria-expanded', 'false'); focusTyping(); };
  const applyFilter = (): void => {
    table.setFilter((row: GridBufferRow) => { if (model.blankSlot(row)) return true; const decoded = model.decode(row); return matchesView(decoded, view) && (!rowFilter || rowFilter(decoded)); });
    updateCount(); refreshHeaders();
  };
  function filterEditor(column: GridColumn): void {
    const content = openPanel(model.label(column, settings) + ' 필터');
    const rule = view.filters.get(column.key);
    const mode = element('select'); mode.setAttribute('aria-label', '필터 조건');
    for (const [value, label] of [['values', '값 선택'], ['includes', '검색어 포함'], ['exclude', '검색어 제외']]) {
      const option = element('option', label); option.value = value; mode.append(option);
    }
    mode.value = rule?.mode || 'values';
    const choices = new Map(rows().map(row => [valueToken(row[column.key]), choiceText(row[column.key])]));
    const checked = new Set(rule?.mode === 'values' ? rule.values : choices.keys());
    const search = labelledInput('필터 값 검색', 'search'); search.placeholder = '값 검색';
    const list = element('div', undefined, 'mvp-grid-choices');
    const all = element('label', undefined, 'mvp-grid-check');
    const allCheck = labelledInput('검색된 값 전체 선택', 'checkbox'); all.append(allCheck, element('span', '전체 선택'));
    const terms = element('textarea'); terms.setAttribute('aria-label', '검색값 목록'); terms.placeholder = '한 줄에 하나씩';
    terms.value = rule && rule.mode !== 'values' ? rule.terms.join('\n') : '';
    const shown = (): [string, string][] => [...choices].filter(([, text]) => text.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    const draw = (): void => {
      list.replaceChildren();
      const entries = shown();
      allCheck.checked = entries.length > 0 && entries.every(([token]) => checked.has(token));
      allCheck.indeterminate = entries.some(([token]) => checked.has(token)) && !allCheck.checked;
      for (const [token, text] of entries) {
        const line = element('label', undefined, 'mvp-grid-check'), check = labelledInput(text, 'checkbox');
        check.checked = checked.has(token);
        check.addEventListener('change', () => { check.checked ? checked.add(token) : checked.delete(token); draw(); });
        line.append(check, element('span', text)); list.append(line);
      }
    };
    allCheck.addEventListener('change', () => { for (const [token] of shown()) allCheck.checked ? checked.add(token) : checked.delete(token); draw(); });
    search.addEventListener('input', draw);
    const switchMode = (): void => { const values = mode.value === 'values'; search.hidden = all.hidden = list.hidden = !values; terms.hidden = values; };
    mode.addEventListener('change', switchMode);
    const actions = element('div', undefined, 'mvp-grid-panel-actions');
    actions.append(button('필터 해제', () => { view.filters.delete(column.key); applyFilter(); closePanel(); }), button('적용', () => {
      if (mode.value === 'values') view.filters.set(column.key, { mode: 'values', values: [...checked] });
      else {
        const entries = terms.value.split(/\r?\n/).map(term => term.trim()).filter(Boolean);
        if (!entries.length) { report('검색값을 입력하세요.'); return; }
        view.filters.set(column.key, { mode: mode.value as 'exact' | 'includes' | 'exclude', terms: entries });
      }
      applyFilter(); closePanel();
    }));
    content.append(mode, search, all, list, terms, actions); draw(); switchMode();
  }
  function columnChooser(): void {
    if (!panel.hidden && panel.dataset.kind === 'columns') { closePanel(); return; }
    const content = openPanel('속성');
    panel.dataset.kind = 'columns'; columnToggle.setAttribute('aria-expanded', 'true');
    panel.classList.add('mvp-grid-column-panel');
    if (typeof window !== 'undefined') {
      const box = host.getBoundingClientRect();
      const top = Math.max(12, Math.min(box.top + 28, window.innerHeight - 260));
      panel.style.setProperty('--column-panel-top', top + 'px');
      panel.style.setProperty('--column-panel-right', Math.max(12, window.innerWidth - box.right + 6) + 'px');
    }
    const search = labelledInput('열 검색', 'search'); search.placeholder = '표시명 또는 원천 키 검색';
    const groups = element('div', undefined, 'mvp-grid-column-groups');
    const list = element('div', undefined, 'mvp-grid-choices');
    const categories: [string, (column: GridColumn) => boolean][] = [
      ['전체 열', () => true],
      ['빈 값 열', column => !column.user && buffer().every(row => isEmpty(row[column.field]))],
      ['미매핑 열', column => !column.user && !Object.prototype.hasOwnProperty.call(settings.dictionary.keys, column.key)],
      ['사용자 열', column => column.user],
    ];
    const shown = (): GridColumn[] => model.columns.filter(column => (model.label(column, settings) + ' ' + column.key).toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    const setVisible = (columns: GridColumn[], visible: boolean): void => {
      changeColumns(() => { for (const column of columns) { visibility.set(column.field, visible); visible ? table.showColumn(column.field) : table.hideColumn(column.field); } });
      draw();
    };
    const draw = (): void => {
      list.replaceChildren(); groups.replaceChildren();
      const columns = shown();
      for (const [label, matches] of categories) {
        const members = columns.filter(matches), group = element('div', undefined, 'mvp-grid-column-group');
        const line = element('label', undefined, 'mvp-grid-check'), check = labelledInput(label + ' 표시', 'checkbox');
        const visible = members.filter(column => table.getColumn(column.field).isVisible()).length;
        check.checked = members.length > 0 && visible === members.length; check.indeterminate = visible > 0 && visible < members.length; check.disabled = members.length === 0;
        check.addEventListener('change', () => setVisible(members, check.checked));
        line.append(check, element('span', label + ' (' + members.length + ')'));
        const show = button('표시', () => setVisible(members, true)), hide = button('숨김', () => setVisible(members, false));
        show.setAttribute('aria-label', label + ' 모두 표시'); hide.setAttribute('aria-label', label + ' 모두 숨김');
        show.disabled = hide.disabled = members.length === 0;
        group.append(line, show, hide); groups.append(group);
      }
      for (const column of columns) {
        const line = element('label', undefined, 'mvp-grid-check'), check = labelledInput(model.label(column, settings) + ' 표시', 'checkbox');
        check.checked = table.getColumn(column.field).isVisible();
        check.addEventListener('change', () => setVisible([column], check.checked));
        const name = element('span', model.label(column, settings)); name.append(element('small', column.key || '(빈 키)'));
        line.title = '우클릭: 키 사전 추가';
        line.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); renameColumn(column, '키 사전 추가'); });
        line.append(check, name);
        const output = options.output?.(column.key);
        if (output === undefined) { list.append(line); continue; }
        // '출력 제외' is apart from showing: hiding a column or filtering never changes what documents get (user, 2026-10-09, #46).
        const row = element('div', undefined, 'mvp-grid-choice-row'), exclude = labelledInput(model.label(column, settings) + ' 출력 제외', 'checkbox'), toggle = element('label', undefined, 'mvp-grid-output');
        exclude.checked = !output; exclude.addEventListener('change', () => options.onOutput?.(column.key, !exclude.checked));
        toggle.title = '문서에 넣지 않습니다'; toggle.append(exclude, element('span', '출력 제외')); row.append(line, toggle); list.append(row);
      }
    };
    search.addEventListener('input', draw);
    const groupHeading = element('div', undefined, 'mvp-grid-group-heading');
    const fold = iconButton('up', '열 분류 접기', () => { groups.hidden = !groups.hidden; setIcon(fold, groups.hidden ? 'down' : 'up', groups.hidden ? '열 분류 펼치기' : '열 분류 접기'); fold.setAttribute('aria-expanded', String(!groups.hidden)); });
    fold.setAttribute('aria-expanded', 'true');
    groupHeading.append(element('strong', '열 분류'), fold);
    // 열 분류 / 테이블 분류 tabs (user, #28). Settings are changed here directly, not through a link to the settings window.
    const tabs = element('div', undefined, 'mvp-grid-panel-tabs'), columnPane = element('div', undefined, 'mvp-grid-panel-pane'), tablePane = element('div', undefined, 'mvp-grid-panel-pane');
    tabs.setAttribute('role', 'tablist'); tablePane.hidden = true;
    for (const [label, pane] of [['열 분류', columnPane], ['테이블 분류', tablePane]] as const) {
      const tab = button(label, () => { columnPane.hidden = pane !== columnPane; tablePane.hidden = pane !== tablePane; for (const other of tabs.children) other.setAttribute('aria-selected', String(other === tab)); });
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(pane === columnPane)); tabs.append(tab);
    }
    const settingCheck = (label: string, key: 'hideEmptyColumns' | 'hideUnmappedColumns' | 'hideEmptyTables', redraw: boolean, enabled = true): HTMLLabelElement => {
      const line = element('label', undefined, 'mvp-grid-check'), check = labelledInput(label, 'checkbox');
      check.checked = !!settings[key]; check.disabled = !enabled;
      check.addEventListener('change', () => { options.onSettings?.({ [key]: check.checked }); if (redraw && !disposed) draw(); });
      line.append(check, element('span', label)); return line;
    };
    columnPane.append(search, groupHeading, groups, list);
    if (options.onSettings) columnPane.append(settingCheck('빈 열 숨김', 'hideEmptyColumns', true), settingCheck('사전 미등록 열 숨김', 'hideUnmappedColumns', true));
    if (!options.readOnly) columnPane.append(button('사용자 열 추가', addColumnDialog));
    // Table settings apply to the extraction table list; elsewhere they are shown but cannot be changed.
    const tableEnabled = !!options.onSettings && !!options.tableSettings;
    const extraction = element('select'); extraction.setAttribute('aria-label', '추출 범위'); extraction.disabled = !tableEnabled;
    for (const [value, label] of [['tables', '테이블만'], ['all', '전체']]) { const option = element('option', label); option.value = value; extraction.append(option); }
    extraction.value = settings.extractionMode;
    extraction.addEventListener('change', () => options.onSettings?.({ extractionMode: extraction.value as MvpSettings['extractionMode'] }));
    const range = element('label', undefined, 'mvp-grid-check'); range.append(element('span', '추출 범위'), extraction);
    tablePane.append(settingCheck('빈 테이블 숨김', 'hideEmptyTables', false, tableEnabled), range);
    if (!tableEnabled) tablePane.title = '추출 화면에서 바꿀 수 있습니다.';
    content.append(tabs, columnPane, tablePane);
    draw();
  }
  function renameColumn(column: GridColumn, title = '표시명 설정'): void {
    const content = openPanel(title);
    const input = labelledInput('열 표시명'); input.value = model.label(column, settings);
    content.append(element('p', '원천 키: ' + (column.key || '(빈 키)')), input, button('적용', () => {
      const label = input.value.trim(); if (!label) { report('표시명을 입력하세요.'); return; }
      settings.dictionary.keys = { ...settings.dictionary.keys, [column.key]: label };
      updateDefinition(column);
      options.onColumnRename?.(column.key, label); closePanel();
    }));
  }
  function setType(column: GridColumn, type: MvpColumnType): void {
    settings.columnTypes = { ...settings.columnTypes, [column.key]: type };
    updateDefinition(column);
    table.getRows().forEach(row => row.reformat()); options.onColumnType?.(column.key, type);
  }
  function addColumnDialog(): void {
    if (options.readOnly) return;
    const content = openPanel('사용자 열 추가');
    const input = labelledInput('사용자 열 이름'); input.placeholder = '열 이름';
    content.append(input, button('추가', () => { try { handle.addColumn(input.value); closePanel(); } catch (error) { report(error); } }));
  }
  function refreshHeaders(): void {
    for (const column of model.columns) {
      const header = table.getColumn(column.field)?.getElement();
      const filter = header?.querySelector<HTMLButtonElement>('.mvp-grid-filter');
      if (filter) { filter.classList.toggle('is-active', view.filters.has(column.key)); filter.setAttribute('aria-pressed', String(view.filters.has(column.key))); }
    }
  }
  function rowDeleteMenu(row: RowComponent): { label: string; disabled: boolean; action: () => void }[] {
    const data = row.getData() as GridBufferRow;
    const disabled = !!options.readOnly || !options.allowRowDelete || model.blankSlot(data) || !!options.onDeleteRows && !model.originalIds.has(data._mvpRow);
    return [{ label: '행 삭제', disabled, action: () => {
      if (disabled || disposed) return;
      if (options.onDeleteRows) options.onDeleteRows([model.decode(data)], [data._mvpRow]);
      else void table.deleteRow(data._mvpRow).then(() => { if (!disposed) { undo.length = redo.length = 0; emit(); void extendSlots(); } }).catch(report);
    } }];
  }
  function definition(column: GridColumn, sourceRows?: JsonRow[]): ColumnDefinition {
    const menu = [
      { label: '열 필터', action: () => filterEditor(column) },
      { label: '열 숨기기', action: () => changeColumns(() => { visibility.set(column.field, false); table.hideColumn(column.field); }) },
      { label: '선택 열 숨기기', action: () => { const fields = selectedColumns(column.field); changeColumns(() => { for (const field of fields) { visibility.set(field, false); table.hideColumn(field); } }); } },
      { label: '열 이동·숨김 취소', action: () => replay(true) },
      { label: '속성', action: columnChooser },
      { label: '표시명 설정', action: () => renameColumn(column) },
      { label: '열 타입', menu: (Object.keys(columnTypeLabels) as MvpColumnType[]).map(type => ({ label: columnTypeLabels[type], action: () => setType(column, type) })) },
      { label: '열 서식', action: () => formatColumn(column) },
      { label: '자동 너비', action: () => {
        const context = document.createElement('canvas').getContext('2d'); if (!context) return;
        context.font = getComputedStyle(host).font;
        const labels = [model.label(column, settings), ...buffer('active').slice(0, 200).map(row => formatValue(row[column.field], typeOf(column), formatOf(column)))];
        table.getColumn(column.field).setWidth(Math.min(600, Math.max(85, ...labels.map(text => context.measureText(text).width + 42))));
      } },
      ...(!options.readOnly ? [{ label: '사용자 열 추가', action: addColumnDialog }, ...(column.user && editableColumn(column) ? [{ label: '사용자 열 삭제', action: () => handle.removeColumn(column.key) }] : [])] : []),
    ];
    return {
      field: column.field, title: model.label(column, settings), headerTooltip: column.key || '(빈 키)',
      width: widths.get(column.field) ?? 150, minWidth: 85, headerSort: true, visible: visibility.get(column.field) ?? (column.user ? userColumnsVisible : model.visible(column, sourceRows ?? rows(), settings)),
      hozAlign: ['money', 'number', 'percent'].includes(typeOf(column) || '') ? 'right' : typeOf(column) === 'boolean' ? 'center' : 'left',
      headerContextMenu: menu, editor: options.readOnly ? undefined : editCell,
      // Tabulator 6.5 loadMenuEvent accepts functions; @types 6.3 declares only arrays.
      contextMenu: (options.onValueDictionary || options.allowRowDelete ? (_event: UIEvent, cell: CellComponent) => [
        ...(options.onValueDictionary ? [{ label: '값 사전 추가', action: () => { const chosen = selected(),included = chosen.some(candidate => candidate.getField() === cell.getField() && candidate.getRow().getData()._mvpRow === cell.getRow().getData()._mvpRow); const entries = (included ? chosen.filter(candidate => !model.blankSlot(candidate.getRow().getData() as GridBufferRow)) : [cell]).map(candidate => ({ key: getColumn(candidate.getField())!.key, value: candidate.getValue() })); if (entries.length > 1) options.onValueDictionary?.(column.key, cell.getValue(), entries); else options.onValueDictionary?.(column.key, cell.getValue()); } }] : []),
        ...(options.allowRowDelete ? rowDeleteMenu(cell.getRow()) : []),
      ] : undefined) as unknown as ColumnDefinition['contextMenu'],
      editable: cell => editableColumn(column) && (cell.getValue() === null || typeof cell.getValue() !== 'object'),
      formatterClipboard: false,
      accessorClipboard: value => rawText(value),
      sorter: (a: unknown, b: unknown, rowA: RowComponent, rowB: RowComponent, _column: ColumnComponent, dir: string) => {
        const blankA = model.blankSlot(rowA.getData() as GridBufferRow), blankB = model.blankSlot(rowB.getData() as GridBufferRow);
        if (blankA !== blankB) return (blankA ? 1 : -1) * (dir === 'desc' ? -1 : 1);
        return compareValues(a, b, typeOf(column));
      },
      titleFormatter: () => {
        const title = element('span', undefined, 'mvp-grid-column-title');
        // Tabulator intentionally blocks its header move while whole-column range selection is active.
        // A native drag grip keeps column selection and column moves available through public APIs.
        const drag = element('span', '⠿', 'mvp-grid-drag'); drag.draggable = true; drag.tabIndex = 0;
        drag.title = '드래그하여 열 이동'; drag.setAttribute('aria-label', model.label(column, settings) + ' 열 이동');
        drag.addEventListener('mousedown', event => event.stopPropagation());
        drag.addEventListener('dragstart', event => { event.stopPropagation(); event.dataTransfer?.setData('application/x-g2b-grid-column', JSON.stringify(selectedColumns(column.field))); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; });
        title.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('application/x-g2b-grid-column')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
        title.addEventListener('drop', event => {
          let fields: unknown; try { fields = JSON.parse(event.dataTransfer?.getData('application/x-g2b-grid-column') || 'null'); } catch { return; }
          if (!Array.isArray(fields) || !fields.length || fields.length > model.columns.length || fields.some(field => typeof field !== 'string' || !getColumn(field)) || new Set(fields).size !== fields.length || fields.includes(column.field)) return;
          event.preventDefault(); event.stopPropagation();
          const box = title.getBoundingClientRect(),after = event.clientX > box.x + box.width / 2;
          changeColumns(() => { table.blockRedraw(); try { for (const field of after ? fields.slice().reverse() : fields) table.moveColumn(field, column.field, after); } finally { table.restoreRedraw(); } });
        });
        const name = element('span', model.label(column, settings));
        const filter = button('', () => filterEditor(column)); filter.append(filterIcon());
        filter.className = 'mvp-grid-filter'; filter.title = '필터';
        filter.setAttribute('aria-label', model.label(column, settings) + ' 필터'); filter.setAttribute('aria-pressed', String(view.filters.has(column.key)));
        filter.classList.toggle('is-active', view.filters.has(column.key));
        for (const event of ['click', 'mousedown', 'pointerdown', 'dblclick']) filter.addEventListener(event, e => e.stopPropagation());
        title.append(name, filter, drag); return title;
      },
      formatter: cell => {
        const value = cell.getValue(), span = element('span');
        const dictionary = Object.hasOwn(settings.dictionary.values, column.key) ? settings.dictionary.values[column.key] : undefined;
        const label = value !== null && typeof value === 'object' ? options.nestedLabel?.(cell.getRow().getData()._mvpRow, column.key) : undefined;
        span.textContent = dictionary && Object.prototype.hasOwnProperty.call(dictionary, String(value)) ? dictionary[String(value)] : value !== null && typeof value === 'object' ? label || nestedPreview(value) : formatValue(value, typeOf(column), formatOf(column));
        span.title = label || (Array.isArray(value) ? '눌러서 표 보기' : rawText(value));
        if (value !== null && typeof value === 'object') {
          span.className = 'mvp-grid-nested'; span.setAttribute('role', 'button'); span.tabIndex = 0;
          span.setAttribute('aria-label', model.label(column, settings) + ' 상세 보기');
          const open = (): void => openNested(cell, column);
          span.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(); });
          span.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open(); } });
        }
        return span;
      },
    };
  }
  function formatColumn(column: GridColumn): void {
    const content = openPanel(model.label(column, settings) + ' 서식'), format = formatOf(column), type = typeOf(column);
    const decimals = labelledInput('소수 자릿수', 'number'); decimals.min = '0'; decimals.max = '20'; decimals.step = '1'; decimals.placeholder = '원본 유지'; decimals.value = format.decimals === undefined ? '' : String(format.decimals);
    const grouping = labelledInput('천 단위 구분', 'checkbox'); grouping.checked = format.grouping ?? type === 'money';
    const date = element('select'); date.setAttribute('aria-label', '날짜 표시');
    for (const [value, label] of [['dot', 'YYYY.MM.DD'], ['dash', 'YYYY-MM-DD'], ['compact', 'YYYYMMDD']]) { const option = element('option', label); option.value = value; date.append(option); } date.value = format.dateFormat || 'dot';
    const line = (name: string, input: HTMLElement): HTMLLabelElement => { const label = element('label', name, 'mvp-grid-format-line'); label.append(input); return label; };
    if (['number', 'money', 'percent'].includes(type || '')) content.append(line('소수 자릿수', decimals), line('천 단위 구분', grouping));
    if (type === 'date' || type === 'datetime') content.append(line('날짜 표시', date));
    if (!['number', 'money', 'percent', 'date', 'datetime'].includes(type || '')) content.append(element('p', '숫자 또는 날짜 타입을 선택하면 표시 서식을 설정할 수 있습니다.'));
    if (type === 'percent') content.append(element('p', '12.5 → 12.5%. 원본 숫자는 유지합니다.'));
    content.append(button('적용', () => {
      const number = decimals.value === '' ? undefined : Number(decimals.value);
      if (number !== undefined && (!Number.isInteger(number) || number < 0 || number > 20)) { notice('소수 자릿수는 0~20의 정수입니다.'); return; }
      const next: MvpColumnFormat = {};
      if (['number', 'money', 'percent'].includes(type || '')) { if (number !== undefined) next.decimals = number; next.grouping = grouping.checked; }
      if (type === 'date' || type === 'datetime') next.dateFormat = date.value as MvpColumnFormat['dateFormat'];
      handle.setSettings({ ...settings, columnFormats: { ...settings.columnFormats, [column.key]: next } }); options.onColumnFormat?.(column.key, next); closePanel();
    }));
  }
  function openNested(cell: CellComponent, column: GridColumn): void {
    const value = cell.getValue();
    if (value === null || typeof value !== 'object') return;
    const nested = (Array.isArray(value) ? value : [value]).map(item => item !== null && typeof item === 'object' && !Array.isArray(item) ? structuredClone(item) as JsonRow : { value: structuredClone(item) });
    options.onNested?.(model.decode(cell.getRow().getData() as GridBufferRow), column.key, nested);
  }
  async function extendSlots(): Promise<void> {
    if (!ready || disposed || extending) return;
    const current = buffer(); let lastRecord = -1;
    current.forEach((row, index) => { if (!model.blankSlot(row)) lastRecord = index; });
    const needed = Math.max(16, Math.ceil(host.clientHeight / 24) + 3) - (current.length - lastRecord - 1);
    if (needed > 0) {
      extending = true;
      try { await table.addData(model.slots(needed), false); }
      finally { extending = false; }
    }
  }
  const pasteRows = (data: unknown[]): RowComponent[] => {
    if (options.readOnly) return [];
    const values = data.map(row => Array.isArray(row) ? row : Object.values(row as object));
    const start = selected()[0]; if (!start || !values.length) return [];
    const columns = visibleColumns(), active = table.getRows('active');
    const x = columns.findIndex(column => column.getField() === start.getField()), y = active.indexOf(start.getRow());
    try {
      if (values.reduce((n, row) => n + row.length, 0) > 10000) throw new Error('한 번에 10,000셀까지 붙여넣을 수 있습니다.');
      if (y + values.length > active.length || values.some(row => x + row.length > columns.length)) throw new Error('붙여넣을 범위가 표보다 큽니다. 먼저 사용자 열을 추가하세요.');
      const edits: [CellComponent, unknown][] = [];
      values.forEach((row, dy) => row.forEach((value, dx) => {
        const cell = active[y + dy].getCell(columns[x + dx].getField()), column = getColumn(cell.getField())!;
        if (!editableColumn(column)) throw new Error('계산 또는 읽기 전용 열에는 붙여넣을 수 없습니다.');
        if (cell.getValue() !== null && typeof cell.getValue() === 'object') throw new Error('상세 자료 셀에는 붙여넣을 수 없습니다.');
        edits.push([cell, editedValue(String(value), cell.getValue(), typeOf(column))]);
      }));
      batch(() => { for (const [cell, value] of edits) cell.setValue(value); }); void extendSlots();
      return active.slice(y, y + values.length);
    } catch (error) { report(error); return []; }
  };
  // '속성' lives in the row-number header (user, #28); a header click must not sort or select.
  const columnToggle = button('속성', () => whenReady(columnChooser)); columnToggle.className = 'mvp-grid-properties'; columnToggle.setAttribute('aria-expanded', 'false');
  for (const event of ['click', 'mousedown', 'pointerdown', 'dblclick']) columnToggle.addEventListener(event, e => e.stopPropagation());
  const order = new Map(saved?.columns.map((column, index) => [column.key, index]));
  // Restore the order before construction: repeated moveColumn calls each relayout the whole sheet.
  const orderedColumns = model.columns.slice().sort((a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  table = new Tabulator(host, {
    data: [...initial, ...model.slots(Math.max(16, Math.ceil(host.clientHeight / 24) + 3))],
    index: '_mvpRow', height: '100%', rowHeight: 24, layout: 'fitData', nestedFieldSeparator: false, popupContainer: root,
    movableColumns: true, selectableRange: true, selectableRangeColumns: true, selectableRangeRows: true,
    selectableRangeClearCells: false, headerSortClickElement: 'icon', editTriggerEvent: 'dblclick',
    clipboard: true, clipboardCopyRowRange: 'range', clipboardCopyStyled: false,
    clipboardCopyConfig: { rowHeaders: false, columnHeaders: false },
    clipboardPasteParser: (text: string) => { try { return parseClipboard(text); } catch (error) { report(error); return false; } }, clipboardPasteAction: pasteRows,
    rowHeader: { formatter: 'rownum', titleFormatter: () => columnToggle, width: 44, headerSort: false, resizable: false, frozen: true },
    rowContextMenu: options.allowRowDelete ? (_event: UIEvent, row: RowComponent) => rowDeleteMenu(row) : undefined,
    columns: orderedColumns.map(column => definition(column, options.rows)), placeholder: '자료가 없습니다. 사용자 열을 추가하여 입력할 수 있습니다.',
  } as any);
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { void extendSlots(); });
  table.on('tableBuilt', () => {
    if (disposed) return; ready = true; resize?.observe(host);
    if (saved?.sorters.length) table.setSort(saved.sorters.flatMap(sort => { const column = model.columns.find(column => column.key === sort.key); return column ? [{ column: column.field, dir: sort.dir }] : []; }));
    if (view.search || view.filters.size) applyFilter(); pending.splice(0).forEach(run => run()); updateCount();
  });
  table.on('cellEdited', (cell: CellComponent) => {
    const column = cell && getColumn(cell.getField());
    if (!replaying && column && editableColumn(column)) {
      const edit = { id: cell.getRow().getData()._mvpRow as number, field: cell.getField(), before: structuredClone(cell.getOldValue()), after: structuredClone(cell.getValue()) };
      if (batching) batchEdits.push(edit); else remember([edit]);
    }
    emit(); void extendSlots();
  });
  table.on('dataFiltered', updateCount);
  table.on('columnVisibilityChanged', updateCount);
  table.on('clipboardPasted', () => { void extendSlots(); });
  table.on('cellClick', (_event: UIEvent, cell: CellComponent) => { const column = getColumn(cell.getField()); if (column) openNested(cell, column); });
  const focusSelection = (event: MouseEvent): void => {
    const target = event.target;
    if (!ready || !(target instanceof Element) || target.closest('input,textarea,button,.mvp-grid-nested')) return;
    if (target.closest('.tabulator-cell,.tabulator-range-overlay')) {
      // Tabulator initializes range focus after the native click handler. Focus the text
      // target only after that dispatch, and never take focus from a visible cell editor.
      // Native click listeners can have microtask checkpoints between them. A new task
      // runs after Tabulator's document-level click focus dispatch has completed.
      setTimeout(() => { if (!disposed && !host.querySelector('.tabulator-cell.tabulator-editing')) { rangeAnchor = rangeCursor = selected()[0]; focusTyping(); } }, 0);
    }
  };
  const keydown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopPropagation(); closePanel(); return; }
    const target = event.target;
    if (!ready || !(target instanceof Element) || target !== typingTarget && target.closest('input,textarea,select,button,.mvp-grid-nested')) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopImmediatePropagation(); replay(event.key.toLowerCase() === 'z' && !event.shiftKey); return; }
    if (options.readOnly) return;
    const cell = selected()[0]; if (!cell) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopImmediatePropagation();
      batch(() => { for (const selectedCell of selected()) { if (editableColumn(getColumn(selectedCell.getField())!) && (selectedCell.getValue() === null || typeof selectedCell.getValue() !== 'object')) selectedCell.setValue(''); } });
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation(); move(cell, event.key, event.shiftKey);
    } else if (target === typingTarget && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.shiftKey) {
        const end = rangeCursor || cell, anchor = rangeAnchor || cell, columns = visibleColumns(), active = table.getRows('active');
        const x = columns.findIndex(column => column.getField() === end.getField()) + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0);
        const y = active.indexOf(end.getRow()) + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0);
        const next = active[y]?.getCell(columns[x]?.getField());
        if (next) { replaceRange(anchor, next); rangeAnchor = anchor; rangeCursor = next; focusTyping(); }
      } else move(cell, event.key, false);
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); table.getRanges().forEach(range => range.remove());
    } else if (event.key === 'F2' || event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!editableColumn(getColumn(cell.getField())!) || cell.getValue() !== null && typeof cell.getValue() === 'object') return;
      event.preventDefault(); event.stopImmediatePropagation();
      editSeed = event.key === 'F2' ? undefined : { cell, text: event.key }; cell.edit(); editSeed = undefined;
    }
  };
  const acceptText = (): void => {
    if (composing || !typingTarget.value || !ready || disposed) return;
    const text = typingTarget.value; typingTarget.value = '';
    const cell = selected()[0];
    if (!cell || !editableColumn(getColumn(cell.getField())!) || cell.getValue() !== null && typeof cell.getValue() === 'object') return;
    editSeed = { cell, text }; cell.edit(); editSeed = undefined;
  };
  typingTarget.addEventListener('compositionstart', () => { composing = true; });
  typingTarget.addEventListener('compositionend', () => { composing = false; acceptText(); });
  typingTarget.addEventListener('input', event => { if (!(event as InputEvent).isComposing) acceptText(); });
  typingTarget.addEventListener('paste', event => {
    event.preventDefault(); event.stopPropagation();
    try { pasteRows(parseClipboard(event.clipboardData?.getData('text/plain') || '')); } catch (error) { report(error); }
  });
  typingTarget.addEventListener('copy', event => {
    // RangeComponent calls getCells(true,true); its runtime returns rows of cell components.
    const cells = table.getRanges()[0]?.getCells() as unknown as CellComponent[][] | undefined; if (!cells) return;
    const text = cells.map(line => line.filter(cell => !!getColumn(cell.getField())).map(cell => {
      const value = rawText(cell.getValue()); return /[\t\r\n"]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
    }).join('\t')).join('\n');
    event.clipboardData?.setData('text/plain', text); event.preventDefault(); event.stopPropagation();
  });
  host.addEventListener('click', focusSelection); root.addEventListener('keydown', keydown, true);
  const handle: GridRendererHandle = {
    rows: () => structuredClone(rows()),
    getSelectedRows: () => {
      if (!ready) return [];
      const ids = new Set(selected().map(cell => (cell.getRow().getData() as GridBufferRow)._mvpRow));
      return buffer('active').filter(row => ids.has(row._mvpRow) && !model.blankSlot(row)).map(row => ({ sourceIndex: row._mvpRow, row: structuredClone(model.decode(row)) }));
    },
    getViewState: (): GridViewState => ({ search: view.search, combine: view.combine, userColumnsVisible, filters: structuredClone([...view.filters]), columns: ready ? table.getColumns().flatMap(column => { const source = getColumn(column.getField()); return source ? [{ key: source.key, width: column.getWidth(), visible: column.isVisible() }] : []; }) : saved?.columns || [], sorters: ready ? table.getSorters().flatMap(sort => { const column = getColumn(sort.field); return column ? [{ key: column.key, dir: sort.dir }] : []; }) : saved?.sorters || [] }),
    setSearch: search => { view.search = search; whenReady(applyFilter); },
    clearColumnFilters: () => { view.filters.clear(); whenReady(applyFilter); },
    setRowFilter: predicate => { rowFilter = predicate; whenReady(applyFilter); },
    setSettings: next => {
      const hideChanged = next.hideEmptyColumns !== settings.hideEmptyColumns || next.hideUnmappedColumns !== settings.hideUnmappedColumns;
      const columnsChanged = (['hideEmptyColumns', 'hideUnmappedColumns', 'dictionary', 'columnTypes', 'columnFormats'] as const).some(key => JSON.stringify(next[key]) !== JSON.stringify(settings[key]));
      settings = structuredClone(next); root.dataset.theme = settings.theme;
      if (!columnsChanged) return;
      whenReady(() => {
        for (const column of table.getColumns()) if (getColumn(column.getField())) widths.set(column.getField(), column.getWidth());
        if (hideChanged) visibility.clear();
        const data = rows();
        for (const column of model.columns) {
          updateDefinition(column, data);
          const visible = visibility.get(column.field) ?? (column.user ? userColumnsVisible : model.visible(column, data, settings));
          visible ? table.showColumn(column.field) : table.hideColumn(column.field);
        }
        table.getRows().forEach(row => row.reformat()); applyFilter();
      });
    },
    setUserColumnsVisible: (visible: boolean) => {
      userColumnsVisible = visible;
      whenReady(() => { for (const column of model.columns.filter(column => column.user)) { visibility.set(column.field, visible); visible ? table.showColumn(column.field) : table.hideColumn(column.field); } });
    },
    toggleSelectedBoolean: (key: string) => whenReady(() => {
      const column = model.columns.find(candidate => candidate.key === key);
      if (!column?.user || !editableColumn(column)) { report('편집 가능한 사용자 불리언 열만 반전할 수 있습니다.'); return; }
      const chosen = [...new Map(selected().map(cell => [cell.getRow().getData()._mvpRow, cell.getRow()])).values()]
        .filter(row => !model.blankSlot(row.getData() as GridBufferRow));
      if (!chosen.length) { report('먼저 행의 셀을 선택하세요.'); return; }
      if (chosen.some(row => typeof row.getData()[column.field] !== 'boolean')) { report('선택 행의 값이 불리언이 아닙니다.'); return; }
      batch(() => { for (const row of chosen) { const cell = row.getCell(column.field); cell.setValue(!cell.getValue()); } });
    }),
    updateDerivedValues: (compute: (row: JsonRow) => JsonRow) => whenReady(() => {
      const wasBatching = batching; batching = true;
      try {
        for (const row of table.getRows()) {
          const data = row.getData() as GridBufferRow;
          if (model.blankSlot(data)) continue;
          const patch = compute(model.decode(data));
          for (const column of model.columns) {
            if (readOnlyKeys.has(column.key) && Object.prototype.hasOwnProperty.call(patch, column.key)) row.getCell(column.field).setValue(structuredClone(patch[column.key]));
          }
        }
      } finally { batching = wasBatching; }
      updateCount();
    }),
    addColumn: key => {
      if (options.readOnly || disposed) return;
      const column = model.addColumn(key);
      undo.length = redo.length = 0;
      whenReady(() => { void table.addColumn(definition(column)).then(() => {
        replaying = true; try { batch(() => table.getRows().forEach(row => row.getCell(column.field).setValue(''))); } finally { replaying = false; }
        options.onUserColumnsChanged?.(model.columns.filter(candidate => candidate.user).map(candidate => candidate.key));
      }); });
    },
    removeColumn: key => {
      if (options.readOnly || disposed) return;
      if (readOnlyKeys.has(key)) { report('읽기 전용 열은 삭제할 수 없습니다. 열 숨기기를 사용하세요.'); return; }
      const column = model.removeColumn(key); if (!column) return;
      undo.length = redo.length = 0;
      view.filters.delete(key); visibility.delete(column.field);
      whenReady(() => { table.deleteColumn(column.field); emit(); applyFilter(); options.onUserColumnsChanged?.(model.columns.filter(candidate => candidate.user).map(candidate => candidate.key)); });
    },
    exportExcel: filename => whenReady(() => {
      const columns = visibleColumns().map(column => { const source = getColumn(column.getField())!; return { key: source.key, label: model.label(source, settings) }; });
      const book = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(exportMatrix(model.rows(buffer('active')), columns));
      sheet['!cols'] = visibleColumns().map(column => ({ wpx: column.getWidth() }));
      const data = model.rows(buffer('active'));
      columns.forEach((column, x) => data.forEach((row, y) => {
        const type = settings.columnTypes?.[column.key], format = settings.columnFormats?.[column.key], address = XLSX.utils.encode_cell({ r: y + 1, c: x });
        const value = excelValue(row[column.key], type);
        if (value === undefined || value === null) return;
        const display = type === 'date' || type === 'datetime' ? formatValue(value, type, format) : value;
        const cell = sheet[address]; if (!cell) return;
        cell.v = display as string | number | boolean; cell.t = typeof display === 'number' ? 'n' : typeof display === 'boolean' ? 'b' : 's'; cell.z = excelFormat(type, format);
      }));
      XLSX.utils.book_append_sheet(book, sheet, '자료');
      XLSX.writeFile(book, /\.xlsx$/i.test(filename) ? filename : filename + '.xlsx');
    }),
    exportCsv: filename => whenReady(() => {
      const columns = visibleColumns().map(column => { const source = getColumn(column.getField())!; return { key: source.key, label: model.label(source, settings) }; });
      const sheet = XLSX.utils.aoa_to_sheet(exportMatrix(model.rows(buffer('active')), columns));
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '자료');
      XLSX.writeFile(book, /\.csv$/i.test(filename) ? filename : filename + '.csv', { bookType: 'csv' });
    }),
    destroy: () => {
      if (disposed) return; disposed = true; ready = false; pending.length = 0; resize?.disconnect();
      host.removeEventListener('click', focusSelection); root.removeEventListener('keydown', keydown, true); table.destroy(); root.remove();
    },
  };
  return handle;
}

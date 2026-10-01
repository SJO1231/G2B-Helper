import { TabulatorFull as Tabulator, type CellComponent, type ColumnDefinition, type ColumnComponent, type RowComponent } from 'tabulator-tables';
import * as XLSX from 'xlsx';
import 'tabulator-tables/dist/css/tabulator.min.css';
import './grid.css';
import type { GridRendererHandle, GridRendererOptions, JsonRow, MvpColumnType, MvpSettings } from './contracts';
import { GridModel, choiceText, editedValue, exportMatrix, formatValue, isEmpty, matchesView, nestedPreview, parseClipboard, rawText, valueToken, type GridBufferRow, type GridColumn, type GridView } from './grid-model';

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
  const view: GridView = { search: '', combine: 'and', filters: new Map() };
  let rowFilter: ((row: JsonRow) => boolean) | undefined;
  const visibility = new Map<string, boolean>();
  const readOnlyKeys = new Set(options.readOnlyColumnKeys || []);
  let userColumnsVisible = true;
  let ready = false, disposed = false, batching = false, extending = false;
  let editSeed: { cell: CellComponent; text: string } | undefined;
  const pending: (() => void)[] = [];
  const root = element('section', undefined, 'mvp-grid');
  root.dataset.theme = settings.theme;
  root.setAttribute('aria-label', options.label);
  const toolbar = element('div', undefined, 'mvp-grid-toolbar');
  const count = element('span', '', 'mvp-grid-count');
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
  root.append(toolbar, host, panel, status, typingTarget); container.append(root);
  let table: Tabulator;
  const whenReady = (run: () => void): void => { if (disposed) return; if (ready) run(); else pending.push(run); };
  const buffer = (range?: 'active'): GridBufferRow[] => ready ? table.getRows(range).map(row => row.getData() as GridBufferRow) : initial;
  // Persistence pairs rows with record IDs in input order; sorting is presentation only.
  const rows = (): JsonRow[] => model.rows(buffer().slice().sort((a, b) => a._mvpRow - b._mvpRow));
  const notice = (message: string): void => {
    if (options.onNotice) options.onNotice(message);
    else { status.textContent = message; status.title = message; }
  };
  const report = (error: unknown): void => { notice(error instanceof Error ? error.message : String(error)); };
  const emit = (): void => {
    if (disposed || batching) return;
    notice(''); options.onRowsChanged?.(rows()); updateCount();
  };
  const batch = (run: () => void): void => { batching = true; try { run(); } finally { batching = false; } emit(); };
  const updateCount = (): void => {
    if (disposed) return;
    const active = buffer('active').filter(row => !model.blankSlot(row)).length;
    count.textContent = active + ' / ' + buffer().filter(row => !model.blankSlot(row)).length + '행';
  };
  const getColumn = (field: string): GridColumn | undefined => model.columns.find(column => column.field === field);
  const typeOf = (column: GridColumn): MvpColumnType | undefined => settings.columnTypes && Object.hasOwn(settings.columnTypes, column.key) ? settings.columnTypes[column.key] : undefined;
  const lockedColumn = (column: GridColumn): boolean => settings.columnLocks?.[column.key] === true;
  const editableColumn = (column: GridColumn): boolean => !options.readOnly && !readOnlyKeys.has(column.key) && !lockedColumn(column);
  const selected = (): CellComponent[] => table.getRanges()[0]?.getCells().flat().filter(cell => !!getColumn(cell.getField())) || [];
  const focusTyping = (): void => {
    const cell = selected()[0];
    typingTarget.value = ''; composing = false;
    typingTarget.readOnly = !cell || !editableColumn(getColumn(cell.getField())!) || cell.getValue() !== null && typeof cell.getValue() === 'object';
    typingTarget.focus({ preventScroll: true });
  };
  const visibleColumns = (): ColumnComponent[] => table.getColumns().filter(column => !!getColumn(column.getField()) && column.isVisible());
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
    if (next) { table.getRanges().forEach(range => range.remove()); table.addRange(next, next); rangeAnchor = rangeCursor = next; focusTyping(); }
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
    panel.setAttribute('aria-label', title);
    const heading = element('div', undefined, 'mvp-grid-panel-heading');
    const close = button('닫기', () => { panel.hidden = true; focusTyping(); });
    heading.append(element('strong', title), close);
    const body = element('div', undefined, 'mvp-grid-panel-body');
    panel.append(heading, body); panel.hidden = false;
    queueMicrotask(() => { if (!disposed) panel.querySelector<HTMLElement>('input,select,button')?.focus(); });
    return body;
  };
  const closePanel = (): void => { panel.hidden = true; focusTyping(); };
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
    const content = openPanel('숨김 열 보기 / 복원');
    panel.classList.add('mvp-grid-column-panel');
    if (typeof window !== 'undefined') {
      const box = toolbar.getBoundingClientRect();
      const top = Math.max(12, Math.min(box.bottom + 4, window.innerHeight - 260));
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
      for (const column of columns) { visibility.set(column.field, visible); visible ? table.showColumn(column.field) : table.hideColumn(column.field); }
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
        line.append(check, name); list.append(line);
      }
    };
    search.addEventListener('input', draw);
    const groupHeading = element('div', undefined, 'mvp-grid-group-heading');
    const fold = button('접기', () => { groups.hidden = !groups.hidden; fold.textContent = groups.hidden ? '펼치기' : '접기'; fold.setAttribute('aria-expanded', String(!groups.hidden)); fold.setAttribute('aria-label', groups.hidden ? '열 분류 펼치기' : '열 분류 접기'); });
    fold.setAttribute('aria-label', '열 분류 접기'); fold.setAttribute('aria-expanded', 'true');
    groupHeading.append(element('strong', '열 분류'), fold); content.append(search, groupHeading, groups, list);
    draw();
  }
  function renameColumn(column: GridColumn): void {
    const content = openPanel('표시명 설정');
    const input = labelledInput('열 표시명'); input.value = model.label(column, settings);
    content.append(element('p', '원천 키: ' + (column.key || '(빈 키)')), input, button('적용', () => {
      const label = input.value.trim(); if (!label) { report('표시명을 입력하세요.'); return; }
      settings.dictionary.keys = { ...settings.dictionary.keys, [column.key]: label };
      table.updateColumnDefinition(column.field, definition(column));
      options.onColumnRename?.(column.key, label); closePanel();
    }));
  }
  function setType(column: GridColumn, type: MvpColumnType): void {
    settings.columnTypes = { ...settings.columnTypes, [column.key]: type };
    void table.updateColumnDefinition(column.field, definition(column));
    table.getRows().forEach(row => row.reformat()); options.onColumnType?.(column.key, type);
  }
  function setColumnLock(column: GridColumn, locked: boolean): void {
    if (options.readOnly || readOnlyKeys.has(column.key)) return;
    settings.columnLocks = { ...settings.columnLocks, [column.key]: locked };
    void table.updateColumnDefinition(column.field, definition(column));
    options.onColumnLock?.(column.key, locked);
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
      else void table.deleteRow(data._mvpRow).then(() => { if (!disposed) { emit(); void extendSlots(); } }).catch(report);
    } }];
  }
  function definition(column: GridColumn, sourceRows?: JsonRow[]): ColumnDefinition {
    const menu = [
      { label: '열 필터', action: () => filterEditor(column) },
      { label: '열 숨기기', action: () => { visibility.set(column.field, false); table.hideColumn(column.field); } },
      { label: '숨김 열 보기 / 복원', action: columnChooser },
      { label: '표시명 설정', action: () => renameColumn(column) },
      { label: readOnlyKeys.has(column.key) ? '열 잠금 (읽기 전용)' : lockedColumn(column) ? '열 잠금 해제' : '열 잠금', disabled: !!options.readOnly || readOnlyKeys.has(column.key), action: () => setColumnLock(column, !lockedColumn(column)) },
      { label: '열 타입', menu: (['text', 'money', 'date'] as const).map(type => ({ label: ({ text: '텍스트', money: '금액', date: '날짜' })[type], action: () => setType(column, type) })) },
      ...(!options.readOnly ? [{ label: '사용자 열 추가', action: addColumnDialog }, ...(column.user && editableColumn(column) ? [{ label: '사용자 열 삭제', action: () => handle.removeColumn(column.key) }] : [])] : []),
    ];
    return {
      field: column.field, title: model.label(column, settings), headerTooltip: column.key || '(빈 키)',
      width: 150, minWidth: 85, headerSort: true, visible: visibility.get(column.field) ?? (column.user ? userColumnsVisible : model.visible(column, sourceRows ?? rows(), settings)),
      hozAlign: typeOf(column) === 'money' ? 'right' : 'left',
      headerContextMenu: menu, editor: options.readOnly ? undefined : editCell,
      // Tabulator 6.5 loadMenuEvent accepts functions; @types 6.3 declares only arrays.
      contextMenu: (options.onValueDictionary || options.allowRowDelete ? (_event: UIEvent, cell: CellComponent) => [
        ...(options.onValueDictionary ? [{ label: '값 사전 추가', action: () => options.onValueDictionary?.(column.key, cell.getValue()) }] : []),
        ...(options.allowRowDelete ? rowDeleteMenu(cell.getRow()) : []),
      ] : undefined) as unknown as ColumnDefinition['contextMenu'],
      editable: cell => editableColumn(column) && (cell.getValue() === null || typeof cell.getValue() !== 'object'),
      formatterClipboard: false,
      accessorClipboard: value => rawText(value),
      sorter: (a: unknown, b: unknown, rowA: RowComponent, rowB: RowComponent, _column: ColumnComponent, dir: string) => {
        const blankA = model.blankSlot(rowA.getData() as GridBufferRow), blankB = model.blankSlot(rowB.getData() as GridBufferRow);
        if (blankA !== blankB) return (blankA ? 1 : -1) * (dir === 'desc' ? -1 : 1);
        return typeof a === 'number' && typeof b === 'number' ? a - b : rawText(a).localeCompare(rawText(b), undefined, { numeric: true });
      },
      titleFormatter: () => {
        const title = element('span', undefined, 'mvp-grid-column-title');
        // Tabulator intentionally blocks its header move while whole-column range selection is active.
        // A native drag grip keeps column selection and column moves available through public APIs.
        const drag = element('span', '⠿', 'mvp-grid-drag'); drag.draggable = true; drag.tabIndex = 0;
        drag.title = '드래그하여 열 이동'; drag.setAttribute('aria-label', model.label(column, settings) + ' 열 이동');
        drag.addEventListener('mousedown', event => event.stopPropagation());
        drag.addEventListener('dragstart', event => { event.stopPropagation(); event.dataTransfer?.setData('application/x-g2b-grid-column', column.field); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; });
        title.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('application/x-g2b-grid-column')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
        title.addEventListener('drop', event => {
          const from = event.dataTransfer?.getData('application/x-g2b-grid-column');
          if (!from || from === column.field || !getColumn(from)) return;
          event.preventDefault(); event.stopPropagation();
          const box = title.getBoundingClientRect(); table.moveColumn(from, column.field, event.clientX > box.x + box.width / 2);
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
        span.textContent = dictionary && Object.prototype.hasOwnProperty.call(dictionary, String(value)) ? dictionary[String(value)] : value !== null && typeof value === 'object' ? nestedPreview(value, options.itemColumnKeys?.includes(column.key) ? 'items' : column.key) : formatValue(value, typeOf(column));
        span.title = rawText(value);
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
  const combine = element('select'); combine.setAttribute('aria-label', '여러 열 필터 결합');
  for (const [value, label] of [['and', '모두 충족 (AND)'], ['or', '하나 이상 충족 (OR)']]) { const option = element('option', label); option.value = value; combine.append(option); }
  combine.addEventListener('change', () => { view.combine = combine.value as 'and' | 'or'; whenReady(applyFilter); });
  const resetFilters = button('열 필터 해제', () => { view.filters.clear(); whenReady(applyFilter); });
  resetFilters.title = '머리글에서 설정한 열 필터만 해제합니다. 전체 검색어는 유지합니다.';
  toolbar.append(button('숨김 열', () => whenReady(columnChooser)), combine, resetFilters);
  if (!options.readOnly) toolbar.append(button('+ 사용자 열', () => whenReady(addColumnDialog)));
  toolbar.append(count);
  table = new Tabulator(host, {
    data: [...initial, ...model.slots(Math.max(16, Math.ceil(host.clientHeight / 24) + 3))],
    index: '_mvpRow', height: '100%', rowHeight: 24, layout: 'fitData', nestedFieldSeparator: false, popupContainer: root,
    movableColumns: true, selectableRange: 1, selectableRangeColumns: true, selectableRangeRows: true,
    selectableRangeClearCells: false, headerSortClickElement: 'icon', editTriggerEvent: 'dblclick',
    clipboard: true, clipboardCopyRowRange: 'range', clipboardCopyStyled: false,
    clipboardCopyConfig: { rowHeaders: false, columnHeaders: false },
    clipboardPasteParser: (text: string) => { try { return parseClipboard(text); } catch (error) { report(error); return false; } }, clipboardPasteAction: pasteRows,
    rowHeader: { formatter: 'rownum', width: 40, headerSort: false, resizable: false, frozen: true },
    rowContextMenu: options.allowRowDelete ? (_event: UIEvent, row: RowComponent) => rowDeleteMenu(row) : undefined,
    columns: model.columns.map(column => definition(column, options.rows)), placeholder: '자료가 없습니다. 사용자 열을 추가하여 입력할 수 있습니다.',
  } as any);
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { void extendSlots(); });
  table.on('tableBuilt', () => { if (disposed) return; ready = true; resize?.observe(host); pending.splice(0).forEach(run => run()); updateCount(); });
  table.on('cellEdited', () => { emit(); void extendSlots(); });
  table.on('dataFiltered', updateCount);
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
    if (!ready || options.readOnly || !(target instanceof Element) || target !== typingTarget && target.closest('input,textarea,select,button,.mvp-grid-nested')) return;
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
        if (next) { table.getRanges().forEach(current => current.remove()); table.addRange(anchor, next); rangeAnchor = anchor; rangeCursor = next; focusTyping(); }
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
    setSearch: search => { view.search = search; whenReady(applyFilter); },
    setRowFilter: predicate => { rowFilter = predicate; whenReady(applyFilter); },
    setSettings: next => {
      const hideChanged = next.hideEmptyColumns !== settings.hideEmptyColumns || next.hideUnmappedColumns !== settings.hideUnmappedColumns;
      settings = structuredClone(next); root.dataset.theme = settings.theme;
      whenReady(() => {
        if (hideChanged) visibility.clear();
        const data = rows();
        for (const column of model.columns) {
          table.updateColumnDefinition(column.field, definition(column, data));
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
      whenReady(() => { void table.addColumn(definition(column)).then(() => {
        batch(() => table.getRows().forEach(row => row.getCell(column.field).setValue('')));
        options.onUserColumnsChanged?.(model.columns.filter(candidate => candidate.user).map(candidate => candidate.key));
      }); });
    },
    removeColumn: key => {
      if (options.readOnly || disposed) return;
      if (readOnlyKeys.has(key)) { report('읽기 전용 열은 삭제할 수 없습니다. 열 숨기기를 사용하세요.'); return; }
      const column = model.removeColumn(key); if (!column) return;
      view.filters.delete(key); visibility.delete(column.field);
      whenReady(() => { table.deleteColumn(column.field); emit(); applyFilter(); options.onUserColumnsChanged?.(model.columns.filter(candidate => candidate.user).map(candidate => candidate.key)); });
    },
    exportExcel: filename => whenReady(() => {
      const columns = visibleColumns().map(column => { const source = getColumn(column.getField())!; return { key: source.key, label: model.label(source, settings) }; });
      const book = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(exportMatrix(model.rows(buffer('active')), columns));
      XLSX.utils.book_append_sheet(book, sheet, '자료');
      XLSX.writeFile(book, /\.xlsx$/i.test(filename) ? filename : filename + '.xlsx');
    }),
    destroy: () => {
      if (disposed) return; disposed = true; ready = false; pending.length = 0; resize?.disconnect();
      host.removeEventListener('click', focusSelection); root.removeEventListener('keydown', keydown, true); table.destroy(); root.remove();
    },
  };
  return handle;
}

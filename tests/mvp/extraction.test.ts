/** Public synthetic fixtures only. Local business source files are never copied here. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectPage, mergeFrameCaptures } from '../../plugins/collector/extractor';
import { defaultScreenRules, extractCapture, extractionViews, loadJson } from '../../apps/mvp/extractor';

const receipt = { areaCd: '14', depth1: '01001', depth2: '01114', ctrtDmndRcptNo: 'synthetic-R', ctrtDmndRcptOrd: '00' };
const bid = { areaCd: '14', depth1: '01173', depth2: '01174', depth3: '01179', bidPbancNo: 'synthetic-B', bidPbancOrd: '000' };
const contract = { areaCd: '14', depth1: '01570', depth2: '01571', depth3: '01579', ctrtNo: 'synthetic-C', ctrtChgOrd: '00' };
const url = 'https://www.g2b.go.kr/synthetic';
function mockWebSquare(components: Record<string, any>, frames: Window[] = []): Window {
  return { location: { href: url }, document: { querySelectorAll: () => Object.keys(components).map(id => ({ id })) }, frames, WebSquare: { util: { getComponentById: (id: string) => components[id] } } } as unknown as Window;
}
const capture = (pointInfo: Record<string, unknown> = receipt, tables: Record<string, Record<string, unknown>[]> = {}) => ({ url, pointInfo, tables });

describe('MVP WebSquare extraction and source preservation', () => {
  it('uses gridView -> DataList.getAllJSON and retains every row, column and raw value', () => {
    const rows = [{ '': '', code: '00001', value: 0, active: false, price: '35608652.50', missing: null }, { code: '00002', extraColumn: 'retained' }];
    const components = {
      zero: { getRef: () => 'dm.zero', getValue: () => 0 }, flag: { getRef: () => 'dm.flag', getValue: () => false }, blank: { getRef: () => 'dm.', getValue: () => '' },
      grid: { id: 'items', getPluginName: () => 'gridView', getDataList: () => 'data' }, data: { getAllJSON: () => rows },
      emptyGrid: { id: 'empty', getPluginName: () => 'gridView', getDataList: () => ({ getAllJSON: () => [] }) }
    };
    const raw = collectPage(false, mockWebSquare(components));
    const result = extractCapture(raw);
    expect(result.views.map(view => view.rows)).toEqual([rows, []]);
    expect(result.raw).toBe(raw);
    expect(raw.pointInfo).toEqual({ zero: 0, flag: false, blank: '' });
    expect(extractionViews(result).map(view => view.key)).toEqual(['items', 'empty']);
    expect(extractionViews(result, 'all').at(-1)?.rows[0]).toEqual(raw.pointInfo);
    result.views[0].rows[0].code = 'edited';
    expect(raw.tables.items[0].code).toBe('00001');
  });

  it('retains empty source keys and prototype-named columns without mutating the source', () => {
    const raw = JSON.parse('{"pointInfo":{"":""},"tables":{"":{"__proto__":"invalid rows"},"__proto__":[{"":"","constructor":false,"__proto__":0}]}}');
    const original = JSON.stringify(raw);
    const result = extractCapture(raw);
    expect(result.views[0].key).toBe('__proto__');
    expect(result.views[0].rows[0]).toEqual(JSON.parse('{"":"","constructor":false,"__proto__":0}'));
    expect(result.warnings.some(warning => warning.includes('표는 JSON'))).toBe(true);
    expect(JSON.stringify(raw)).toBe(original);
  });

  it('imports direct bookmarklet JSON, including BOM and the empty pointInfo key', () => {
    const raw = { pointInfo: { ...receipt, '': '' }, tables: { items: [{ ctrtDmndRcptItemSqno: '001', zero: 0, flag: false }] } };
    const result = loadJson('\uFEFF' + JSON.stringify(raw));
    expect(result.observations).toEqual([]);
    expect(result.warnings.join(' ')).toContain('URL');
    expect(result.views[0].stage).toBe('receipt');
    expect(extractionViews(result, 'all').at(-1)?.rows[0]['']).toBe('');
    expect(loadJson(JSON.stringify(raw), url).observations[0].identity).toEqual(['synthetic-R', '00']);
    expect(() => loadJson('{')).toThrow();
    expect(() => extractCapture([])).toThrow();
    expect(() => extractCapture({ pointInfo: {}, tables: {}, frames: {} })).toThrow();
  });

  it('does not display aggregate duplicates when PageCapture frames are present', () => {
    const raw = mergeFrameCaptures([
      { frameId: 1, result: collectPage(false, mockWebSquare({ grid: { id: 'items', getPluginName: () => 'gridView', getDataList: () => ({ getAllJSON: () => [{ value: false }] }) } })) },
      { frameId: 0, result: collectPage(false, mockWebSquare({ grid: { id: 'items', getPluginName: () => 'gridView', getDataList: () => ({ getAllJSON: () => [{ value: 0 }] }) } })) }
    ]);
    expect(extractCapture(raw).views.map(view => view.rows)).toEqual([[{ value: 0 }], [{ value: false }]]);
    expect(new Set(extractCapture(raw).views.map(view => view.key)).size).toBe(2);
  });

  it('keeps collectPage callable as a serialized MAIN-world function', () => {
    const standalone = new Function('return (' + collectPage.toString() + ')')() as typeof collectPage;
    const raw = standalone(false, mockWebSquare({ grid: { getPluginName: () => 'gridView', getDataList: () => ({ getAllJSON: () => JSON.stringify([{ value: false }]) }) } }));
    expect(extractCapture(raw).views[0].rows).toEqual([{ value: false }]);
  });
});

describe('MVP designated screen collection gate', () => {
  it('uses explicit screen rules with exact stage/path and prefix or simple wildcard URL matching', () => {
    const rule = { id: 'custom', stage: 'receipt' as const, urlPattern: 'https://www.g2b.go.kr/syn', areaCd: '22', depth1: 'custom1', depth2: 'custom2', depth3: 'tab' };
    const raw = capture({ ...receipt, areaCd: '22', depth1: 'custom1', depth2: 'custom2', depth3: 'tab' });
    const result = extractCapture(raw, undefined, [rule]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].source.areaCd).toBe('22');
    expect(result.observations[0].source.depth1).toBe('custom1');
    for (const override of [{ stage: 'bid' as const }, { areaCd: 'other' }, { depth1: 'other' }, { depth2: 'other' }, { depth3: 'other' }, { urlPattern: 'https://www.g2b.go.kr/different' }]) expect(extractCapture(raw, undefined, [{ ...rule, ...override }]).observations).toEqual([]);
    expect(extractCapture(raw, undefined, [{ ...rule, urlPattern: 'https://*.g2b.go.kr/syn*', depth3: '' }]).observations).toHaveLength(1);
    expect(extractCapture(capture({ ...raw.pointInfo, depth3: 'another' }), undefined, [{ ...rule, depth3: '' }]).observations).toHaveLength(1);
    expect(extractCapture(raw, undefined, [{ ...rule, urlPattern: 'https://www.g2b.go.kr/synthetic$' }]).observations).toEqual([]);
  });

  it('preserves default fallback and raw tables, explicitly empty rules deny all collection', () => {
    const raw = capture(receipt, { empty: [], rows: [{ zero: 0, flag: false }] });
    expect(extractCapture(raw, undefined, undefined).observations).toHaveLength(1);
    const denied = extractCapture(raw, undefined, []);
    expect(denied.observations).toEqual([]);
    expect(denied.raw).toBe(raw);
    expect(denied.views.map(view => view.rows)).toEqual([[], [{ zero: 0, flag: false }]]);
    for (const point of [receipt, { ...receipt, depth2: '01117' }, bid, contract]) expect(extractCapture(capture(point), undefined, defaultScreenRules).observations).toHaveLength(1);
    for (const point of [{ ...bid, depth3: '01175' }, { ...contract, depth3: '01572' }]) for (const rules of [defaultScreenRules, undefined]) expect(extractCapture(capture(point), undefined, rules).observations).toEqual([]);
    expect(new Set(defaultScreenRules.map(rule => rule.id)).size).toBe(defaultScreenRules.length);
  });

  it('never lets editable screen rules bypass the G2B origin gate or ambiguous stage', () => {
    const rule = { id: 'all', stage: 'receipt' as const, urlPattern: '*', areaCd: '14', depth1: '01001', depth2: '01114' };
    for (const denied of ['https://g2b.go.kr.evil.test/', 'https://foreign.test/', 'file:///g2b.go.kr']) expect(extractCapture({ ...capture(), url: denied }, undefined, [rule]).observations).toEqual([]);
    expect(extractCapture(capture({ ...receipt, bidPbancNo: 'synthetic-B', bidPbancOrd: '00' }), undefined, [rule, { ...rule, id: 'bid', stage: 'bid' }]).observations).toEqual([]);
  });
  for (const [stage, point] of [['receipt', receipt], ['bid', bid], ['contract', contract]] as const) it('recognizes ' + stage + ' using source keys and complete designated screen', () => {
    const raw = capture({ ...point, value: 0, flag: false, '': '', decimal: '1.2300' });
    const original = JSON.stringify(raw), result = extractCapture(raw);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].stage).toBe(stage);
    expect(result.observations[0].fields).toEqual(raw.pointInfo);
    expect(JSON.stringify(raw)).toBe(original);
    expect(JSON.parse(result.observations[0].rawJson)).toEqual(raw);
    expect(result.observations[0].source.url).toBe(url);
  });

  it('validates URL host and scheme, including deceptive hosts', () => {
    for (const denied of ['', 'https://g2b.go.kr.evil.test', 'https://fakeg2b.go.kr', 'https://g2b.go.kr@evil.test', 'file:///g2b.go.kr', 'not-a-url']) expect(extractCapture({ ...capture(), url: denied }, url).observations, denied).toEqual([]);
    for (const allowed of ['https://g2b.go.kr', 'http://legacy.g2b.go.kr']) expect(extractCapture({ ...capture(), url: allowed }).observations).toHaveLength(1);
  });

  it('never combines pointInfo, identity or URL from different frames or aggregates', () => {
    const raw = { ...capture(), frames: [
      { framePath: 'screen', ...capture({ areaCd: '14', depth1: '01001', depth2: '01114' }) },
      { framePath: 'identity', ...capture({ ctrtDmndRcptNo: 'synthetic-R', ctrtDmndRcptOrd: '00' }) }
    ] };
    expect(extractCapture(raw).observations).toEqual([]);
    expect(extractCapture({ ...capture(), frames: [{ framePath: 'without-url', pointInfo: receipt, tables: {} }] }, url).observations).toEqual([]);
    expect(extractCapture({ ...capture(), frames: [{ framePath: 'foreign', ...capture(), url: 'https://fixture.test' }] }, url).observations).toEqual([]);
  });

  it('blocks unknown screen paths and depth3, without inferring from number length or uuid', () => {
    for (const override of [{ areaCd: '13' }, { depth1: 'wrong' }, { depth2: '01108' }, { ctrtDmndRcptOrd: '' }]) expect(extractCapture(capture({ ...receipt, ...override }, { wq_uuid_123: [{ value: 'irrelevant' }] })).observations).toEqual([]);
    expect(extractCapture(capture({ ...bid, depth3: 'unknown' })).observations).toEqual([]);
    expect(extractCapture(capture({ ...receipt, depth3: 'source-receipt-tab' })).observations[0].source.depth3).toBe('source-receipt-tab');
    expect(extractCapture(capture({ ...contract, ctrtNo: 'X', ctrtChgOrd: '00000000000' })).observations[0].identity).toEqual(['X', '00000000000']);
    expect(extractCapture(capture({ ...receipt, ctrtDmndRcptOrd: 0 })).observations[0].identity[1]).toBe('0');
  });

  it('blocks conflicting and incomplete detail identity but keeps extraction tables', () => {
    const conflict = extractCapture(capture(receipt, { items: [{ ctrtDmndRcptNo: 'other-R', ctrtDmndRcptOrd: '00' }] }));
    expect(conflict.observations).toEqual([]);
    expect(conflict.views[0].rows).toHaveLength(1);
    expect(extractCapture(capture({ ...receipt, ctrtDmndRcptNo: null, ctrtDmndRcptOrd: null })).observations).toEqual([]);
    expect(extractCapture(capture({ ...receipt, 'depth2#2': '01117' })).observations).toEqual([]);
    expect(extractCapture(capture({ ...receipt, 'depth2#2': '01114' })).observations).toHaveLength(1);
  });

  it('uses frame read failure evidence to block collection while retaining readable extraction', () => {
    const raw = { ...capture(receipt, { rows: [{ value: 0 }] }), warnings: ['one component failed'] };
    expect(extractCapture(raw).observations).toEqual([]);
    expect(extractCapture(raw).views[0].rows).toEqual([{ value: 0 }]);
  });

  it('blocks multiple conflicting business frames and accepts identical captures once', () => {
    const first = { framePath: 'first', ...capture() }, same = { ...first, framePath: 'same' };
    expect(extractCapture({ pointInfo: {}, tables: {}, frames: [first, same] }).observations).toHaveLength(1);
    const other = { framePath: 'other', ...capture({ ...receipt, ctrtDmndRcptNo: 'other-R' }) };
    expect(extractCapture({ pointInfo: {}, tables: {}, frames: [first, other] }).observations).toEqual([]);
  });
});

describe('MVP parent content, items and qualifications', () => {
  it('retains bid content and unclassified/empty tables with items and qualifications', () => {
    const raw = capture(bid, {
      content: [{ bidPbancNo: 'synthetic-B', bidPbancOrd: '000', title: 'Synthetic announcement', extra: false }],
      goods: [{ bidPbancItemSqno: '0001', zero: 0, decimal: '1.00' }],
      limits: [{ lmtSqno: '01', bidLmtSeCd: 'A', allowed: false }],
      unknown: [{ originalField: 'retained' }], empty: []
    });
    const result = extractCapture(raw), observation = result.observations[0];
    expect(observation.fields.title).toBe('Synthetic announcement');
    expect(observation.children.map(child => child.kind)).toEqual(['other', 'items', 'qualification', 'other', 'other']);
    expect(observation.children.at(-1)?.rows).toEqual([]);
    expect(result.views).toHaveLength(5);
    expect(observation.children[1].rows).toEqual(raw.tables.goods);
  });

  it('deduplicates only an exactly equal Excel dataset in normalized children', () => {
    const rows = [{ ctrtItemSqno: '001', value: 0 }, { ctrtItemSqno: '001', value: 0 }];
    const raw = capture(contract, { grdCtrtLis: rows, grdCtrtLisExcel: rows, empty: [], emptyExcel: [] });
    const result = extractCapture(raw);
    expect(result.views).toHaveLength(4);
    expect(result.observations[0].children).toHaveLength(3);
    expect(result.observations[0].children[0].rows).toHaveLength(2);
    expect(result.raw).toBe(raw);
    const differing = extractCapture(capture(contract, { grdCtrtLis: rows, grdCtrtLisExcel: [{ ctrtItemSqno: '002', value: false }] }));
    expect(differing.observations[0].children).toHaveLength(2);
    expect(extractCapture(capture(contract, { items: [{ ctrtItemSqno: '001', amount: '1' }, { ctrtItemSqno: '001', amount: '2' }] })).observations).toEqual([]);
  });

  it('allows receipt item-only detail to prove one parent without adding identity to child rows', () => {
    const point = { areaCd: '14', depth1: '01001', depth2: '01117', title: 'Synthetic detail' };
    const rows = [{ ctrtDmndRcptNo: 'synthetic-R', ctrtDmndRcptOrd: '00', ctrtDmndRcptItemSqno: '1' }, { ctrtDmndRcptNo: 'synthetic-R', ctrtDmndRcptOrd: '00', ctrtDmndRcptItemSqno: '2' }];
    const result = extractCapture(capture(point, { gridView: rows, unknown: [{ value: false }] }));
    expect(result.observations[0].identity).toEqual(['synthetic-R', '00']);
    expect(result.observations[0].children[1].rows).toEqual([{ value: false }]);
    expect(Object.hasOwn((result.raw as ReturnType<typeof capture>).pointInfo, 'ctrtDmndRcptNo')).toBe(false);
  });

  for (const [point, stage, noKey, ordKey, listDepth] of [[bid, 'bid', 'bidPbancNo', 'bidPbancOrd', '01175'], [contract, 'contract', 'ctrtNo', 'ctrtChgOrd', '01572']] as const) it('produces N observations for ' + noKey + ' list rows once the list screen is added as a rule', () => {
    const { [noKey]: _number, [ordKey]: _order, ...screen } = point as Record<string, unknown>;
    const rows = [{ [noKey]: 'synthetic-01', [ordKey]: '00', count: 0 }, { [noKey]: 'synthetic-02', [ordKey]: '01', flag: false }];
    // Excluded by default (#17); a screen rule added in settings re-enables the list screen.
    const rules = [...defaultScreenRules, { id: 'list', stage, urlPattern: '*', areaCd: '14', depth1: String(screen.depth1), depth2: String(screen.depth2), depth3: listDepth }];
    expect(extractCapture(capture({ ...screen, depth3: listDepth }, { listing: rows, empty: [] })).observations).toEqual([]);
    const result = extractCapture(capture({ ...screen, depth3: listDepth }, { listing: rows, empty: [] }), undefined, rules);
    expect(result.observations.map(entry => entry.identity)).toEqual([['synthetic-01', '00'], ['synthetic-02', '01']]);
    expect(result.observations.map(entry => entry.fields)).toEqual(rows);
    expect(result.observations.every(entry => !Object.hasOwn(entry.fields, 'areaCd'))).toBe(true);
    expect(extractCapture(capture({ ...screen, depth3: listDepth }, { listing: [...rows, { [noKey]: 'incomplete' }] }), undefined, rules).observations).toEqual([]);
  });
});

const localReferenceDirectory = join(process.cwd(), '참고자료');
it.skipIf(!existsSync(localReferenceDirectory))('validates all 31 readonly local sample structures without copying their contents', () => {
  const filenames = readdirSync(localReferenceDirectory).filter(name => /^data_map_\d+\.txt$/.test(name));
  expect(filenames.length).toBe(31);
  for (const filename of filenames) {
    const text = readFileSync(join(localReferenceDirectory, filename), 'utf8').replace(/^\uFEFF/, '');
    const raw = JSON.parse(text) as { pointInfo: Record<string, unknown>; tables: Record<string, Record<string, unknown>[]> };
    const before = JSON.stringify(raw), result = extractCapture(raw);
    // Boolean assertions avoid printing private source values in failing test output.
    expect(JSON.stringify(result.raw) === before).toBe(true);
    expect(result.views.length === Object.keys(raw.tables).length).toBe(true);
    expect(result.views.every(view => JSON.stringify(view.rows) === JSON.stringify(raw.tables[view.key]))).toBe(true);
    expect(result.observations.length).toBe(0); // No real source URL exists in bookmarklet files.
    const all = extractionViews(result, 'all');
    expect(JSON.stringify(all.at(-1)?.rows[0]) === JSON.stringify(raw.pointInfo)).toBe(true);
  }
});

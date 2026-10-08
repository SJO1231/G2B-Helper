/** Synthetic values only. #24: where a selected G2B screen row gets its output values. */
import { describe, expect, it } from 'vitest';
import { collectionScreen, defaultScreenRules, extractCapture } from '../../apps/mvp/extractor';
import { extractionSources, recordSources } from '../../apps/mvp/document-sources';
import type { ExtractionView } from '../../apps/mvp/contracts';

const url = 'https://www.g2b.go.kr/synthetic';
const listPoint = { areaCd: '14', depth1: '01570', depth2: '01571' };
const detailPoint = { areaCd: '14', depth1: '01570', depth2: '01571', depth3: '01579', ctrtNo: 'C-1', ctrtChgOrd: '00', ctrtAmt: '100' };
const list = extractCapture({ url, pointInfo: listPoint, tables: { contracts: [
  { ctrtNo: 'L-1', ctrtChgOrd: '00', title: 'first', amount: '10' },
  { ctrtNo: 'L-2', ctrtChgOrd: '00', title: 'second', amount: '20' }
] } });
const detail = extractCapture({ url, pointInfo: detailPoint, tables: { grdCtrtLis: [{ ctrtItemSqno: 1, ctrtAmt: '40', name: 'item' }] } });
const view = (result: typeof list, key: string): ExtractionView => result.views.find(entry => entry.key === key)!;

describe('G2B screen output sources (#24)', () => {
  it('maps list rows to their own records and counts only changed record values as edits', () => {
    const rows = view(list, 'contracts').rows, edited = { ...rows[1], title: 'changed' };
    const sources = extractionSources([{ sourceIndex: 0, row: rows[0] }, { sourceIndex: 1, row: edited }], view(list, 'contracts'), list.observations, rows, true);
    expect(sources.map(source => source.kind)).toEqual(['record', 'record']);
    expect(sources[0]).not.toHaveProperty('edits');
    expect(sources[1]).toMatchObject({ observation: { identity: ['L-2', '00'] }, edits: { title: 'changed' } });
  });

  it('maps every detail table row to the one record and ignores edits of values that are not the record\'s own', () => {
    const rows = view(detail, 'grdCtrtLis').rows;
    const [unchanged, child] = extractionSources([{ sourceIndex: 0, row: rows[0] }, { sourceIndex: 0, row: { ...rows[0], ctrtAmt: '41', name: 'renamed' } }], view(detail, 'grdCtrtLis'), detail.observations, rows, true);
    expect(unchanged).toMatchObject({ kind: 'record', observation: { identity: ['C-1', '00'] } });
    // The child row's amount was never the contract amount, so changing it is not a record edit.
    expect(child).toEqual({ kind: 'record', observation: detail.observations[0] });
  });

  it('blocks a collection target whose business key was not read, and outputs other screens only', () => {
    const unread = extractCapture({ url, pointInfo: listPoint, tables: { contracts: [{ title: 'no key' }] } });
    expect(unread.observations).toEqual([]);
    const target = view(unread, 'contracts');
    expect(extractionSources([{ sourceIndex: 0, row: target.rows[0] }], target, [], target.rows, collectionScreen(target.source))[0].kind).toBe('blocked');
    const other = extractCapture({ url, pointInfo: { areaCd: '14', depth1: '09999', depth2: '09999' }, tables: { rows: [{ name: 'a' }] } });
    const plain = view(other, 'rows');
    expect(collectionScreen(plain.source)).toBe(false);
    expect(extractionSources([{ sourceIndex: 0, row: plain.rows[0] }], plain, [], plain.rows, false)).toEqual([{ kind: 'output', row: { name: 'a' } }]);
    expect(extractionSources([{ sourceIndex: 0, row: { name: 'b' } }], plain, [], plain.rows, false)).toEqual([{ kind: 'output', row: { name: 'b' }, screen: { name: 'a' } }]);
    // An added row has no screen value to choose.
    expect(extractionSources([{ sourceIndex: 5, row: { name: 'new' } }], plain, [], plain.rows, false)).toEqual([{ kind: 'output', row: { name: 'new' } }]);
  });

  it('blocks rows added in the table, edited business keys and keys not among the screen records', () => {
    const rows = view(list, 'contracts').rows, sources = (row: Record<string, unknown>, pristine: (Record<string, unknown> | undefined)[]) => extractionSources([{ sourceIndex: 0, row }], view(list, 'contracts'), list.observations, pristine, true)[0];
    expect(sources(rows[0], [undefined])).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('추가한 행') });
    expect(sources({ ...rows[0], ctrtNo: 'L-2' }, rows)).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('고칠 수 없습니다') });
    const unknown = { ctrtNo: 'L-9', ctrtChgOrd: '00', title: 'unknown' };
    expect(sources(unknown, [unknown]).kind).toBe('blocked');
  });

  it('compares each row with the screen row it came from, not with its position', () => {
    // After rows were deleted or added and the table drawn again, the caller maps grid indices back to screen rows.
    const rows = view(list, 'contracts').rows, pristine = [rows[1], undefined];
    const [kept, added] = extractionSources([{ sourceIndex: 0, row: { ...rows[1], title: 'changed' } }, { sourceIndex: 1, row: { name: 'new' } }], view(list, 'contracts'), list.observations, pristine, true);
    expect(kept).toMatchObject({ kind: 'record', observation: { identity: ['L-2', '00'] }, edits: { title: 'changed' } });
    expect(added.kind).toBe('blocked');
  });

  it('joins rows of one record and refuses different edits of the same value', () => {
    const observation = detail.observations[0];
    expect(recordSources([{ kind: 'record', observation, edits: { ctrtAmt: '1' } }, { kind: 'record', observation }, { kind: 'output', row: {} }]))
      .toEqual([{ observation, edits: { ctrtAmt: '1' } }]);
    expect(() => recordSources([{ kind: 'record', observation, edits: { ctrtAmt: '1' } }, { kind: 'record', observation, edits: { ctrtAmt: '2' } }])).toThrow('ctrtAmt');
  });

  it('recognizes collection screens with the default gate and with saved screen rules', () => {
    const source = (depth2: string, depth3?: string, link = url) => ({ url: link, framePath: 'top', areaCd: '14', depth1: depth2 === '01114' ? '01001' : '01570', depth2, ...(depth3 ? { depth3 } : {}) });
    expect(collectionScreen(source('01114'))).toBe(true);
    expect(collectionScreen(source('01571', '01579'))).toBe(true);
    expect(collectionScreen(source('01571', '01572'))).toBe(false);
    expect(collectionScreen(source('01114', undefined, 'https://example.com/'))).toBe(false);
    const rules = [...defaultScreenRules, { id: 'manage', stage: 'contract' as const, urlPattern: '*', areaCd: '14', depth1: '01570', depth2: '01571', depth3: '01572' }];
    expect(collectionScreen(source('01571', '01572'), rules)).toBe(true);
    expect(collectionScreen(source('01114'), [])).toBe(false);
  });
});

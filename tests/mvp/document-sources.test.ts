/** Synthetic values only. #24, #42: which selected G2B screen rows can become documents. */
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

describe('G2B screen output sources (#24, #42)', () => {
  it('maps list rows to their own records', () => {
    const rows = view(list, 'contracts').rows;
    const sources = extractionSources([{ sourceIndex: 0, row: rows[0] }, { sourceIndex: 1, row: rows[1] }], view(list, 'contracts'), list.observations, 'collection');
    expect(sources).toEqual([{ kind: 'record', observation: list.observations[0] }, { kind: 'record', observation: list.observations[1] }]);
    expect(sources[1]).toMatchObject({ observation: { identity: ['L-2', '00'] } });
  });

  it('maps every detail table row to the one record', () => {
    const rows = view(detail, 'grdCtrtLis').rows;
    expect(extractionSources([{ sourceIndex: 0, row: rows[0] }], view(detail, 'grdCtrtLis'), detail.observations, 'collection')).toEqual([{ kind: 'record', observation: detail.observations[0] }]);
  });

  it('blocks other screens, files and a collection target whose business key was not read (user, 2026-10-09)', () => {
    const unread = extractCapture({ url, pointInfo: listPoint, tables: { contracts: [{ title: 'no key' }] } });
    expect(unread.observations).toEqual([]);
    const target = view(unread, 'contracts');
    expect(collectionScreen(target.source)).toBe(true);
    expect(extractionSources([{ sourceIndex: 0, row: target.rows[0] }], target, [], 'collection')[0]).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('읽지 못해') });
    const other = extractCapture({ url, pointInfo: { areaCd: '14', depth1: '09999', depth2: '09999' }, tables: { rows: [{ name: 'a' }] } });
    const plain = view(other, 'rows');
    expect(collectionScreen(plain.source)).toBe(false);
    expect(extractionSources([{ sourceIndex: 0, row: plain.rows[0] }], plain, [], 'other')[0]).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('수집 대상 화면이 아니어서') });
    // A file opened as JSON is view only, even when it holds a collection target's records.
    const rows = view(list, 'contracts').rows;
    expect(extractionSources([{ sourceIndex: 0, row: rows[0] }], view(list, 'contracts'), list.observations, 'file')[0]).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('보기 전용') });
  });

  it('blocks keys not among the screen records', () => {
    const unknown = { ctrtNo: 'L-9', ctrtChgOrd: '00', title: 'unknown' };
    expect(extractionSources([{ sourceIndex: 0, row: unknown }], view(list, 'contracts'), list.observations, 'collection')[0]).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('찾지 못해') });
  });

  it('joins rows of one record', () => {
    const observation = detail.observations[0];
    expect(recordSources([{ kind: 'record', observation }, { kind: 'record', observation }, { kind: 'blocked', reason: '' }])).toEqual([observation]);
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

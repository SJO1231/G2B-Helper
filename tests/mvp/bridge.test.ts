import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from '@playwright/test';
import { collectPage } from '../../plugins/collector/extractor';
import { createNativeClient, captureTab, workTab, launcherTab, handleMvpMessage, isG2bUrl, NATIVE_HOST, type MvpBrowser } from '../../apps/mvp/background';
import { captureCurrentPage, rpc, runWorkAction, runLauncher } from '../../apps/mvp/bridge';
import type { MvpEnvelope } from '../../apps/mvp/contracts';
import type { WorkActionResult } from '../../plugins/page-actions/index';

const url = 'https://www.g2b.go.kr/synthetic';
const envelope: MvpEnvelope = { protocolVersion: 1, requestId: 'synthetic-request', command: 'mvp.health', payload: {} };
function fakeNative(limits?: Parameters<typeof createNativeClient>[1]) {
  const messages: ((message: unknown) => void)[] = [], disconnected: (() => void)[] = [];
  const port = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: (fn: (message: unknown) => void) => messages.push(fn) }, onDisconnect: { addListener: (fn: () => void) => disconnected.push(fn) } };
  const runtime = { connectNative: vi.fn(() => port as unknown as chrome.runtime.Port), lastError: { message: 'synthetic disconnect' } };
  return { client: createNativeClient(runtime, limits), port, runtime, send: (message: unknown) => messages.forEach(fn => fn(message)), disconnect: () => disconnected.forEach(fn => fn()) };
}
function browser() {
  const api = {
    runtime: { id: 'synthetic-extension', getURL: (file: string) => 'chrome-extension://synthetic-extension/' + file },
    tabs: { get: vi.fn(async (id: number) => ({ id, url })), query: vi.fn(async () => [{ id: 7, url }]), sendMessage: vi.fn() },
    scripting: { executeScript: vi.fn() }, userScripts: { getScripts: vi.fn(async () => []), execute: vi.fn(async () => [{ frameId: 0, result: false }]) }
  };
  return { api: api as unknown as MvpBrowser, mocks: api };
}
const workResult = (status: WorkActionResult['status'] = 'ready'): WorkActionResult => ({ status, candidates: [], selected: {}, changes: [], clicked: false, warnings: [], message: 'synthetic action' });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('MVP bounded Native Messaging transport', () => {
  it('connects to the dedicated host and preserves zero/false/result fields', async () => {
    const native = fakeNative(); const waiting = native.client.request(envelope);
    expect(native.runtime.connectNative).toHaveBeenCalledWith(NATIVE_HOST);
    expect(native.port.postMessage).toHaveBeenCalledWith(envelope);
    native.send({ protocolVersion: 1, requestId: envelope.requestId, result: { value: 0, flag: false } });
    expect((await waiting).result).toEqual({ value: 0, flag: false });
    native.client.dispose();
  });

  it('aggregates out-of-order UTF-8 chunks and identical retries only once', async () => {
    const native = fakeNative(); const waiting = native.client.request(envelope);
    const text = JSON.stringify({ protocolVersion: 1, requestId: envelope.requestId, result: { label: '합성', zero: 0 } });
    const part = (index: number, value: string) => ({ protocolVersion: 1, requestId: envelope.requestId, chunk: { index, total: 2, text: value } });
    native.send(part(1, text.slice(20))); native.send(part(1, text.slice(20))); native.send(part(0, text.slice(0, 20)));
    expect((await waiting).result).toEqual({ label: '합성', zero: 0 });
    native.client.dispose();
  });

  it('rejects invalid totals, changing totals and conflicting duplicate chunks', async () => {
    for (const invalid of [
      [{ index: 0, total: 4097, text: 'x' }],
      [{ index: 0, total: 2, text: 'x' }, { index: 1, total: 3, text: 'y' }],
      [{ index: 0, total: 2, text: 'x' }, { index: 0, total: 2, text: 'different' }]
    ]) {
      const native = fakeNative(); const waiting = native.client.request(envelope);
      for (const chunk of invalid) native.send({ protocolVersion: 1, requestId: envelope.requestId, chunk });
      await expect(waiting).rejects.toThrow('조각'); native.client.dispose();
    }
  });

  it('rejects wrong reassembled identity/version and malformed result envelopes', async () => {
    for (const malformed of [{ protocolVersion: 1, requestId: 'different', result: {} }, { protocolVersion: 2, requestId: envelope.requestId, result: {} }, { protocolVersion: 1, requestId: envelope.requestId, result: {}, error: { code: 'x', message: 'x' } }]) {
      const native = fakeNative(); const waiting = native.client.request(envelope);
      native.send({ protocolVersion: 1, requestId: envelope.requestId, chunk: { index: 0, total: 1, text: JSON.stringify(malformed) } });
      await expect(waiting).rejects.toThrow('형식'); native.client.dispose();
    }
  });

  it('checks request and response byte budgets before accepting payloads', async () => {
    const tooSmall = fakeNative({ requestBytes: 5 });
    await expect(tooSmall.client.request(envelope)).rejects.toThrow('크기');
    expect(tooSmall.runtime.connectNative).not.toHaveBeenCalled();
    const native = fakeNative({ responseBytes: 5 }); const waiting = native.client.request(envelope);
    native.send({ protocolVersion: 1, requestId: envelope.requestId, chunk: { index: 0, total: 1, text: '가나다' } });
    await expect(waiting).rejects.toThrow('크기'); native.client.dispose();
  });

  it('rejects duplicate pending IDs and allows the same ID after timeout', async () => {
    vi.useFakeTimers();
    const native = fakeNative({ timeoutMs: 50 }); const first = native.client.request(envelope);
    const timedOut = expect(first).rejects.toThrow('시간 초과');
    await expect(native.client.request(envelope)).rejects.toThrow('이미 처리');
    await vi.advanceTimersByTimeAsync(50); await timedOut;
    const retried = native.client.request(envelope);
    native.send({ protocolVersion: 1, requestId: envelope.requestId, result: { retried: true } });
    expect((await retried).result).toEqual({ retried: true }); native.client.dispose();
  });

  it('clears all pending requests on disconnect and reports installation guidance', async () => {
    const native = fakeNative(); const first = native.client.request(envelope), second = native.client.request({ ...envelope, requestId: 'second' });
    native.disconnect();
    await expect(first).rejects.toThrow('확장 ID 등록'); await expect(second).rejects.toThrow('확장 ID 등록'); native.client.dispose();
  });
});

describe('MVP current-tab browser command routing', () => {
  it('captures actual MAIN-world frames without traversing or storing data', async () => {
    const { api, mocks } = browser();
    const raw = { pointInfo: { zero: 0 }, tables: { items: [{ flag: false }] }, frames: [{ framePath: 'top', url, pointInfo: { zero: 0 }, tables: { items: [{ flag: false }] }, fieldSources: {}, warnings: [] }], warnings: [] };
    mocks.scripting.executeScript.mockResolvedValueOnce([{ frameId: 3, result: raw }]).mockResolvedValueOnce([{ frameId: 3, result: url }]);
    const result = await captureTab(api, 7);
    expect(mocks.scripting.executeScript.mock.calls[0][0]).toEqual({ target: { tabId: 7, allFrames: true }, world: 'MAIN', func: collectPage, args: [false] });
    expect(result.frames[0].framePath).toBe('frame:3/top');
    expect(result.tables.items).toEqual([{ flag: false }]);
  });

  it('blocks navigation and deceptive/non-G2B source tabs', async () => {
    for (const denied of ['https://g2b.go.kr.evil.test', 'file:///g2b.go.kr', 'https://fixture.test']) expect(isG2bUrl(denied)).toBe(false);
    const { api, mocks } = browser(); mocks.tabs.get.mockResolvedValueOnce({ id: 7, url: 'https://fixture.test' });
    await expect(captureTab(api, 7)).rejects.toThrow('나라장터');
    expect(mocks.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('returns needsSelection without applying to multiple ready frames', async () => {
    const { api, mocks } = browser();
    mocks.scripting.executeScript.mockResolvedValueOnce([{ frameId: 1, result: workResult() }, { frameId: 2, result: workResult() }]);
    expect((await workTab(api, { kind: 'search' }, 7)).status).toBe('needsSelection');
    expect(mocks.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('preserves explicit date-only +/-year requests and never forces a search', async () => {
    for (const searchAfter of [false, undefined, true]) {
      const { api, mocks } = browser(), inspected = workResult();
      inspected.selected.startDate = { id: 'date', role: 'startDate', framePath: 'top', elementId: 'start', componentId: 'start', value: '2026-07-19', via: 'dom', label: 'start', evidence: 'synthetic', disabled: false, ready: true };
      mocks.scripting.executeScript.mockResolvedValueOnce([{ frameId: 8, documentId: 'synthetic-document', result: inspected }]).mockResolvedValueOnce([{ frameId: 8, result: { ...workResult('applied'), clicked: searchAfter === true } }]);
      expect((await workTab(api, { kind: 'yearShift', years: -1, searchAfter }, 7)).clicked).toBe(searchAfter === true);
      const inspect = mocks.scripting.executeScript.mock.calls[0][0] as unknown as { args: { searchAfter?: boolean }[] };
      expect(inspect.args[0].searchAfter).toBe(searchAfter);
      const applied = mocks.scripting.executeScript.mock.calls[1][0] as unknown as { target: unknown; args: unknown[] };
      expect(applied.target).toEqual({ tabId: 7, documentIds: ['synthetic-document'] });
      expect(applied.args[0]).toMatchObject({ kind: 'yearRange', year: 2025, searchAfter: searchAfter === true, mode: 'apply', traverseFrames: false });
    }
  });

  it('runs manual JS only through userScripts MAIN with activation guidance', async () => {
    const { api, mocks } = browser();
    await launcherTab(api, 'window.synthetic = 0;', 7);
    expect(mocks.userScripts.execute).toHaveBeenCalledWith({ target: { tabId: 7 }, world: 'MAIN', js: [{ code: 'window.synthetic = 0;' }] });
    mocks.userScripts.getScripts.mockRejectedValueOnce(new Error('disabled'));
    await expect(launcherTab(api, '0', 7)).rejects.toThrow('사용자 스크립트 허용');
  });

  it('forwards every MVP gateway command the pages send, and no longer the withdrawn correction reset (#42)', async () => {
    const { api } = browser(), sender = { id: api.runtime.id, url: 'chrome-extension://synthetic-extension/main.html' } as chrome.runtime.MessageSender;
    for (const command of ['mvp.records', 'mvp.edit', 'mvp.document.generate']) {
      const native = fakeNative(), request = { ...envelope, requestId: 'forward-' + command, command } as MvpEnvelope;
      const waiting = handleMvpMessage(api, native.client, { kind: 'mvp.rpc', envelope: request }, sender);
      await Promise.resolve();
      expect(native.port.postMessage).toHaveBeenCalledWith(request);
      native.send({ protocolVersion: 1, requestId: request.requestId, result: { ok: true } });
      expect(await waiting).toMatchObject({ result: { ok: true } });
      native.client.dispose();
    }
    for (const command of ['mvp.unknown', 'mvp.corrections.reset']) await expect(handleMvpMessage(api, fakeNative().client, { kind: 'mvp.rpc', envelope: { ...envelope, command } as unknown as MvpEnvelope }, sender)).rejects.toThrow('요청 형식');
  });

  it('uses widget sender tab instead of a caller-supplied arbitrary tab ID', async () => {
    const { api, mocks } = browser(), native = fakeNative();
    const result = await handleMvpMessage(api, native.client, { kind: 'mvp.context', tabId: 999 }, { id: api.runtime.id, url, tab: { id: 7 } } as chrome.runtime.MessageSender);
    expect(result).toEqual({ result: { tabId: 7 } });
    expect(mocks.tabs.get).toHaveBeenCalledWith(7);
    await expect(handleMvpMessage(api, native.client, { kind: 'mvp.context' }, { id: 'other', url, tab: { id: 7 } } as chrome.runtime.MessageSender)).rejects.toThrow('확장 화면');
    native.client.dispose();
  });
});

describe('MVP frontend bridge', () => {
  it('retries Native transport failure with the exact same request ID and payload', async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ protocolVersion: 1, requestId: 'retry-id', error: { code: 'NATIVE_TRANSPORT', message: 'timeout' } }).mockResolvedValueOnce({ protocolVersion: 1, requestId: 'retry-id', result: { count: 0 } });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    expect(await rpc('mvp.records', { stage: 'bid' }, 'retry-id')).toEqual({ count: 0 });
    expect(sendMessage.mock.calls[0][0]).toEqual(sendMessage.mock.calls[1][0]);
  });

  it('does not retry application conflicts and rejects mismatched response IDs', async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ protocolVersion: 1, requestId: 'x', error: { code: 'STALE_PREVIEW', message: 'stale' } });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    await expect(rpc('mvp.apply', {}, 'x')).rejects.toThrow('stale');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    sendMessage.mockResolvedValueOnce({ protocolVersion: 1, requestId: 'wrong', result: {} });
    await expect(rpc('mvp.health', {}, 'x')).rejects.toThrow('요청 ID');
  });

  it('passes sourceTabId from an embedded main iframe and preserves direct command protocols', async () => {
    const sendMessage = vi.fn(async (_message: unknown) => ({ result: { ok: true } }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); vi.stubGlobal('location', { href: 'chrome-extension://synthetic-extension/main.html?sourceTabId=12' });
    await captureCurrentPage(); await runWorkAction({ kind: 'search' }); await runLauncher('0');
    expect(sendMessage.mock.calls.map(call => call[0])).toEqual([{ kind: 'mvp.capture', tabId: 12 }, { kind: 'mvp.work', request: { kind: 'search' }, tabId: 12 }, { kind: 'mvp.launch', script: '0', tabId: 12 }]);
  });

  it('reports standalone preview limitations without pretending a DB exists', async () => {
    await expect(captureCurrentPage()).rejects.toThrow('Native Host 설치');
  });
});

// Development-only browser fixture: no live G2B navigation, extension profile or storage writes.
describe('MVP widget feedback in a real browser with synthetic transport', () => {
  let engine: Browser, widgetCode: string;
  beforeAll(async () => {
    const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    if (!executablePath) throw new Error('Existing development Chromium/Chrome/Edge is required for widget verification.');
    const bundle = await build({ entryPoints: ['apps/mvp/widget.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome138' });
    widgetCode = bundle.outputFiles[0].text;
    engine = await chromium.launch({ executablePath, headless: true });
  }, 20000);
  afterAll(async () => { await engine?.close(); });
  async function fixture() {
    const context = await engine.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await page.route('http://127.0.0.1:47900/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body>합성 fixture</body></html>' }));
    await page.goto('http://127.0.0.1:47900/');
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('function');
    await page.evaluate(() => {
      const state = window as any;
      state.__messages = []; state.__listeners = [];
      state.__capture = { url: 'https://www.g2b.go.kr/synthetic', pointInfo: {}, tables: { items: [{ zero: 0, flag: false }] } };
      state.__settings = { theme: 'light', dictionary: { keys: {}, values: {} }, launchers: [{ id: 'one', label: '첫 실행', script: 'void 0' }] };
      state.chrome = { runtime: {
        getURL: (file: string) => new URL(file.replace(/^\//, ''), 'http://127.0.0.1:47900/').href,
        onMessage: { addListener: (listener: unknown) => state.__listeners.push(listener) },
        sendMessage: async (message: any) => {
          state.__messages.push(message);
          if (message.kind === 'mvp.rpc') return { result: { settings: state.__settings } };
          if (message.kind === 'mvp.context') return { result: { tabId: 7 } };
          if (message.kind === 'mvp.capture') return { result: state.__capture };
          return { result: { status: 'applied', message: '합성 안내\n두 번째 줄' } };
        }
      } };
    });
    await page.addScriptTag({ content: widgetCode });
    await expect.poll(() => page.getByRole('button', { name: '첫 실행', exact: true }).count()).toBe(1);
    return { page, close: () => context.close() };
  }
  async function sendFromFrame(page: Page, payload: Record<string, unknown>) {
    await expect.poll(() => page.frames().filter(frame => frame.url().includes('main.html')).length).toBe(1);
    await page.frames().find(frame => frame.url().includes('main.html'))!.evaluate(data => parent.postMessage(data, location.origin), payload);
  }

  it('keeps collapse/restore at the dragged widget position and sends date-only year actions', async () => {
    const { page, close } = await fixture();
    try {
      expect(await page.locator('.head').getByRole('button').count()).toBe(2);
      expect(await page.locator('.head').getByRole('button', { name: '설정', exact: true }).count()).toBe(0);
      const start = await page.locator('.head').boundingBox();
      await page.mouse.move(start!.x + 40, start!.y + 12); await page.mouse.down(); await page.mouse.move(450, 250); await page.mouse.up();
      const before = await page.locator('.control').boundingBox();
      const anchor = await page.getByRole('button', { name: '위젯 접기', exact: true }).boundingBox();
      await page.getByRole('button', { name: '위젯 접기', exact: true }).click();
      const collapsed = await page.locator('.circle').boundingBox();
      expect(collapsed!.x + collapsed!.width / 2).toBeCloseTo(anchor!.x + anchor!.width / 2); expect(collapsed!.y + collapsed!.height / 2).toBeCloseTo(anchor!.y + anchor!.height / 2);
      await page.getByRole('button', { name: '위젯 펼치기', exact: true }).click();
      const restored = await page.locator('.control').boundingBox();
      expect(restored!.x).toBeCloseTo(before!.x); expect(restored!.y).toBeCloseTo(before!.y);
      await page.getByRole('button', { name: '+1년', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__messages.filter((entry: any) => entry.kind === 'mvp.work'))).toEqual([{ kind: 'mvp.work', tabId: undefined, request: { kind: 'yearShift', years: 1, searchAfter: false } }]);
      const widths = await page.locator('.counts').evaluate(element => Array.from(element.children).map(child => child.getBoundingClientRect().width));
      expect(Math.abs(widths[0] - widths[1] * 2)).toBeLessThan(12); expect(widths[1]).toBeCloseTo(widths[2]);
      expect(await page.locator('.message').evaluate(element => ({ text: element.textContent, title: (element as HTMLElement).title, wrap: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).textOverflow, last: element === element.parentElement!.lastElementChild }))).toEqual({ text: '합성 안내 두 번째 줄', title: '합성 안내 두 번째 줄', wrap: 'nowrap', overflow: 'ellipsis', last: true });
    } finally { await close(); }
  }, 20000);

  it('preflights button, keyboard and runtime collection without opening an unsupported capture', async () => {
    const { page, close } = await fixture();
    try {
      await page.getByRole('button', { name: '수집', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__messages.filter((entry: any) => entry.kind === 'mvp.capture').length)).toBe(1);
      await expect.poll(() => page.locator('.message').textContent()).toContain('수집');
      expect(await page.locator('.frame-wrap').count()).toBe(0);
      await page.keyboard.press('Alt+Shift+S');
      await expect.poll(() => page.evaluate(() => (window as any).__messages.filter((entry: any) => entry.kind === 'mvp.capture').length)).toBe(2);
      await page.evaluate(() => (window as any).__listeners.forEach((listener: any) => listener({ kind: 'mvp.open', mode: 'collect' })));
      await expect.poll(() => page.evaluate(() => (window as any).__messages.filter((entry: any) => entry.kind === 'mvp.capture').length)).toBe(3);
      expect(await page.locator('.frame-wrap').count()).toBe(0);
      await page.evaluate(() => { (window as any).__capture.pointInfo = { areaCd: '14', depth1: '01001', depth2: '01114', ctrtDmndRcptNo: 'synthetic-R', ctrtDmndRcptOrd: '00' }; (window as any).__settings.screenRules = []; });
      await page.getByRole('button', { name: '수집', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__messages.filter((entry: any) => entry.kind === 'mvp.capture').length)).toBe(4);
      expect(await page.locator('.frame-wrap').count()).toBe(0);
      await page.evaluate(() => { delete (window as any).__settings.screenRules; });
      await page.getByRole('button', { name: '수집', exact: true }).click();
      await expect.poll(() => page.locator('iframe[title="G2B Helper collect"]').count()).toBe(1);
    } finally { await close(); }
  }, 20000);

  it('opens a small resizable launcher, updates saved buttons live, and independently clamps trusted frame drags', async () => {
    const { page, close } = await fixture();
    try {
      await page.getByRole('button', { name: '런처 추가', exact: true }).click();
      await expect.poll(() => page.locator('.frame-wrap').count()).toBe(1);
      const panel = await page.locator('.frame-wrap').boundingBox(), control = await page.locator('.control').boundingBox();
      expect(panel!.width).toBe(470); expect(panel!.height).toBe(260);
      expect(await page.locator('.frame-wrap').evaluate(element => ({ resize: getComputedStyle(element).resize, minHeight: getComputedStyle(element).minHeight }))).toEqual({ resize: 'both', minHeight: '200px' });
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { kind: 'mvp.settings', settings: { launchers: [] } }, source: window, origin: location.origin })));
      expect(await page.getByRole('button', { name: '첫 실행', exact: true }).count()).toBe(1);
      await sendFromFrame(page, { kind: 'mvp.settings', settings: { launchers: [{ id: 'one', label: '첫 실행', script: 'void 0' }, { id: 'two', label: '둘째 실행', script: 'void 1' }] } });
      await expect.poll(() => page.getByRole('button', { name: '둘째 실행', exact: true }).count()).toBe(1);
      expect(await page.getByRole('button', { name: '첫 실행', exact: true }).count()).toBe(1);
      await sendFromFrame(page, { kind: 'mvp.drag', phase: 'start', screenX: 200, screenY: 100 });
      await sendFromFrame(page, { kind: 'mvp.drag', phase: 'move', screenX: -10000, screenY: -10000 });
      await expect.poll(async () => (await page.locator('.frame-wrap').boundingBox())!.x).toBe(8);
      await sendFromFrame(page, { kind: 'mvp.drag', phase: 'end', screenX: 10000, screenY: 10000 });
      const moved = await page.locator('.frame-wrap').boundingBox();
      expect(moved!.x + moved!.width).toBeLessThanOrEqual(1392); expect(moved!.y + moved!.height).toBeLessThanOrEqual(892);
      expect(await page.locator('.control').boundingBox()).toEqual(control);
      await page.evaluate(() => { const iframe = document.querySelector('#g2b-helper-mvp-root')!.shadowRoot!.querySelector('iframe')!; window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow, origin: 'https://foreign.test', data: { kind: 'mvp.settings', settings: { launchers: [] } } })); });
      expect(await page.getByRole('button', { name: '둘째 실행', exact: true }).count()).toBe(1);
      await sendFromFrame(page, { kind: 'mvp.notice', message: '긴 안내\n두 줄 내용' });
      await expect.poll(() => page.locator('.message').getAttribute('title')).toBe('긴 안내 두 줄 내용');
    } finally { await close(); }
  }, 20000);
});

import { collectPage, mergeFrameCaptures, type PageCapture } from '../../plugins/collector/extractor';
import { performWorkAction, type WorkActionRequest, type WorkActionResult } from '../../plugins/page-actions/index';
import type { MvpEnvelope, MvpResponse } from './contracts';

export const NATIVE_HOST = 'com.sjo1231.g2b_helper';
const commands = new Set(['mvp.health', 'mvp.preview', 'mvp.apply', 'mvp.records', 'mvp.edit', 'mvp.trash', 'mvp.restore', 'mvp.settings.read', 'mvp.settings.save', 'mvp.document.profiles', 'mvp.document.generate']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (error: unknown): string => error instanceof Error ? error.message : String(error);
export function isG2bUrl(value?: string): boolean {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && (url.hostname === 'g2b.go.kr' || url.hostname.endsWith('.g2b.go.kr')); } catch { return false; }
}
function validRequest(value: unknown): value is MvpEnvelope { return object(value) && value.protocolVersion === 1 && typeof value.requestId === 'string' && !!value.requestId.trim() && value.requestId.length <= 200 && typeof value.command === 'string' && commands.has(value.command) && object(value.payload); }
function validResponse(value: unknown, requestId: string): value is MvpResponse {
  return object(value) && value.protocolVersion === 1 && value.requestId === requestId && (Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error')) && (!Object.hasOwn(value, 'error') || (object(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'));
}
interface NativeRuntime { connectNative(name: string): chrome.runtime.Port; lastError?: { message?: string }; }
interface NativeLimits { timeoutMs?: number; requestBytes?: number; responseBytes?: number; }
interface Pending { resolve(value: MvpResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; parts: Map<number, string>; total?: number; bytes: number; }

/** Framing is performed by Chrome; host.py sends JSON envelopes or bounded JSON text chunks.
 * Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging */
export function createNativeClient(runtime: NativeRuntime, limits: NativeLimits = {}) {
  const waiting = new Map<string, Pending>();
  const maxRequest = limits.requestBytes ?? 60 * 1024 * 1024, maxResponse = limits.responseBytes ?? 100 * 1024 * 1024;
  let port: chrome.runtime.Port | undefined;
  function finish(id: string, value?: MvpResponse, error?: Error): void {
    const entry = waiting.get(id); if (!entry) return;
    waiting.delete(id); clearTimeout(entry.timer);
    if (error) entry.reject(error); else entry.resolve(value!);
  }
  function connect(): chrome.runtime.Port {
    if (port) return port;
    const connected = runtime.connectNative(NATIVE_HOST); port = connected;
    connected.onMessage.addListener((message: unknown) => {
      if (!object(message) || typeof message.requestId !== 'string' || !waiting.has(message.requestId)) return;
      const id = message.requestId, pending = waiting.get(id)!;
      try {
        if (message.protocolVersion !== 1) throw new Error('Native 응답 프로토콜 버전이 다릅니다.');
        let value: unknown = message;
        if (Object.hasOwn(message, 'chunk')) {
          const chunk = message.chunk;
          if (!object(chunk) || !Number.isSafeInteger(chunk.index) || !Number.isSafeInteger(chunk.total) || (chunk.index as number) < 0 || (chunk.total as number) < 1 || (chunk.total as number) > 4096 || (chunk.index as number) >= (chunk.total as number) || typeof chunk.text !== 'string' || chunk.text.length > 300000) throw new Error('Native 응답 조각 형식/한도가 올바르지 않습니다.');
          const { index, total, text } = chunk as { index: number; total: number; text: string };
          if (pending.total !== undefined && pending.total !== total) throw new Error('Native 응답 조각 개수가 변경되었습니다.');
          pending.total = total;
          if (pending.parts.has(index) && pending.parts.get(index) !== text) throw new Error('Native 응답 조각 내용이 충돌합니다.');
          if (!pending.parts.has(index)) pending.bytes += new TextEncoder().encode(text).byteLength;
          if (pending.bytes > maxResponse) throw new Error('Native 응답 전체 크기 한도를 초과했습니다.');
          pending.parts.set(index, text);
          if (pending.parts.size < total) return;
          value = JSON.parse(Array.from({ length: total }, (_, part) => pending.parts.get(part)!).join(''));
        } else if (new TextEncoder().encode(JSON.stringify(message)).byteLength > maxResponse) throw new Error('Native 응답 전체 크기 한도를 초과했습니다.');
        if (!validResponse(value, id)) throw new Error('Native 응답 요청 ID/결과 형식이 올바르지 않습니다.');
        finish(id, value);
      } catch (error) { finish(id, undefined, new Error(failure(error))); }
    });
    connected.onDisconnect.addListener(() => {
      const detail = runtime.lastError?.message ?? 'Native 연결 종료';
      if (port === connected) port = undefined;
      for (const id of waiting.keys()) finish(id, undefined, new Error('G2B Helper Native Host 연결 실패: ' + detail + '. Native Host 설치와 확장 ID 등록을 확인하세요.'));
    });
    return connected;
  }
  return {
    request(envelope: MvpEnvelope): Promise<MvpResponse> {
      return new Promise((resolve, reject) => {
        if (!validRequest(envelope)) { reject(new Error('MVP Gateway 요청 형식을 확인하세요.')); return; }
        if (waiting.has(envelope.requestId)) { reject(new Error('같은 요청 ID가 이미 처리 중입니다.')); return; }
        try {
          if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > maxRequest) throw new Error('Native 요청 전체 크기 한도를 초과했습니다.');
          const connection = connect();
          const timer = setTimeout(() => finish(envelope.requestId, undefined, new Error('Native 응답 시간 초과. 동일 요청 ID로 재시도하세요.')), limits.timeoutMs ?? (envelope.command === 'mvp.document.generate' ? 150000 : 45000));
          waiting.set(envelope.requestId, { resolve, reject, timer, parts: new Map(), bytes: 0 });
          connection.postMessage(envelope);
        } catch (error) { if (waiting.has(envelope.requestId)) finish(envelope.requestId, undefined, new Error(failure(error))); else reject(new Error(failure(error))); }
      });
    },
    dispose(): void { for (const id of waiting.keys()) finish(id, undefined, new Error('Native 연결을 닫았습니다.')); const previous = port; port = undefined; previous?.disconnect(); }
  };
}

export interface MvpBrowser { runtime: typeof chrome.runtime; tabs: typeof chrome.tabs; scripting: typeof chrome.scripting; userScripts?: typeof chrome.userScripts; }
async function tabFor(api: MvpBrowser, explicit?: number): Promise<chrome.tabs.Tab> {
  if (explicit !== undefined && (!Number.isSafeInteger(explicit) || explicit < 0)) throw new Error('원본 페이지 탭 ID를 확인하세요.');
  const tab = explicit === undefined ? (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0] : await api.tabs.get(explicit);
  if (!tab || tab.id === undefined || !isG2bUrl(tab.url)) throw new Error('현재 나라장터 HTTP/HTTPS 탭에서 실행하세요.');
  return tab;
}
export async function captureTab(api: MvpBrowser, explicit?: number): Promise<PageCapture> {
  const tab = await tabFor(api, explicit);
  // Self-contained existing function is serialized into each actual MAIN-world frame.
  const injected = await api.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, world: 'MAIN', func: collectPage, args: [false] });
  if (!injected.length) throw new Error('읽을 수 있는 화면 frame이 없습니다.');
  const current = await tabFor(api, tab.id);
  if (current.url !== tab.url) throw new Error('추출 중 페이지가 이동했습니다. 현재 화면에서 다시 추출하세요.');
  const result = mergeFrameCaptures(injected);
  const locations = await api.scripting.executeScript({ target: { tabId: tab.id!, frameIds: injected.map(frame => frame.frameId) }, world: 'MAIN', func: () => window.location.href });
  for (const injection of injected) if (injection.result) {
    const expected = injection.result.frames.find(frame => frame.framePath === 'top')?.url;
    if (!expected || locations.find(frame => frame.frameId === injection.frameId)?.result !== expected) throw new Error('추출 frame이 이동했거나 URL 확인에 실패했습니다. 다시 추출하세요.');
  }
  return result;
}

export async function workTab(api: MvpBrowser, request: WorkActionRequest, explicit?: number): Promise<WorkActionResult> {
  const tab = await tabFor(api, explicit);
  if (!request || !['detect', 'yearShift', 'yearRange', 'setRowCount', 'search', 'excel'].includes(request.kind)) throw new Error('업무 동작 종류를 확인하세요.');
  const inspected = await api.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, world: 'MAIN', func: performWorkAction, args: [{ ...request, traverseFrames: false, mode: 'inspect' }] });
  const candidates = inspected.flatMap(frame => frame.result?.candidates ?? []);
  const warnings = inspected.flatMap(frame => (frame.result?.warnings ?? []).map(warning => 'frame ' + frame.frameId + ': ' + warning));
  const matches = inspected.filter(frame => frame.result?.status === 'ready' || frame.result?.status === 'needsSelection');
  if (request.kind === 'detect') return { status: candidates.length ? 'ready' : 'unavailable', candidates, selected: {}, changes: [], clicked: false, warnings, message: candidates.length ? '현재 frame의 업무 요소 후보입니다.' : '업무 요소를 찾지 못했습니다.' };
  if (matches.length > 1 || matches.some(frame => frame.result?.status === 'needsSelection')) return { status: 'needsSelection', candidates, selected: {}, changes: [], clicked: false, warnings, message: '여러 frame/요소 후보가 있습니다. 사용할 화면을 하나만 열거나 요소를 명시하세요.' };
  const selected = matches[0];
  if (!selected?.result) return inspected.find(frame => frame.result?.status === 'invalid')?.result ?? inspected.find(frame => frame.result)?.result ?? { status: 'unavailable', candidates, selected: {}, changes: [], clicked: false, warnings, message: '업무 요소를 찾지 못했습니다.' };
  if (request.mode === 'inspect') return { ...selected.result, candidates, warnings };
  let applyRequest = { ...request, traverseFrames: false, mode: 'apply' as const };
  if (request.kind === 'yearShift') {
    const originalDate = selected.result.selected.startDate?.value ?? '';
    const startYear = /^(\d{4})(?:-?\d{2}){2}$/.exec(originalDate)?.[1];
    if (!startYear || !Number.isInteger(request.years) || Math.abs(request.years!) > 100 || request.years === 0) throw new Error('이동할 조회 연도와 원래 시작일을 확인하세요.');
    applyRequest = { ...applyRequest, kind: 'yearRange', year: Number(startYear) + request.years!, searchAfter: request.searchAfter === true };
  }
  const current = await tabFor(api, tab.id);
  if (current.url !== tab.url) throw new Error('업무 동작 확인 중 페이지가 이동했습니다. 다시 실행하세요.');
  const applied = await api.scripting.executeScript({ target: { tabId: tab.id!, ...(selected.documentId ? { documentIds: [selected.documentId] } : { frameIds: [selected.frameId] }) }, world: 'MAIN', func: performWorkAction, args: [applyRequest] });
  if (applied.length !== 1 || !applied[0].result) throw new Error('업무 동작 실행 frame 결과를 확인할 수 없습니다.');
  return { ...applied[0].result, warnings: [...warnings, ...applied[0].result.warnings] };
}

export async function launcherTab(api: MvpBrowser, script: string, explicit?: number): Promise<unknown> {
  const tab = await tabFor(api, explicit);
  if (typeof script !== 'string' || !script.trim() || script.length > 1024 * 1024) throw new Error('실행할 사용자 스크립트를 확인하세요 (최대 1 MiB 문자).');
  // Chrome 138+: enable extension Details > Allow User Scripts; no eval/CDN execution.
  // Source: https://developer.chrome.com/docs/extensions/reference/api/userScripts#enable-usage-of-the-userscripts-api
  try { if (!api.userScripts) throw new Error('disabled'); await api.userScripts.getScripts(); } catch { throw new Error('확장 관리 → G2B Helper 세부정보 → 사용자 스크립트 허용을 켜세요. Chrome/Edge 138 이상과 나라장터 사이트 접근 권한이 필요합니다.'); }
  return api.userScripts.execute({ target: { tabId: tab.id! }, world: 'MAIN', js: [{ code: script }] });
}

export async function handleMvpMessage(api: MvpBrowser, native: ReturnType<typeof createNativeClient>, message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!object(message) || typeof message.kind !== 'string') throw new Error('MVP 메시지 형식을 확인하세요.');
  const extensionPage = sender.url?.startsWith(api.runtime.getURL('')) === true;
  const widget = sender.tab?.id !== undefined && isG2bUrl(sender.url);
  if (sender.id !== api.runtime.id || (!extensionPage && !widget)) throw new Error('G2B Helper 확장 화면에서만 실행할 수 있습니다.');
  const tabId = widget && !extensionPage ? sender.tab!.id : message.tabId as number | undefined;
  if (message.kind === 'mvp.rpc') {
    if (!validRequest(message.envelope)) throw new Error('MVP Gateway 요청 형식을 확인하세요.');
    if (['mvp.preview', 'mvp.apply'].includes(message.envelope.command)) await tabFor(api, tabId);
    try { return await native.request(message.envelope); }
    catch (error) { throw Object.assign(new Error(failure(error)), { nativeTransport: true }); }
  }
  if (message.kind === 'mvp.context') return { result: { tabId: (await tabFor(api, tabId)).id } };
  if (message.kind === 'mvp.capture') return { result: await captureTab(api, tabId) };
  if (message.kind === 'mvp.work') return { result: await workTab(api, message.request as unknown as WorkActionRequest, tabId) };
  if (message.kind === 'mvp.launch') return { result: await launcherTab(api, message.script as string, tabId) };
  if (message.kind === 'mvp.open') { await openMode(api, String(message.mode), tabId); return { result: { opened: true } }; }
  throw new Error('지원하지 않는 MVP 명령입니다.');
}

async function openMode(api: MvpBrowser, mode: string, explicit?: number): Promise<void> {
  if (!['collect', 'extract', 'db', 'document', 'launcher'].includes(mode)) throw new Error('열 기능을 확인하세요.');
  const tab = await tabFor(api, explicit);
  try { await api.tabs.sendMessage(tab.id!, { kind: 'mvp.open', mode }, { frameId: 0 }); }
  catch { await api.scripting.executeScript({ target: { tabId: tab.id!, frameIds: [0] }, world: 'ISOLATED', files: ['widget.js'] }); await api.tabs.sendMessage(tab.id!, { kind: 'mvp.open', mode }, { frameId: 0 }); }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  const api: MvpBrowser = chrome, native = createNativeClient(chrome.runtime);
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!object(message) || typeof message.kind !== 'string' || !message.kind.startsWith('mvp.')) return false;
    void handleMvpMessage(api, native, message, sender).then(sendResponse, error => sendResponse(message.kind === 'mvp.rpc' ? { protocolVersion: 1, requestId: object(message.envelope) ? message.envelope.requestId : '', error: { code: object(error) && error.nativeTransport ? 'NATIVE_TRANSPORT' : 'REQUEST_DENIED', message: failure(error) } } : { error: failure(error) }));
    return true;
  });
  chrome.action.onClicked.addListener(tab => { if (tab.id !== undefined && isG2bUrl(tab.url)) void chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED', files: ['widget.js'] }).catch(console.error); });
  chrome.commands.onCommand.addListener(command => { const mode = command.startsWith('mvp.') ? command.slice(4) : ''; void openMode(api, mode).catch(console.error); });
}

import type { PageCapture } from '../../plugins/collector/extractor';
import type { WorkActionRequest, WorkActionResult } from '../../plugins/page-actions/index';
import type { MvpEnvelope, MvpResponse, MvpRpcCommand } from './contracts';

function runtime(): typeof chrome.runtime {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) throw new Error('확장 프로그램 안에서 실행하세요. DB 기능은 G2B Helper Native Host 설치와 확장 ID 등록이 필요합니다.');
  return chrome.runtime;
}
function sourceTabId(): number | undefined {
  if (typeof location === 'undefined') return undefined;
  const value = new URL(location.href).searchParams.get('sourceTabId');
  if (value === null) return undefined;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) throw new Error('원본 페이지 탭 ID를 확인하세요.');
  return number;
}
async function message<T>(body: Record<string, unknown>, tabId = sourceTabId()): Promise<T> {
  const reply = await runtime().sendMessage({ ...body, ...(tabId !== undefined ? { tabId } : {}) }) as { result?: T; error?: string } | undefined;
  if (!reply) throw new Error('확장 프로그램 응답이 없습니다. 확장을 다시 로드하세요.');
  if (reply.error) throw new Error(reply.error);
  return reply.result as T;
}
/** Retry transport errors with the same request ID; the Native Host owns idempotent writes. */
export async function rpc<T = unknown>(command: MvpRpcCommand, payload: Record<string, unknown> = {}, requestId: string = crypto.randomUUID()): Promise<T> {
  const envelope: MvpEnvelope = { protocolVersion: 1, requestId, command, payload };
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: MvpResponse;
    try {
      response = await runtime().sendMessage({ kind: 'mvp.rpc', envelope, ...(sourceTabId() !== undefined ? { tabId: sourceTabId() } : {}) }) as MvpResponse;
    } catch (error) { lastError = error instanceof Error ? error : new Error(String(error)); continue; }
    if (!response || response.protocolVersion !== 1 || response.requestId !== requestId) throw new Error('Gateway 응답 버전 또는 요청 ID가 다릅니다.');
    if (response.error) {
      lastError = new Error(response.error.message);
      if (response.error.code === 'NATIVE_TRANSPORT') continue;
      throw lastError;
    }
    return response.result as T;
  }
  const error = new Error((lastError?.message ?? 'Native Host 응답을 확인할 수 없습니다.') + ' 동일 요청 ID로 재시도하세요: ' + requestId);
  Object.assign(error, { requestId });
  throw error;
}
export function captureCurrentPage(tabId?: number): Promise<PageCapture> { return message<PageCapture>({ kind: 'mvp.capture' }, tabId); }
export function pendingWrite(): Promise<import('./pending-write').PendingWrite | null> { return message({ kind: 'mvp.pending.read' }); }
export function recoverWrite(requestId?: string, retry = false): Promise<import('./pending-write').RecoveryResult> { return message({ kind: 'mvp.pending.recover', requestId, retry }); }
export function runWorkAction(request: WorkActionRequest, tabId?: number): Promise<WorkActionResult> { return message<WorkActionResult>({ kind: 'mvp.work', request }, tabId); }
export function runLauncher(script: string, tabId?: number): Promise<unknown> { return message({ kind: 'mvp.launch', script }, tabId); }
export function currentContext(tabId?: number): Promise<{ tabId: number }> { return message({ kind: 'mvp.context' }, tabId); }

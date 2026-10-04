import type { MvpEnvelope, MvpResponse } from './contracts';

export const trackedWrites = new Set(['mvp.apply', 'mvp.edit', 'mvp.trash', 'mvp.restore', 'mvp.settings.save', 'mvp.corrections.reset']);
const key = 'mvp.pendingWrite';
export interface PendingWrite { envelope: MvpEnvelope; createdAt: string; }
export interface PendingStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface RecoveryResult { status: 'none' | 'stored' | 'not-found' | 'rejected'; pending?: PendingWrite; response?: MvpResponse; }

/** The browser session retains only an unresolved write, never the canonical database. */
export function createPendingWrites(storage: PendingStore, send: (request: MvpEnvelope) => Promise<MvpResponse>) {
  let busy = false;
  async function read(): Promise<PendingWrite | undefined> {
    const value = (await storage.get(key))[key] as PendingWrite | undefined;
    if (value === undefined) return;
    if (!value || !value.envelope || value.envelope.protocolVersion !== 1 || !trackedWrites.has(value.envelope.command) || typeof value.envelope.requestId !== 'string' || !value.envelope.requestId.trim() || !value.envelope.payload || typeof value.envelope.payload !== 'object' || Array.isArray(value.envelope.payload)) throw new Error('미확인 저장 기록을 읽지 못했습니다. 새 저장을 중단합니다.');
    return structuredClone(value);
  }
  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (busy) throw new Error('다른 저장을 처리 중입니다. 잠시 후 다시 확인하세요.');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  async function transmit(pending: PendingWrite): Promise<MvpResponse> {
    const response = await send(pending.envelope);
    if (response.requestId !== pending.envelope.requestId || response.protocolVersion !== 1 || (Object.hasOwn(response, 'result') === Object.hasOwn(response, 'error'))) throw new Error('저장 응답을 확인하지 못했습니다.');
    await storage.remove(key);
    return response;
  }
  async function inspect(pending: PendingWrite): Promise<RecoveryResult> {
    const response = await send({ protocolVersion: 1, requestId: crypto.randomUUID(), command: 'mvp.request.status', payload: { requestId: pending.envelope.requestId } });
    if (response.error) throw new Error(response.error.message);
    const result = response.result as { status?: string; response?: MvpResponse } | undefined;
    if (result?.status === 'not-found') return { status: 'not-found', pending };
    if (result?.status !== 'stored' || !result.response || result.response.requestId !== pending.envelope.requestId || result.response.protocolVersion !== 1 || !Object.hasOwn(result.response, 'result') || result.response.error) throw new Error('이전 저장 결과를 확인하지 못했습니다.');
    await storage.remove(key);
    return { status: 'stored', pending, response: result.response };
  }
  return {
    read,
    request(envelope: MvpEnvelope): Promise<MvpResponse> {
      if (!trackedWrites.has(envelope.command)) return send(envelope);
      return exclusive(async () => {
        const previous = await read();
        if (previous) {
          if (JSON.stringify(previous.envelope) !== JSON.stringify(envelope)) throw new Error('이전 저장 결과가 미확인입니다. 저장 결과 확인에서 먼저 처리하세요.');
          const result = await inspect(previous);
          if (result.status === 'stored') return result.response!;
          return transmit(previous);
        }
        const pending = { envelope: structuredClone(envelope), createdAt: new Date().toISOString() };
        if (new TextEncoder().encode(JSON.stringify(pending)).byteLength > 8 * 1024 * 1024) throw new Error('한 번에 저장할 자료가 너무 큽니다. 8 MB 이하로 나누어 저장하세요.');
        // If session persistence fails, no native mutation has been sent.
        await storage.set({ [key]: pending });
        return transmit(pending);
      });
    },
    recover(requestId?: string, retry = false): Promise<RecoveryResult> {
      return exclusive(async () => {
        const pending = await read();
        if (!pending) return { status: 'none' };
        if (requestId !== undefined && requestId !== pending.envelope.requestId) throw new Error('미확인 요청이 바뀌었습니다. 다시 확인하세요.');
        const result = await inspect(pending);
        if (result.status !== 'not-found' || !retry) return result;
        const response = await transmit(pending);
        return { status: response.error ? 'rejected' : 'stored', pending, response };
      });
    }
  };
}

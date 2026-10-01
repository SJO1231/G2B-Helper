import type { CapturePayload, TransferCapture, TransferBundle } from '../../packages/contracts/src/index';
export type { TransferCapture, TransferBundle };
export function createCapture(payload: CapturePayload, origin: string, templateId?: string, purpose?: TransferCapture['purpose']): TransferCapture {
  return { captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), origin, payload, ...(templateId ? { templateId } : {}), ...(purpose ? {purpose} : {}) };
}
export function createBundle(captures: TransferCapture[], origin: string, settingsReferences?: unknown): TransferBundle {
  return { format: 'pce-transfer', version: 1, exportedAt: new Date().toISOString(), origin, captures, ...(settingsReferences ? { settingsReferences } : {}) };
}

/** Stops invalidate pending ticks even when collection/finalization rejects. */
export class CollectionLoop {
  active = false;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private running?: Promise<void>;
  constructor(private readonly collect: () => Promise<void>, private readonly failed: (error: unknown) => void, private readonly intervalMs = 5000) {}
  start(delayFirst = false): void {
    if (this.active) return;
    this.active = true;
    const generation = ++this.generation;
    const tick = () => {
      if (!this.active || generation !== this.generation) return;
      this.running = this.collect().catch(error => { this.failed(error); }).finally(() => {
        if (this.active && generation === this.generation) this.timer = setTimeout(tick, this.intervalMs);
      });
    };
    if(delayFirst)this.timer=setTimeout(tick,this.intervalMs);else tick();
  }
  async stop(finalize?: () => Promise<void>): Promise<void> {
    this.active = false;
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    try { await this.running; await finalize?.(); }
    finally { this.active = false; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  }
}


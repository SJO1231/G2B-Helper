import { describe, expect, it, vi } from 'vitest';
import { createPendingWrites, type PendingStore } from '../../apps/mvp/pending-write';
import type { MvpEnvelope, MvpResponse } from '../../apps/mvp/contracts';
const request: MvpEnvelope = { protocolVersion: 1, requestId: 'same-id', command: 'mvp.edit', payload: { rows: [{ id: '001', value: 0, flag: false }] } };
const reply = (r: MvpEnvelope, result: unknown): MvpResponse => ({ protocolVersion: 1, requestId: r.requestId, result });
function store(): PendingStore {
  const data: Record<string, unknown> = {};
  return { get: vi.fn(async () => structuredClone(data)), set: vi.fn(async value => { Object.assign(data, structuredClone(value)); }), remove: vi.fn(async key => { delete data[key]; }) };
}
describe('unconfirmed writes across views and worker recreation', () => {
  it('retains the exact request and recovers stored response without repeating a write', async () => {
    const storage = store(), first = createPendingWrites(storage, async () => { throw new Error('lost reply'); });
    await expect(first.request(request)).rejects.toThrow('lost reply');
    const send = vi.fn(async (r: MvpEnvelope) => reply(r, { status: 'stored', response: reply(request, { saved: true }) }));
    const recovered = createPendingWrites(storage, send);
    expect((await recovered.read())?.envelope).toEqual(request);
    expect(await recovered.recover()).toMatchObject({ status: 'stored', response: { result: { saved: true } } });
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0].command).toBe('mvp.request.status'); expect(await recovered.read()).toBeUndefined();
  });
  it('requires explicit retry after status says not-found and preserves 0/false/leading zeros', async () => {
    const storage=store(), first=createPendingWrites(storage,async()=>{throw new Error('disconnect');});
    await expect(first.request(request)).rejects.toThrow();
    const send=vi.fn(async(r:MvpEnvelope)=>reply(r,r.command==='mvp.request.status'?{status:'not-found'}:{saved:true}));
    const client=createPendingWrites(storage,send);
    expect((await client.recover()).status).toBe('not-found');expect(send).toHaveBeenCalledTimes(1);
    expect((await client.recover('same-id',true)).status).toBe('stored');expect(send.mock.calls[2][0]).toEqual(request);
  });
  it('does not send when session persistence fails', async () => {
    const storage=store();storage.set=vi.fn(async()=>{throw new Error('quota');});const send=vi.fn();
    await expect(createPendingWrites(storage,send).request(request)).rejects.toThrow('quota');expect(send).not.toHaveBeenCalled();
  });
  it('blocks other requests and changed payload for an unresolved request', async () => {
    const storage=store(),send=vi.fn(async()=>{throw new Error('lost');}),client=createPendingWrites(storage,send);
    await expect(client.request(request)).rejects.toThrow();
    await expect(client.request({...request,requestId:'new'})).rejects.toThrow('미확인');
    await expect(client.request({...request,payload:{changed:true}})).rejects.toThrow('미확인');expect(send).toHaveBeenCalledTimes(1);
  });
  it('keeps pending on failed status and rejects stale recovery controls', async () => {
    const storage=store(),client=createPendingWrites(storage,async()=>{throw new Error('offline');});
    await expect(client.request(request)).rejects.toThrow();await expect(client.recover('other',true)).rejects.toThrow('바뀌었');
    await expect(client.recover()).rejects.toThrow('offline');expect(await client.read()).toBeDefined();
  });
  it('same-ID transport retry queries status before sending the same payload', async () => {
    const storage=store();let writes=0;
    const send=vi.fn(async(r:MvpEnvelope)=>{if(r.command==='mvp.request.status')return reply(r,{status:'not-found'});if(++writes===1)throw new Error('lost');return reply(r,{saved:true});});
    const client=createPendingWrites(storage,send);await expect(client.request(request)).rejects.toThrow();expect(await client.request(request)).toMatchObject({result:{saved:true}});
    expect(send.mock.calls.map(([r])=>r.command)).toEqual(['mvp.edit','mvp.request.status','mvp.edit']);
  });
  it('concurrent mutations do not overwrite pending intent', async () => {
    let done!:(r:MvpResponse)=>void;const storage=store(),client=createPendingWrites(storage,()=>new Promise(resolve=>{done=resolve;}));
    const one=client.request(request);await vi.waitFor(()=>expect(done).toBeDefined());
    await expect(client.request({...request,requestId:'two'})).rejects.toThrow('처리 중');done(reply(request,{saved:true}));await one;expect(await client.read()).toBeUndefined();
  });
  it('clears a known validation rejection but retains a malformed or wrong-ID result', async () => {
    const storage=store(),client=createPendingWrites(storage,async r=>({protocolVersion:1,requestId:r.requestId,error:{code:'STALE',message:'stale'}}));
    expect((await client.request(request)).error?.code).toBe('STALE');expect(await client.read()).toBeUndefined();
    const broken=createPendingWrites(storage,async()=>reply({...request,requestId:'wrong'},{}));await expect(broken.request(request)).rejects.toThrow('응답');expect(await broken.read()).toBeDefined();
  });
});

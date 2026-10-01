import { useEffect, useRef } from 'react';
import { mountCollectorPanel } from '../collector-panel';
import { createLocalDataset } from '../dataset-model';
import type { BookmarkletPlugin, CollectorPanelHandle, PrototypeServices } from '../contracts';
import { PageActions } from './PageActions';

export function WorkPanel({ services }: { services: PrototypeServices }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let controller: CollectorPanelHandle | undefined, disposed = false;
    const mounted = mountCollectorPanel(container.current!, { onDataset: async (name, rows) => { await createLocalDataset(name, rows, undefined, 'collected'); window.dispatchEvent(new CustomEvent('pce:datasets-changed')); services.notify('추출한 표를 독립 자료집으로 저장했습니다.'); services.navigate('tables'); } }).then(handle => { if (disposed) void handle.close(); else controller = handle;return handle; }).catch(error => {services.notify('업무 패널 오류: ' + String(error));return undefined;});
    const close = (event?: Event) => { disposed = true; const pending = controller ? controller.close() : mounted.then(handle => handle?.close()); if (event instanceof CustomEvent) (event.detail as Promise<void>[]).push(pending); return pending; };
    window.addEventListener('pce:closing', close);
    const pause=(event:Event)=>{const pending=controller?controller.pause():mounted.then(handle=>handle?.pause());if(event instanceof CustomEvent)(event.detail as Promise<void>[]).push(pending);};
    window.addEventListener('pce:automation-pause',pause);
    return () => { window.removeEventListener('pce:closing', close);window.removeEventListener('pce:automation-pause',pause);void close(); };
  }, []);
  return <div style={{display:'flex',flexDirection:'column',height:'100%',gap:10}}><PageActions services={services}/><div style={{flex:1,minHeight:500}} className="collector-container" ref={container} /></div>;
}
export const workPlugin: BookmarkletPlugin = { id: 'prototype.work', label: '업무', features: ['designated-collection', 'extraction', 'capture-outbox'], component: WorkPanel };

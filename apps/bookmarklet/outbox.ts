import { canonicalJson } from './capture-identity';
import type { TransferCapture } from '../../packages/contracts/src/index';

export function openOutbox(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('pce-bookmarklet', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('captures')) request.result.createObjectStore('captures', { keyPath: 'captureId' });
      if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 열기 실패'));
    request.onblocked = () => reject(new Error('다른 탭이 보관함을 사용 중입니다. 다른 PCE 탭을 닫고 다시 시도하세요.'));
  });
}
export async function listCaptures(): Promise<TransferCapture[]> {
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('captures', 'readonly');
      const request = tx.objectStore('captures').getAll();
      tx.oncomplete = () => resolve(request.result.sort((a: TransferCapture, b: TransferCapture) => b.capturedAt.localeCompare(a.capturedAt)));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function saveCapture(capture: TransferCapture): Promise<{ capture: TransferCapture; duplicate: boolean }> {
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('captures', 'readwrite');
      const store = tx.objectStore('captures');
      const request = store.getAll();
      let result = { capture, duplicate: false };
      request.onsuccess = () => {
        const previous = request.result.find((candidate: TransferCapture) => candidate.captureId === capture.captureId);
        if (previous && canonicalJson(previous) !== canonicalJson(capture)) { tx.abort(); return; }
        if (previous) result = { capture: previous, duplicate: true };
        else store.add(capture);
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('보관함 쓰기 실패'));
      tx.onabort = () => reject(tx.error || new Error('같은 이벤트 ID의 내용이 다릅니다. 원본을 유지하고 저장을 중단했습니다.'));
    });
  } finally { db.close(); }
}
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const request = tx.objectStore('settings').get(key);
      tx.oncomplete = () => resolve(request.result === undefined ? fallback : request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function writeSetting(key: string, value: unknown): Promise<void> {
  const db = await openOutbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}


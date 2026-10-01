import type { CapturePayload, TransferBundle, TransferCapture } from '../../packages/contracts/src/index';
import { parseCollectionPolicy } from '../../plugins/collector/scope';
import type { LocalDocument, PrototypeNamespace } from './contracts';
import { openOutbox } from './outbox';
import { canonicalJson } from './capture-identity';
import { validateTemplateProgram } from '../../plugins/template/index';
import { validateHwpxTemplate, validateResolvedHwpxTemplate, resolveHwpxTemplate, type HwpxTemplate } from '../../plugins/hwpx/index';

const namespaces: PrototypeNamespace[] = ['datasets', 'notes', 'launchers', 'templates', 'relations', 'hwpx-templates'];
const prefix = 'prototype:';
const documentKey = (namespace: PrototypeNamespace, documentId: string) => `${prefix}${namespace}:${documentId}`;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function fail(reason: string): never { throw new Error(reason); }

export async function listDocuments<T>(namespace: PrototypeNamespace): Promise<LocalDocument<T>[]> {
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const cursor = tx.objectStore('settings').openCursor();
      const entries: LocalDocument<T>[] = [];
      cursor.onsuccess = () => {
        const position = cursor.result;
        if (!position) return;
        if (String(position.key).startsWith(`${prefix}${namespace}:`)) entries.push(position.value);
        position.continue();
      };
      tx.oncomplete = () => resolve(entries.sort((a, b) => a.documentId.localeCompare(b.documentId)));
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('로컬 자료 조회 실패'));
    });
  } finally { db.close(); }
}

export async function putDocument<T>(namespace: PrototypeNamespace, documentId: string, expectedVersion: number | null, value: T, expectedReferences?:{documentId:string;storeVersion:number}[]): Promise<LocalDocument<T>> {
  if (!namespaces.includes(namespace) || !documentId || !object(value)) fail('로컬 문서 형식을 확인하세요.');
  validatePrototypeValue(namespace, value);
  let document: LocalDocument<T>;
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite'), store = tx.objectStore('settings');
      const get = store.get(documentKey(namespace, documentId)), sequence = store.get('prototype.storeSequence'), references = namespace==='hwpx-templates'?store.getAll():undefined;
      let conflict = false, completed = 0;
      let referenceError='';
      const commit = () => {
        if (++completed !== (references?3:2)) return;
        const previous = get.result as LocalDocument<T> | undefined;
        if ((previous?.storeVersion ?? null) !== expectedVersion) { conflict = true; tx.abort(); return; }
        const storeVersion = Math.max(Number(sequence.result) || 0, previous?.storeVersion ?? 0) + 1;
        document = { namespace, documentId, storeVersion, value: structuredClone(value) };
        if (references) {
          try {
            const entries = (references.result as LocalDocument<HwpxTemplate>[]).filter(entry => entry?.namespace === 'hwpx-templates' && entry.documentId !== documentId);
            if (expectedReferences?.some(expected => entries.find(entry => entry.documentId === expected.documentId)?.storeVersion !== expected.storeVersion)) throw new Error('원본 템플릿이 변경되었습니다. 다시 열어 비교하세요. 편집 내용은 유지됩니다.');
            const candidates = [...entries, document as unknown as LocalDocument<HwpxTemplate>];
            const children = new Map<string, string[]>();
            for (const entry of candidates) {
              const baseId = entry.value.baseTemplateId;
              if (baseId) children.set(baseId, [...(children.get(baseId) ?? []), entry.documentId]);
            }
            // Validate the edited template and every affected descendant against the
            // same transaction snapshot before writing either content or its version.
            const affected = [documentId], seen = new Set<string>(affected);
            for (let index = 0; index < affected.length; index++) {
              for (const childId of children.get(affected[index]) ?? []) {
                if (!seen.has(childId)) { seen.add(childId); affected.push(childId); }
              }
            }
            for (const affectedId of affected) {
              try {
                validateResolvedHwpxTemplate(resolveHwpxTemplate(affectedId, candidates).template);
              } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                if (affectedId === documentId) throw error;
                const name = candidates.find(entry => entry.documentId === affectedId)?.value.name ?? affectedId;
                throw new Error(`파생 템플릿 '${name}'의 연결이 유효하지 않아 저장하지 않았습니다: ${reason}`);
              }
            }
          } catch (error) {
            referenceError = error instanceof Error ? error.message : String(error);
            tx.abort();
            return;
          }
        }
        store.put(document, documentKey(namespace, documentId)); store.put(storeVersion, 'prototype.storeSequence');
      };
      get.onsuccess = sequence.onsuccess = commit;
      if(references)references.onsuccess=commit;
      tx.oncomplete = () => resolve(document!);
      tx.onerror = tx.onabort = () => reject(new Error(referenceError|| (conflict ? '다른 창에서 자료가 변경되었습니다. 편집 내용은 유지됩니다. 다시 열어 비교하세요.' : '저장 실패. 편집 내용은 유지됩니다. ' + (tx.error?.message ?? ''))));
    });
  } finally { db.close(); }
}

export async function removeDocument(namespace: PrototypeNamespace, documentId: string, expectedVersion: number): Promise<void> {
  const db = await openOutbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite'), store = tx.objectStore('settings'), get = store.get(documentKey(namespace, documentId));
      let conflict = false,referenced=false;
      get.onsuccess = () => { if (get.result?.storeVersion !== expectedVersion) { conflict = true; tx.abort(); } else if(namespace==='hwpx-templates'){const all=store.getAll();all.onsuccess=()=>{if(all.result.some(entry=>entry?.namespace===namespace&&entry.value?.baseTemplateId===documentId)){referenced=true;tx.abort();}else store.delete(documentKey(namespace,documentId));};}else store.delete(documentKey(namespace, documentId)); };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error(referenced?'파생 템플릿이 참조 중입니다. 파생 템플릿을 먼저 정리하세요.':conflict ? '자료가 변경되어 삭제하지 않았습니다. 다시 읽으세요.' : '삭제 실패'));
    });
  } finally { db.close(); }
}

function validateCapture(value: unknown): asserts value is TransferCapture {
  if (!object(value) || typeof value.captureId !== 'string' || !value.captureId || typeof value.origin !== 'string' || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))) fail('수집 이벤트 식별정보 형식이 잘못되었습니다.');
  if (value.purpose !== undefined && !['collection', 'extraction-save'].includes(String(value.purpose))) fail('지원하지 않는 수집 이벤트 구분입니다.');
  const validatePayload = (payload: unknown) => {
    if (!object(payload) || !object(payload.pointInfo) || !object(payload.tables)) fail('원본 자료에는 pointInfo와 tables가 필요합니다.');
    if (Object.values(payload.tables).some(rows => !Array.isArray(rows) || rows.some(row => !object(row)))) fail('표 자료는 객체 행 배열이어야 합니다.');
  };
  validatePayload(value.payload);
  const payload = value.payload as Record<string, unknown>;
  if (payload.warnings !== undefined && (!Array.isArray(payload.warnings) || payload.warnings.some(warning => typeof warning !== 'string'))) fail('읽기 경고 형식이 잘못되었습니다.');
  if (payload.frames !== undefined) {
    if (!Array.isArray(payload.frames)) fail('frame 출처 형식이 잘못되었습니다.');
    for (const frame of payload.frames) { if (!object(frame) || typeof frame.framePath !== 'string' || typeof frame.url !== 'string') fail('frame 출처 형식이 잘못되었습니다.'); validatePayload(frame); }
  }
}

export function parseTransferBundle(value: unknown): TransferBundle {
  if (!object(value) || value.format !== 'pce-transfer' || value.version !== 1 || typeof value.origin !== 'string' || typeof value.exportedAt !== 'string' || !Array.isArray(value.captures)) fail('지원하는 PCE 전달 JSON(version 1)이 아닙니다.');
  value.captures.forEach(validateCapture);
  if (new Set(value.captures.map(capture => capture.captureId)).size !== value.captures.length) fail('파일 안에 같은 수집 이벤트 ID가 반복됩니다.');
  return value as unknown as TransferBundle;
}

export function parseRawCapture(value: unknown): CapturePayload {
  validateCapture({ captureId: 'raw-file-validation', capturedAt: new Date().toISOString(), origin: 'file-input', payload: value });
  return value as CapturePayload;
}

export async function importTransferBundle(bundle: TransferBundle): Promise<{ added: number; duplicate: number }> {
  parseTransferBundle(bundle);
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('captures', 'readwrite'), store = tx.objectStore('captures');
      const existing = store.getAll(); let added = 0, duplicate = 0, conflict = '';
      existing.onsuccess = () => {
        const byId = new Map<string, TransferCapture>(existing.result.map(capture => [capture.captureId, capture]));
        for (const capture of bundle.captures) {
          const previous = byId.get(capture.captureId);
          if (previous && canonicalJson(previous) !== canonicalJson(capture)) { conflict = '같은 이벤트 ID의 내용이 달라 전체 가져오기를 중단했습니다.'; tx.abort(); return; }
          if (previous) duplicate++; else { store.add(capture); added++; }
        }
      };
      tx.oncomplete = () => resolve({ added, duplicate });
      tx.onerror = tx.onabort = () => reject(new Error(conflict || '전달 JSON 가져오기 실패. 기존 보관함은 유지됩니다.'));
    });
  } finally { db.close(); }
}

export interface PrototypeBackup { format: 'pce-bookmarklet-backup'; version: 1; origin: string; exportedAt: string; captures: TransferCapture[]; settings: [string, unknown][]; }
export async function exportPrototypeBackup(): Promise<PrototypeBackup> {
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['captures', 'settings'], 'readonly');
      const captures = tx.objectStore('captures').getAll(), settings: [string, unknown][] = [];
      const cursor = tx.objectStore('settings').openCursor();
      cursor.onsuccess = () => { const entry = cursor.result; if (entry) { settings.push([String(entry.key), entry.value]); entry.continue(); } };
      tx.oncomplete = () => resolve({ format: 'pce-bookmarklet-backup', version: 1, origin: location.origin, exportedAt: new Date().toISOString(), captures: captures.result, settings });
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('백업 조회 실패'));
    });
  } finally { db.close(); }
}

export function parsePrototypeBackup(value: unknown): PrototypeBackup {
  if (!object(value) || value.format !== 'pce-bookmarklet-backup' || value.version !== 1 || typeof value.origin !== 'string' || typeof value.exportedAt !== 'string' || !Array.isArray(value.captures) || !Array.isArray(value.settings)) fail('지원하는 북마크릿 전체 백업(version 1)이 아닙니다.');
  value.captures.forEach(validateCapture);
  if (new Set(value.captures.map(capture => capture.captureId)).size !== value.captures.length) fail('백업 안에 같은 이벤트 ID가 반복됩니다.');
  const keys = new Set<string>();
  for (const entry of value.settings) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || keys.has(entry[0])) fail('설정 키가 잘못되었거나 반복됩니다.');
    keys.add(entry[0]);
    const [key, setting] = entry;
    if (key === 'collectionPolicy') parseCollectionPolicy(setting);
    if (key === 'keyLabels' && (!object(setting) || Object.values(setting).some(label => typeof label !== 'string'))) fail('키 사전 형식을 확인하세요.');
    if (key.startsWith(prefix)) {
      if (!object(setting) || !namespaces.includes(setting.namespace as PrototypeNamespace) || typeof setting.documentId !== 'string' || documentKey(setting.namespace as PrototypeNamespace, setting.documentId) !== key || !Number.isSafeInteger(setting.storeVersion) || Number(setting.storeVersion) < 1 || !object(setting.value)) fail('프로토타입 문서 형식이 잘못되었습니다.');
      validatePrototypeValue(setting.namespace as PrototypeNamespace, setting.value);
    }
  }
  const hwpxEntries=(value.settings as [string,unknown][]).filter(([key])=>key.startsWith(prefix+'hwpx-templates:')).map(([,entry])=>entry as LocalDocument<HwpxTemplate>);
  for(const entry of hwpxEntries){const resolved=resolveHwpxTemplate(entry.documentId,hwpxEntries);if(typeof DOMParser!=='undefined')validateResolvedHwpxTemplate(resolved.template);}
  return value as unknown as PrototypeBackup;
}

export function validatePrototypeValue(namespace: PrototypeNamespace, value: Record<string, unknown>): void {
  if (namespace === 'datasets') {
    if (typeof value.name !== 'string' || !value.name.trim() || !['reference', 'collected'].includes(String(value.category)) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) fail('자료집 형식이 잘못되었습니다.');
    const fields = value.columns.map(column => {
      if (!object(column) || typeof column.field !== 'string' || !column.field || column.field.startsWith('__') || ['__proto__', 'constructor', 'prototype'].includes(column.field) || typeof column.label !== 'string' || !['text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'code', 'json'].includes(String(column.kind))) fail('자료집 열 형식이 잘못되었습니다.');
      return column.field;
    });
    if (!fields.length || new Set(fields).size !== fields.length) fail('열이 없거나 같은 열이 반복됩니다.');
    if (value.rows.some(row => !object(row) || typeof row.__rowId !== 'string' || !row.__rowId || !Number.isSafeInteger(row.__storeVersion) || Number(row.__storeVersion) < 1)) fail('자료집 행 형식이 잘못되었습니다.');
    if (new Set(value.rows.map(row => (row as Record<string, unknown>).__rowId)).size !== value.rows.length) fail('행 식별자가 반복됩니다.');
  } else if (namespace === 'notes') {
    if (typeof value.title !== 'string' || !value.title.trim() || typeof value.body !== 'string' || !['memo', 'schedule'].includes(String(value.kind)) || !['general', 'screen', 'record'].includes(String(value.scope)) || typeof value.done !== 'boolean') fail('메모·일정 형식이 잘못되었습니다.');
    if (value.scope === 'screen' && typeof value.screenUrl !== 'string') fail('화면 연결이 필요합니다.');
    if (value.scope === 'record' && (typeof value.datasetId !== 'string' || typeof value.rowId !== 'string')) fail('레코드 연결이 필요합니다.');
    if (value.kind === 'schedule' && (typeof value.startsOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.startsOn) || typeof value.endsOn !== 'string' || String(value.endsOn) < value.startsOn)) fail('일정 시작·종료 날짜를 확인하세요.');
  } else if (namespace === 'launchers') {
    if (typeof value.name !== 'string' || !value.name.trim() || !['url', 'script'].includes(String(value.kind)) || typeof value.target !== 'string' || !value.target.trim()) fail('런처 형식이 잘못되었습니다.');
    if (value.kind === 'url') { let url: URL; try { url = new URL(value.target); } catch { fail('올바른 URL을 입력하세요.'); } if (!['http:', 'https:'].includes(url!.protocol)) fail('웹 바로가기는 http/https URL을 사용하세요.'); }
  } else if (namespace === 'templates') {
    if (typeof value.name !== 'string' || !value.name.trim() || typeof value.body !== 'string') fail('텍스트 템플릿 형식이 잘못되었습니다.');
    if (value.program !== undefined) validateTemplateProgram(value.program as Parameters<typeof validateTemplateProgram>[0]);
  } else if (namespace === 'relations') {
    if (typeof value.name !== 'string' || typeof value.leftSourceId !== 'string' || typeof value.rightSourceId !== 'string' || !['one', 'many'].includes(String(value.cardinality)) || !Array.isArray(value.fieldPairs) || !value.fieldPairs.length || value.fieldPairs.some(pair => !object(pair) || typeof pair.left !== 'string' || typeof pair.right !== 'string')) fail('관계 형식이 잘못되었습니다.');
  } else if(namespace==='hwpx-templates') {
    validateHwpxTemplate(value as unknown as HwpxTemplate);
  }
}

export async function restorePrototypeBackup(backup: PrototypeBackup, expectedTarget: PrototypeBackup): Promise<void> {
  parsePrototypeBackup(backup); parsePrototypeBackup(expectedTarget);
  const db = await openOutbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['captures', 'settings'], 'readwrite');
      const store = tx.objectStore('settings'), captureStore = tx.objectStore('captures');
      const previous = captureStore.getAll(), settings: [string, unknown][] = [];
      const cursor = store.openCursor(); let completed = 0, conflict = false;
      const fingerprint = (captures: TransferCapture[], entries: [string, unknown][]) => canonicalJson({ captures: [...captures].sort((a,b)=>a.captureId.localeCompare(b.captureId)), settings: [...entries].sort((a,b)=>a[0].localeCompare(b[0])) });
      const commit = () => {
        if (++completed !== 2) return;
        if (fingerprint(previous.result, settings) !== fingerprint(expectedTarget.captures, expectedTarget.settings)) { conflict = true; tx.abort(); return; }
        const documentVersions = [...settings, ...backup.settings].map(([,value])=>object(value)?Number(value.storeVersion)||0:0);
        const previousSequence = Number(settings.find(([key])=>key==='prototype.storeSequence')?.[1])||0;
        const incomingSequence = Number(backup.settings.find(([key])=>key==='prototype.storeSequence')?.[1])||0;
        const sequence = Math.max(previousSequence, incomingSequence, ...documentVersions, 0) + 1;
        captureStore.clear(); store.clear();
        for (const capture of backup.captures) captureStore.add(capture);
        for (const [key, value] of backup.settings) store.put(key.startsWith(prefix) && object(value) ? { ...value, storeVersion: sequence } : value, key);
        store.put(sequence,'prototype.storeSequence');
      };
      previous.onsuccess = commit;
      cursor.onsuccess = () => { const entry = cursor.result; if(entry){ settings.push([String(entry.key),entry.value]);entry.continue(); } else commit(); };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error(conflict ? '복원 미리보기 이후 보관함이 변경되었습니다. 백업 파일을 다시 열어 비교하세요. 전체 복원을 중단했습니다.' : '복원 실패. 기존 보관함은 유지됩니다. ' + (tx.error?.message ?? '')));
    });
  } finally { db.close(); }
}

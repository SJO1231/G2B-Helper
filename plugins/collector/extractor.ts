import type { CapturePayload } from '../../packages/contracts/src/index';

export interface FrameCapture {
  framePath: string;
  url: string;
  pointInfo: Record<string, unknown>;
  tables: Record<string, Record<string, unknown>[]>;
  tableSources?: Record<string, { componentId: string; originalId: string }>;
  fieldSources: Record<string, { componentId: string; ref: string }>;
  warnings: string[];
}
export interface PageCapture extends CapturePayload { frames: FrameCapture[]; warnings: string[]; }

/** Serialized by chrome.scripting: all runtime dependencies must remain inside this function. */
export function collectPage(recurse = true, suppliedWindow?: Window): PageCapture {
  const root = suppliedWindow || window;
  const frames: FrameCapture[] = [];
  const warnings: string[] = [];
  const pointInfo: Record<string, unknown> = Object.create(null);
  const tables: Record<string, Record<string, unknown>[]> = Object.create(null);
  function unique(target: Record<string, unknown>, proposed: string): string {
    let name = proposed || 'unnamed';
    let count = 2;
    while (Object.prototype.hasOwnProperty.call(target, name)) name = (proposed || 'unnamed') + '#' + count++;
    return name;
  }
  function clone(value: unknown): unknown {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value, (_key, entry: unknown) => typeof entry === 'bigint' ? String(entry) : entry));
  }
  function scan(win: Window, framePath: string): void {
    const frame: FrameCapture = { framePath, url: '', pointInfo: Object.create(null), tables: Object.create(null), fieldSources: Object.create(null), tableSources: Object.create(null), warnings: [] };
    frames.push(frame);
    try {
      frame.url = win.location.href;
      const webSquare = (win as Window & { WebSquare?: { util?: { getComponentById(id: string): any } } }).WebSquare;
      const util = webSquare?.util;
      const seen = new Set<string>();
      if (util) win.document.querySelectorAll('[id]').forEach(element => {
        if (seen.has(element.id)) return;
        seen.add(element.id);
        try {
          const component = util.getComponentById(element.id);
          if (!component) return;
          const plugin = typeof component.getPluginName === 'function' ? component.getPluginName() : '';
          if (plugin === 'gridView') {
            const listRef = component.getDataList?.();
            const list = typeof listRef === 'string' ? util.getComponentById(listRef) : listRef;
            if (typeof list?.getAllJSON !== 'function') {
              frame.warnings.push(element.id + ': 연결된 DataList를 읽을 수 없습니다.');
              return;
            }
            let source = list.getAllJSON();
            if (typeof source === 'string') source = JSON.parse(source);
            if (!Array.isArray(source)) throw new Error('getAllJSON 결과가 배열이 아닙니다.');
            let originalId='';
            try{originalId=String(component.getOriginalID?.()||'').trim();}catch(error){frame.warnings.push(element.id+': 원래 Dataset ID를 읽지 못했습니다.');}
            const componentId=String(component.id||element.id);
            const key = unique(frame.tables, originalId||componentId);
            frame.tableSources![key]={componentId,originalId:originalId||componentId};
            frame.tables[key] = source.map((row: unknown) => {
              const copied = clone(row);
              return copied !== null && typeof copied === 'object' && !Array.isArray(copied) ? copied as Record<string, unknown> : { value: copied };
            });
          } else if (typeof component.getValue === 'function') {
            const ref = String(component.getRef?.() ?? '');
            const tail = ref.split('.').pop()?.trim();
            const key = unique(frame.pointInfo, tail || element.id);
            frame.pointInfo[key] = clone(component.getValue());
            frame.fieldSources[key] = { componentId: element.id, ref };
          }
        } catch (error) {
          frame.warnings.push(element.id + ': ' + (error instanceof Error ? error.message : String(error)));
        }
      });
      else frame.warnings.push('이 frame에서 WebSquare를 찾지 못했습니다.');
      for (const [key, value] of Object.entries(frame.pointInfo)) pointInfo[unique(pointInfo, key in pointInfo ? framePath + '::' + key : key)] = value;
      for (const [key, value] of Object.entries(frame.tables)) tables[unique(tables, key in tables ? framePath + '::' + key : key)] = value;
      if (recurse) for (let index = 0; index < win.frames.length; index++) scan(win.frames[index], framePath + '/' + index);
    } catch (error) {
      frame.warnings.push('frame 접근 실패: ' + (error instanceof Error ? error.message : String(error)));
    }
    warnings.push(...frame.warnings.map(warning => '[' + framePath + '] ' + warning));
  }
  scan(root, 'top');
  return { pointInfo, tables, frames, warnings };
}

export function mergeFrameCaptures(results: { frameId: number; result?: PageCapture }[]): PageCapture {
  const merged: PageCapture = { pointInfo: {}, tables: {}, frames: [], warnings: [] };
  for (const injection of [...results].sort((a, b) => a.frameId - b.frameId)) {
    if (!injection.result) { merged.warnings.push('frame ' + injection.frameId + ': 결과 없음'); continue; }
    const source = injection.result;
    for (const frame of source.frames) merged.frames.push({ ...frame, framePath: 'frame:' + injection.frameId + '/' + frame.framePath });
    merged.warnings.push(...source.warnings.map(warning => 'frame:' + injection.frameId + ' ' + warning));
    for (const [key, value] of Object.entries(source.pointInfo)) Object.defineProperty(merged.pointInfo, Object.hasOwn(merged.pointInfo, key) ? 'frame:' + injection.frameId + '::' + key : key, { value, enumerable: true, configurable: true });
    for (const [key, value] of Object.entries(source.tables)) Object.defineProperty(merged.tables, Object.hasOwn(merged.tables, key) ? 'frame:' + injection.frameId + '::' + key : key, { value, enumerable: true, configurable: true });
  }
  return merged;
}


import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import tabulatorCss from 'tabulator-tables/dist/css/tabulator.min.css';
import { prototypeTheme } from './theme';
import type { BookmarkletPlugin, PrototypeDataset, PrototypeSelection, PrototypeServices } from './contracts';
import { listDocuments } from './storage';
import { workPlugin } from './plugins/Work';
import { tablesPlugin } from './plugins/Tables';
import { notesPlugin } from './plugins/Notes';
import { launcherPlugin } from './plugins/Launcher';
import { templatesPlugin } from './plugins/Templates';
import { settingsPlugin } from './plugins/Settings';
import { relationsPlugin } from './plugins/Relations';
import { hwpxPlugin } from './plugins/Hwpx';

const plugins: [string, BookmarkletPlugin][] = [['work', workPlugin], ['tables', tablesPlugin], ['notes', notesPlugin], ['launcher', launcherPlugin], ['relations', relationsPlugin], ['templates', templatesPlugin], ['hwpx', hwpxPlugin], ['settings', settingsPlugin]];
export async function bootPrototype(panelId: string): Promise<void> {
  const host = document.createElement('div'); host.id = panelId; host.setAttribute('data-pce-version', 'prototype-1');
  document.documentElement.append(host); const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('style'); stylesheet.textContent = String(tabulatorCss) + '\n' + prototypeTheme; shadow.append(stylesheet);
  const container = document.createElement('div'); shadow.append(container); const root = createRoot(container);
  const close = async () => {
    const check = new Event('pce:close-check', { cancelable: true }); window.dispatchEvent(check);
    if (check.defaultPrevented && !confirm('저장하지 않은 변경이 있습니다. 변경을 버리고 PCE를 닫을까요?')) return;
    const pending: Promise<void>[] = []; window.dispatchEvent(new CustomEvent('pce:closing', { detail: pending })); await Promise.allSettled(pending); root.unmount(); host.remove();
  };
  root.render(<PrototypeShell close={close} />);
}
function PrototypeShell({ close }: { close(): Promise<void> }) {
  const [tab, setTab] = useState('work'), [visited, setVisited] = useState(new Set(['work']));
  const [selection, setSelection] = useState<PrototypeSelection | null>(null);
  const [message, setMessage] = useState('브라우저 올인원 프로토타입 · 현재 사이트의 IndexedDB에 저장합니다. 자동 수집은 꺼져 있습니다.'), [restored, setRestored] = useState(false), [closing, setClosing] = useState(false);
  function navigate(next: string) { if (!plugins.some(([id]) => id === next)) return; setTab(next); setVisited(previous => new Set([...previous, next])); requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); }
  const services: PrototypeServices = { notify: setMessage, selection, select: setSelection, navigate, datasets: () => listDocuments<PrototypeDataset>('datasets') };
  useEffect(() => { const listener = () => setRestored(true); window.addEventListener('pce:backup-restored', listener); return () => window.removeEventListener('pce:backup-restored', listener); }, []);
  return <section className="shell" role="dialog" aria-label="PCE 올인원 프로토타입"><header className="shell-header"><div className="brand">PCE<small>PERSONAL WORKSPACE</small></div><div className="shell-title"><strong>업무를 모으고, 표로 다루고, 다시 쓰세요.</strong><small>북마크릿 프로토타입 · {location.origin} · {selection ? `선택: ${selection.datasetName}` : '사이트별 로컬 보관'}</small></div><button disabled={closing} onClick={async () => { setClosing(true); try { await close(); } finally { setClosing(false); } }}>닫기</button></header><nav className="shell-nav" aria-label="주 메뉴">{plugins.slice(0, 4).map(([id, plugin]) => <button aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} key={id} onClick={() => navigate(id)}>{plugin.label}</button>)}<div className="nav-extra">{plugins.slice(4).map(([id, plugin]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => navigate(id)}>{plugin.label}</button>)}</div></nav><main className="plugin-area">{restored && <div className="restore-message">전체 복원을 완료했습니다. 최신 자료를 읽으려면 닫기 버튼을 누른 뒤 북마크릿을 다시 실행하세요.</div>}<div className={restored ? 'paused' : ''} style={{ height: '100%' }}>{plugins.map(([id, plugin]) => { const Component = plugin.component; return <div className="plugin-pane" data-plugin={plugin.id} key={id} hidden={tab !== id}>{visited.has(id) && <Component services={services} />}</div>; })}</div></main><footer className="shell-notice" aria-live="polite" data-testid="prototype-status">{message}</footer></section>;
}

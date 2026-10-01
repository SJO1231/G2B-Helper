import { bootPrototype } from './shell';
const panelId = 'pce-bookmarklet-panel';
const existing = document.getElementById(panelId);
if (existing) { existing.style.display = 'block'; existing.scrollIntoView(); }
else void bootPrototype(panelId).catch(error => { document.getElementById(panelId)?.remove(); alert('PCE를 열지 못했습니다: ' + (error instanceof Error ? error.message : String(error))); });

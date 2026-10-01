import { collectPage } from '../../plugins/collector/extractor';
import { CollectionLoop, createCapture, createBundle } from '../../plugins/collector/transfer';
import { presentCapture, defaultExtractionOptions, type ExtractionMode } from '../../plugins/collector/presentation';
import { listCaptures, saveCapture, readSetting, writeSetting } from './outbox';
import { approvedScreenProfiles, defaultCollectionPolicy, evaluateCollectionScope, parseCollectionPolicy } from '../../plugins/collector/scope';
import type { CapturePayload, CollectionPolicy, TransferCapture } from '../../packages/contracts/src/index';
import { utils, writeFile } from 'xlsx';
import type { CollectorPanelHandle, CollectorPanelOptions } from './contracts';
import { parseRawCapture } from './storage';

export async function mountCollectorPanel(container: HTMLElement, configuration: CollectorPanelOptions = {}): Promise<CollectorPanelHandle> {
  const host = document.createElement('div');
  host.id = 'pce-collector-plugin';
  container.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
  :host{all:initial;display:block;height:100%;font:14px system-ui,sans-serif;color:#19324a}
  *{box-sizing:border-box}section{height:100%;background:#f8fafc;border:1px solid #9aafc2;box-shadow:0 16px 64px #001b4060;border-radius:14px;display:flex;flex-direction:column;padding:18px;gap:12px}
  header,.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}header strong{font-size:19px;margin-right:auto}button,select,input,textarea{font:inherit;padding:7px;border:1px solid #abbacb;border-radius:5px;background:white;color:#19324a}
  button{cursor:pointer}button:hover{background:#e5f1ff}button:disabled{opacity:.5}input[type=checkbox]{width:16px;height:16px}label{display:inline-flex;align-items:center;gap:4px}
  #status{background:#e8f1fa;padding:9px;white-space:pre-wrap}#content{overflow:auto;flex:1;min-height:120px}table{border-collapse:collapse;width:100%;background:white;margin-bottom:16px}th,td{text-align:left;border:1px solid #cbd5e1;padding:6px;max-width:330px;overflow-wrap:anywhere;white-space:pre-wrap}th{position:sticky;top:0;background:#dce9f6}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{border:1px solid #cbd5e1;padding:8px;border-radius:6px}textarea{width:100%;min-height:90px}#saved{max-height:140px;overflow:auto}small{color:#486178}h3{font-size:15px}
  </style><section role="dialog" aria-label="PCE 북마크릿">
  <header><strong>PCE · 임시 추출과 로컬 보관함</strong><span>업무 플러그인 · 현재 로딩 자료</span></header>
  <small id="origin"></small>
  <div class="bar"><button id="extract">임시 추출</button><button id="capture">1회 수집·보관</button><button id="start">자동 수집 시작</button><button id="stop" disabled>정지</button><button id="save" disabled>임시 추출 결과를 별도 보관</button></div>
  <div class="bar"><select id="mode" aria-label="추출 보기"><option value="mappedTables">한글 매핑 · 표만</option><option value="mappedAll">한글 매핑 · 전체</option><option value="allTables">모든 표</option><option value="all">모든 자료</option></select><label><input id="emptyTables" type="checkbox" checked>빈 표 숨김</label><label><input id="emptyRows" type="checkbox" checked>빈 행 숨김</label><label><input id="emptyColumns" type="checkbox" checked>빈 열 숨김</label></div>
  <details><summary>키 사전 · 템플릿 참조</summary><small>원천 키와 한글 표시명 JSON. 사전이 없으면 기본 보기에는 표가 없습니다. 원본은 유지됩니다.</small><textarea id="dictionary" aria-label="키 사전">{"ctrtDmndRcptNo":"접수번호","ctrtDmndRcptOrd":"접수차수","bidPbancNo":"공고번호","bidPbancOrd":"공고차수","ctrtNo":"계약번호","ctrtChgOrd":"계약차수"}</textarea><div class="bar"><button id="dictionarySave">사전 저장</button><input id="dictionaryFile" type="file" accept=".json"><label>템플릿 ID <input id="template" placeholder="선택 사항 · 데스크탑에서 실행"></label></div></details>
  <details><summary>이 사이트의 수집 정책 · 지정 화면</summary><small id="policyStatus"></small><p>기본 지정 화면: 접수 01001/01114·01117, 공고 01173/01174, 계약 01570/01571. 각 frame의 번호와 차수가 완전하고 일치해야 수집합니다. 요청 01108·01118과 미지정 화면은 임시 추출을 사용하거나 데스크탑에서 수집 규칙을 설정하세요.</p><textarea id="policy" aria-label="수집 정책 JSON"></textarea><div class="bar"><input id="policyFile" type="file" accept=".json" aria-label="데스크탑 수집 정책 JSON"><button id="policySave">정책 검증·저장</button><button id="policyDefault">기본 지정 화면 사용</button></div><small>데스크탑 설정의 수집 정책 JSON을 가져옵니다. 저장한 규칙 목록은 기본 지정 화면을 대체하며 빈 목록은 수집을 허용하지 않습니다. 임시 추출 결과의 별도 보관은 수집 이벤트와 구분됩니다.</small></details>
  <details><summary>이 사이트의 보관함 · JSON 전달</summary><div class="bar"><button id="refresh">목록 새로고침</button><button id="export">선택한 수집 JSON 내보내기</button></div><div id="saved"></div><small>내보내기는 자료를 삭제하지 않습니다. 데스크탑 가져오기·반영 완료와 다릅니다.</small></details>
  <div class="bar"><select id="scope"><option value="display">현재 표시 결과 출력</option><option value="all">전체 원본 표 출력</option></select><button id="csv">CSV</button><button id="xlsx">XLSX</button><button id="raw">원본 JSON</button><button id="toDataset">표를 DB 자료집으로</button><label>이전 추출 열기<input id="rawFile" aria-label="원본 추출 파일" type="file" accept=".json,.txt"></label></div>
  <div id="status" role="status">현재 로딩된 WebSquare 자료만 읽습니다. 자동 수집은 꺼져 있습니다.</div><div id="content"></div>
  </section>`;
  const find = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;
  const status = (message: string) => { find('status').textContent = message; };
  const run = (work: () => Promise<void> | void) => { void Promise.resolve().then(work).catch(error => status('실패: ' + (error instanceof Error ? error.message : String(error)))); };
  find('origin').textContent = '보관 출처: ' + location.origin + ' · 다른 사이트의 보관함과 구분됩니다.';
  let payload: CapturePayload | undefined;
  let saved: TransferCapture[] = [];
  let labels: Record<string, string> = JSON.parse(find<HTMLTextAreaElement>('dictionary').value);
  let policy:CollectionPolicy=defaultCollectionPolicy;
  let explicitExtraction=false;
  let policyReady=false,initializing=true,closed=false,automaticGeneration=0;
  let starting:Promise<void>|undefined;
  find<HTMLButtonElement>('capture').disabled=true;
  find<HTMLButtonElement>('start').disabled=true;
  ['policySave','policyDefault','policyFile'].forEach(id=>{(find(id) as HTMLButtonElement).disabled=true;});
  function showPolicy(){
    find<HTMLTextAreaElement>('policy').value=JSON.stringify(policy,null,2);
    find('policyStatus').textContent=policy.rules===null?'기본 지정 화면 '+approvedScreenProfiles.length+'종 · 정책 버전 '+policy.storeVersion:'사용자 수집 규칙 '+policy.rules.filter(rule=>rule.enabled!==false).length+'개 · 정책 버전 '+policy.storeVersion;
  }
  function dictionaryValue(text: string): Record<string, string> {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('키 사전은 {"원천키":"표시명"} 형식이어야 합니다.');
    return parsed as Record<string,string>;
  }
  const options = () => ({ ...defaultExtractionOptions, mode: find<HTMLSelectElement>('mode').value as ExtractionMode, hideEmptyTables: find<HTMLInputElement>('emptyTables').checked, hideEmptyRows: find<HTMLInputElement>('emptyRows').checked, hideEmptyColumns: find<HTMLInputElement>('emptyColumns').checked });
  function render() {
    const content = find('content'); content.replaceChildren();
    if (!payload) return;
    const view = presentCapture(payload, labels, options());
    if (!view.tables.length && !Object.keys(view.pointInfo).length) {
      const notice = document.createElement('p'); notice.textContent = '현재 표시 조건에 맞는 자료가 없습니다. 키 사전이나 보기 모드를 확인하세요.'; content.append(notice);
    }
    for (const table of view.tables) {
      const title = document.createElement('h3'); title.textContent = table.source + ' · ' + table.rows.length + '행' + (table.rows.length > 500 ? ' (화면은 앞 500행, 출력은 전체)' : ''); content.append(title);
      const grid = document.createElement('table'); const head = document.createElement('thead'); const tr = document.createElement('tr');
      table.columns.forEach(key => { const cell = document.createElement('th'); cell.textContent = labels[key] || key; cell.title = key; tr.append(cell); }); head.append(tr); grid.append(head);
      const body = document.createElement('tbody');
      table.rows.slice(0,500).forEach(row => { const line = document.createElement('tr'); table.columns.forEach(key => { const cell = document.createElement('td'); cell.textContent = typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key] ?? ''); line.append(cell); }); body.append(line); });
      grid.append(body); content.append(grid);
    }
    if (Object.keys(view.pointInfo).length) { const pre = document.createElement('pre'); pre.textContent = JSON.stringify(view.pointInfo, null, 2); content.append(pre); }
    if (payload.warnings?.length) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '부분 수집·읽기 경고 ' + payload.warnings.length + '건'; const pre = document.createElement('pre'); pre.textContent = payload.warnings.join('\n'); details.append(summary,pre); content.append(details); }
    find<HTMLButtonElement>('save').disabled = !explicitExtraction;
  }
  async function refresh() {
    saved = await listCaptures(); const list = find('saved'); list.replaceChildren();
    for (const capture of saved) {
      const line = document.createElement('div'); const label = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = capture.captureId; checkbox.checked = true;
      label.append(checkbox,document.createTextNode(capture.capturedAt + ' · '+(capture.purpose==='extraction-save'?'별도 추출 보관':'수집')+' · ' + Object.keys(capture.payload.tables).length + '개 표')); line.append(label);
      const show = document.createElement('button'); show.textContent = '열기'; show.onclick = () => { payload = capture.payload; explicitExtraction=false; render(); status('보관 자료를 열었습니다.'); }; line.append(show); list.append(line);
    }
    if (!saved.length) list.textContent = '보관된 수집이 없습니다.';
  }
  async function persist(purpose:NonNullable<TransferCapture['purpose']>) {
    if (!payload) throw new Error('먼저 추출하세요.');
    if(purpose==='extraction-save'&&!explicitExtraction)throw new Error('먼저 임시 추출을 실행하세요. 별도 추출 보관은 수집과 구분됩니다.');
    const result = await saveCapture(createCapture(payload, location.origin, find<HTMLInputElement>('template').value.trim() || undefined,purpose));
    await refresh();
    status(result.duplicate ? '같은 이벤트가 이미 보관되어 있습니다. 기존 이벤트를 유지했습니다.' : (purpose==='collection'?'지정 화면 수집':'사용자가 저장한 별도 임시 추출')+' · IndexedDB 보관 완료 · 데스크탑에는 아직 반영되지 않았습니다.');
  }
  async function capture() {
    if(!policyReady||closed)throw new Error('수집 정책을 아직 읽지 못했습니다. 정책을 확인한 뒤 다시 시도하세요.');
    const current=collectPage();
    const scope=evaluateCollectionScope(current,policy);
    if(!scope.allowed)throw new Error(scope.reason+(current.warnings.length?' 읽기 경고: '+current.warnings.join(' '):'')+' 임시 추출 또는 수집 규칙 설정을 사용하세요.');
    payload=scope.filteredPayload!;explicitExtraction=false;render();await persist('collection');
  }
  const stoppedControls=()=>{if(closed)return;find<HTMLButtonElement>('start').disabled=!policyReady;find<HTMLButtonElement>('stop').disabled=true;};
  const loop = new CollectionLoop(capture, error => {++automaticGeneration;void loop.stop().finally(stoppedControls);status('자동 수집 중단: '+(error instanceof Error?error.message:String(error))); });
  find('extract').onclick = () => run(async () => { await stopAutomatic();stoppedControls();payload = collectPage();explicitExtraction=true; render(); status('임시 추출 완료 · 아직 보관하지 않았습니다. 별도 보관을 누르면 수집과 구분하여 저장합니다.'); });
  find('capture').onclick = () => run(capture);
  find('save').onclick = () => run(()=>persist('extraction-save'));
  find('start').onclick = () => run(async()=>{
    const generation=++automaticGeneration;
    find<HTMLButtonElement>('start').disabled=true;find<HTMLButtonElement>('stop').disabled=false;
    const pending=capture();starting=pending;
    try{await pending;if(closed||generation!==automaticGeneration)return;loop.start(true);status('자동 수집 중 · 5초마다 지정 화면과 업무 식별을 다시 확인합니다.');}
    catch(error){if(generation===automaticGeneration){stoppedControls();throw error;}}
    finally{if(starting===pending)starting=undefined;}
  });
  async function stopAutomatic(){++automaticGeneration;await loop.stop();await starting?.catch(()=>{});}
  find('stop').onclick = () => run(async () => { try { await stopAutomatic(); } finally { stoppedControls();status('자동 수집을 정지했습니다.'); } });
  ['mode','emptyTables','emptyRows','emptyColumns'].forEach(id => { find(id).onchange = render; });
  find('dictionarySave').onclick = () => run(async () => { const next = dictionaryValue(find<HTMLTextAreaElement>('dictionary').value); await writeSetting('keyLabels', next); labels = next; render(); status('이 사이트의 키 사전을 저장했습니다.'); });
  async function savePolicy(next:CollectionPolicy){if(initializing)throw new Error('저장된 정책을 읽은 뒤 변경하세요.');await stopAutomatic();await writeSetting('collectionPolicy',next);policy=next;policyReady=true;find<HTMLButtonElement>('capture').disabled=false;stoppedControls();showPolicy();status('이 사이트의 수집 정책을 저장했습니다. 자동 수집은 정지했습니다.');}
  find('policySave').onclick=()=>run(()=>savePolicy(parseCollectionPolicy(JSON.parse(find<HTMLTextAreaElement>('policy').value))));
  find('policyDefault').onclick=()=>run(()=>savePolicy(defaultCollectionPolicy));
  find<HTMLInputElement>('policyFile').onchange=()=>run(async()=>{const file=find<HTMLInputElement>('policyFile').files?.[0];if(file){const next=parseCollectionPolicy(JSON.parse(await file.text()));find<HTMLTextAreaElement>('policy').value=JSON.stringify(next,null,2);status('수집 정책을 읽었습니다. 정책 검증·저장을 누르면 이 사이트에 적용됩니다.');}});
  find<HTMLInputElement>('dictionaryFile').onchange = () => run(async () => { const file = find<HTMLInputElement>('dictionaryFile').files?.[0]; if (file) { const next = dictionaryValue(await file.text()); find<HTMLTextAreaElement>('dictionary').value = JSON.stringify(next,null,2); status('사전을 읽었습니다. 사전 저장을 누르면 적용됩니다.'); } });
  find('refresh').onclick = () => run(refresh);
  function download(contents: BlobPart, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([contents], { type })); const link = document.createElement('a'); link.href=url; link.download=filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  find('export').onclick = () => run(() => {
    const selected = new Set([...find('saved').querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value));
    const captures = saved.filter(capture => selected.has(capture.captureId)); if (!captures.length) throw new Error('내보낼 수집을 선택하세요.');
    download(JSON.stringify(createBundle(captures, location.origin, { keyLabels: labels,collectionPolicy:policy }),null,2), 'pce-transfer-' + Date.now() + '.json', 'application/json');
    status('JSON 다운로드를 요청했습니다. 보관 자료는 그대로이며, 데스크탑 가져오기에서 반영하세요.');
  });
  find('raw').onclick = () => run(() => { if (!payload) throw new Error('먼저 추출하세요.'); download(JSON.stringify(payload,null,2),'pce-raw-' + Date.now() + '.json','application/json'); });
  find<HTMLInputElement>('rawFile').onchange = () => run(async () => {
    const file = find<HTMLInputElement>('rawFile').files?.[0]; if (!file) return;
    if (file.size > 50 * 1024 * 1024) throw new Error('프로토타입은 50MB 이하 파일을 사용하세요.');
    const contents = parseRawCapture(JSON.parse(await file.text()));
    await stopAutomatic();stoppedControls();
    payload = structuredClone(contents); explicitExtraction = true; render();
    status('파일 원본을 임시 추출로 열었습니다. 현재 화면의 1회 수집과 구분됩니다. 아직 보관하지 않았습니다.');
  });
  function outputTables() {
    if (!payload) throw new Error('먼저 추출하세요.');
    return presentCapture(payload, labels, find<HTMLSelectElement>('scope').value === 'all' ? { mode:'all',hideEmptyColumns:false,hideEmptyRows:false,hideEmptyTables:false } : options()).tables;
  }
  const stringifyCell = (value: unknown) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  find('csv').onclick = () => run(() => {
    const tables = outputTables(); if (!tables.length) throw new Error('출력할 표가 없습니다.');
    for (const table of tables) {
      const escaped = (value: unknown) => '"' + stringifyCell(value).replaceAll('"','""') + '"';
      const csv = [table.columns.map(key => escaped(labels[key] || key)).join(','), ...table.rows.map(row => table.columns.map(key => escaped(row[key])).join(','))].join('\r\n');
      download('\uFEFF' + csv, table.source.replace(/[^\w가-힣.-]/g,'_') + '.csv', 'text/csv;charset=utf-8');
    }
    status('표별 CSV 다운로드를 요청했습니다. 브라우저가 여러 파일 다운로드 허용을 요청할 수 있습니다.');
  });
  find('xlsx').onclick = () => run(() => {
    const tables = outputTables(); if (!tables.length) throw new Error('출력할 표가 없습니다.');
    const book = utils.book_new();
    tables.forEach((table,index) => {
      const rows = [table.columns.map(key => labels[key] || key), ...table.rows.map(row => table.columns.map(key => typeof row[key] === 'object' ? stringifyCell(row[key]) : row[key] ?? ''))];
      utils.book_append_sheet(book, utils.aoa_to_sheet(rows), (String(index+1) + '_' + table.source).replace(/[\\/?*\[\]:]/g,'_').slice(0,31));
    });
    writeFile(book,'pce-extract-' + Date.now() + '.xlsx');
  });
  const leavePage = () => { closed=true;void stopAutomatic(); };
  window.addEventListener('pagehide', leavePage, { once:true });
  find('toDataset').onclick = () => run(async () => {
    const tables = outputTables(); if (!tables.length) throw new Error('먼저 임시 추출하고 보기 조건을 확인하세요.');
    const chosen = prompt('DB에 저장할 표 이름을 입력하세요.\n' + tables.map(table => table.source).join('\n'), tables[0].source);
    if (!chosen) return; const table = tables.find(table => table.source === chosen);
    if (!table) throw new Error('표 이름을 정확히 입력하세요.');
    await configuration.onDataset?.(table.source, table.rows);
    status('사용자가 선택한 표를 독립 자료집으로 저장했습니다. 수집 원본은 유지됩니다.');
  });
  const capturesChanged = () => run(refresh);window.addEventListener('pce:captures-changed',capturesChanged);
  showPolicy();
  try { policy=parseCollectionPolicy(await readSetting('collectionPolicy',defaultCollectionPolicy));policyReady=true;showPolicy();find<HTMLButtonElement>('capture').disabled=false;stoppedControls();labels = await readSetting('keyLabels',labels);find<HTMLTextAreaElement>('dictionary').value = JSON.stringify(labels,null,2);await refresh(); }
  catch (error) { status('보관함을 열지 못했습니다. 임시 추출은 가능하지만 저장 완료가 아닙니다. ' + String(error)); }
  finally{initializing=false;['policySave','policyDefault','policyFile'].forEach(id=>{(find(id) as HTMLButtonElement).disabled=false;});}
  return { pause:async()=>{await stopAutomatic();stoppedControls();},close: async () => { closed=true;await stopAutomatic();window.removeEventListener('pagehide',leavePage);window.removeEventListener('pce:captures-changed',capturesChanged);host.remove(); } };
}

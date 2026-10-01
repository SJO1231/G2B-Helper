import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
await mkdir('dist/extension',{recursive:true});
await mkdir('dist/bookmarklet',{recursive:true});
await build({entryPoints:['apps/extension/background.ts'],outfile:'dist/extension/background.js',bundle:true,format:'esm',target:'chrome138',platform:'browser',minify:true});
await copyFile('apps/extension/manifest.json','dist/extension/manifest.json');
const output=await build({entryPoints:['apps/bookmarklet/main.ts'],bundle:true,format:'iife',target:'es2022',platform:'browser',minify:true,write:false,loader:{'.css':'text'}});
const javascript=output.outputFiles[0].text;
const bookmarklet='javascript:'+encodeURIComponent(javascript);
await writeFile('dist/bookmarklet/pce-bookmarklet.txt',bookmarklet,'utf8');
await writeFile('dist/bookmarklet/pce-bookmarklet.js',javascript,'utf8');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
await writeFile('dist/bookmarklet/install.html',`<!doctype html><html lang="ko"><meta charset="utf-8"><title>PCE 북마크릿 설치</title><style>body{font:16px system-ui;max-width:760px;margin:60px auto;line-height:1.7;color:#17324d}a{display:inline-block;background:#1760a5;color:white;padding:12px 22px;border-radius:8px}</style><h1>PCE 올인원 북마크릿 · 프로토타입</h1><p>아래 링크를 북마크 막대로 드래그한 뒤, 자료가 있는 사이트에서 실행하세요.</p><a href="${escape(bookmarklet)}">PCE 올인원</a><p><a href="demo.html">설치 전 연습 화면 열기</a></p><p>업무 · DB · 메모/일정 · 런처 · 조건 치환 · HWPX 뷰어/앵커 · 관계 · 전체 백업을 한 패널로 제공합니다.</p><p>기존 북마크는 위 링크로 교체하세요. 현재 사이트의 IndexedDB에 보관합니다. JSON 내보내기 후 데스크탑 가져오기에서 반영하세요. 자동 수집은 기본으로 꺼져 있습니다.</p><p>첫 보기는 한글 키 사전에 등록된 표만 표시합니다. 결과가 없으면 모든 표 보기 또는 키 사전을 확인하세요.</p><p>사이트 보안 정책이나 브라우저의 북마크 URL 길이 제한에 따라 실행이 제한될 수 있습니다. 실제 나라장터 화면 검증은 별도입니다. 파일 크기: ${new TextEncoder().encode(bookmarklet).length.toLocaleString()}바이트.</p></html>`,'utf8');

const demo = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>PCE 올인원 연습 화면</title><style>body{font:16px system-ui;color:#24483f;background:#edf4f2;padding:40px;line-height:1.8}table{border-collapse:collapse;background:#fff}td,th{padding:12px;border:1px solid #bdd1c9}a{display:inline-block;background:#126d61;color:white;border-radius:8px;padding:12px 20px}</style><h1>PCE 올인원 · 연습용 화면</h1><p>이 페이지는 합성 WebSquare 자료를 사용합니다. 실제 나라장터 화면 검증이 아닙니다.</p><p><a id="run" href="${escape(bookmarklet)}">PCE 올인원 열기</a> ← 북마크 막대로 드래그해도 됩니다.</p><div id="demoDepth1"></div><div id="demoDepth2"></div><div id="demoNumber"></div><div id="demoOrder"></div><div id="demoGrid"></div><table><tr><th>접수번호</th><th>차수</th><th>품명</th><th>수량</th><th>단가</th></tr><tr><td>DEMO-0001</td><td>01</td><td>연습용 프린터</td><td>0</td><td>35608652.5</td></tr></table><script>
const sampleRows=[{ctrtDmndRcptNo:'DEMO-0001',ctrtDmndRcptOrd:'01',ctrtDmndRcptItemSqno:'0001',품명:'연습용 프린터',수량:0,단가:'35608652.5',활성:false,상세:{codes:['01','02'],active:false}},{ctrtDmndRcptNo:'DEMO-0001',ctrtDmndRcptOrd:'01',ctrtDmndRcptItemSqno:'0002',품명:'연습용 복합기',수량:3,단가:'12.5',활성:true,상세:{codes:['03'],active:true}}];
const point={demoDepth1:['depth1','01001'],demoDepth2:['depth2','01114'],demoNumber:['ctrtDmndRcptNo','DEMO-0001'],demoOrder:['ctrtDmndRcptOrd','01']};window.WebSquare={util:{getComponentById:id=>id==='demoGrid'?{id,getPluginName:()=> 'gridView',getDataList:()=>({getAllJSON:()=>sampleRows})}:point[id]?{getPluginName:()=> 'input',getRef:()=>point[id][0],getValue:()=>point[id][1]}:undefined}};
</script></html>`;
await writeFile('dist/bookmarklet/demo.html',demo,'utf8');
console.log('Built extension background/manifest and standalone bookmarklet ('+javascript.length+' characters).');


await copyFile('docs/BOOKMARKLET.md','dist/bookmarklet/README.md');
const licenses=[['React','react/LICENSE'],['React DOM','react-dom/LICENSE'],['Tabulator','tabulator-tables/LICENSE'],['Decimal.js','decimal.js/LICENCE.md'],['SheetJS CE','xlsx/LICENSE'],['fflate','fflate/LICENSE']];
const notices=await Promise.all(licenses.map(async([name,file])=>name+'\n\n'+await readFile('node_modules/'+file,'utf8')));
await writeFile('dist/bookmarklet/THIRD_PARTY_NOTICES.txt',notices.join('\n\n------------------------------------------------------------\n\n'),'utf8');
await copyFile('docs/BOOKMARKLET_REQUIREMENTS_MATRIX.md','dist/bookmarklet/REQUIREMENTS_STATUS.md');

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist/mvp-extension');
await mkdir(output, { recursive: true });
// Source: https://esbuild.github.io/api/#build
await build({ absWorkingDir: root, entryPoints: ['apps/mvp/main.ts'], outfile: path.join(output, 'main.js'), bundle: true, format: 'esm', target: 'chrome138', platform: 'browser', minify: true, loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.svg': 'file', '.png': 'file' }, assetNames: 'assets/[name]-[hash]' });
await build({ absWorkingDir: root, entryPoints: ['apps/mvp/widget.ts'], outfile: path.join(output, 'widget.js'), bundle: true, format: 'iife', target: 'chrome138', platform: 'browser', minify: true });
// MAIN-world functions are serialized at runtime: preserve their self-contained bodies.
await build({ absWorkingDir: root, entryPoints: ['apps/mvp/background.ts'], outfile: path.join(output, 'background.js'), bundle: true, format: 'esm', target: 'chrome138', platform: 'browser', minify: true });
const sourceHtml = await readFile(path.join(root, 'apps/mvp/index.html'), 'utf8');
const html = sourceHtml.replace(/(?:\/apps\/mvp\/|(?:\.\/)?(?:src\/)?)main\.ts/g, './main.js');
if (!html.includes('main.js')) throw new Error('MVP index.html must load main.ts or main.js.');
const completeHtml = html.includes('main.css') ? html : html.replace('</head>', '  <link rel="stylesheet" href="./main.css">\n</head>');
await writeFile(path.join(output, 'main.html'), completeHtml, 'utf8');
// Local MV3 assets only. Script bodies from the user run through userScripts.execute.
// Source: https://developer.chrome.com/docs/extensions/reference/api/userScripts
const g2b = ['*://g2b.go.kr/*', '*://*.g2b.go.kr/*'];
const manifest = {
  manifest_version: 3, name: 'G2B Helper MVP', version: '0.1.0', minimum_chrome_version: '138',
  description: '나라장터 현재 화면 수동 추출·Grid·SQLite 업무 보조',
  permissions: ['activeTab', 'scripting', 'nativeMessaging', 'userScripts'], host_permissions: g2b,
  background: { service_worker: 'background.js', type: 'module' }, action: { default_title: 'G2B Helper 리모컨 열기' },
  content_scripts: [{ matches: g2b, js: ['widget.js'], all_frames: false, run_at: 'document_idle' }],
  web_accessible_resources: [{ resources: ['main.html', 'main.js', 'main.css', 'assets/*'], matches: g2b }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  commands: {
    'mvp.collect': { suggested_key: { default: 'Alt+Shift+S' }, description: '현재 화면 수집 비교창 열기' },
    'mvp.document': { suggested_key: { default: 'Alt+Shift+D' }, description: '문서 생성 열기' },
    'mvp.extract': { description: '현재 화면 임시 추출창 열기' },
    'mvp.db': { description: 'DB Grid 열기' },
    'mvp.launcher': { description: '사용자 JS 런처 열기' }
  }
};
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
const licenses = [['Tabulator', 'tabulator-tables/LICENSE'], ['Decimal.js', 'decimal.js/LICENCE.md'], ['SheetJS CE', 'xlsx/LICENSE']];
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), (await Promise.all(licenses.map(async ([name, file]) => name + '\n\n' + await readFile(path.join(root, 'node_modules', file), 'utf8')))).join('\n\n------------------------------------\n\n'), 'utf8');
console.log('Built G2B Helper MVP extension: dist/mvp-extension (manual capture, local assets, dedicated Native Host).');

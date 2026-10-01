import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'dist/mvp-extension');
const host = path.join(root, 'dist/mvp-host');
const hostApp = path.join(host, 'feedback/G2BHelperHost');
const output = path.join(root, 'dist/G2B_Helper_MVP.zip');
const args = process.argv.slice(2);
if (args.some(arg => !['--build-host','--build-host-only'].includes(arg)) || args.length > 1) throw new Error('Only one build-host option is supported.');
for (const target of [extension, host, output]) if (!target.startsWith(root + path.sep)) throw new Error('Output escapes project.');
if (!fs.existsSync(path.join(extension, 'manifest.json'))) throw new Error('Build the MVP extension before packaging.');
if (args.includes('--build-host') || args.includes('--build-host-only')) {
  // Restore only missing files from the previous verified ZIP. Never overwrite a live runtime.
  if (fs.existsSync(output)) {
    const prior = unzipSync(fs.readFileSync(output)); let restored = 0;
    for (const [name, bytes] of Object.entries(prior)) {
      if (!name.startsWith('mvp-host/G2BHelperHost/')) continue;
      const filename = path.resolve(host, name.slice('mvp-host/'.length));
      if (!filename.startsWith(path.join(host, 'G2BHelperHost') + path.sep) || name.includes('..') || name.includes('\\')) throw new Error('Unsafe archived runtime path.');
      const relative = path.relative(root, path.dirname(filename)); let parent = root;
      for (const segment of relative.split(path.sep)) { parent = path.join(parent, segment); if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Runtime path is a junction.'); }
      if (!fs.existsSync(filename)) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx' }); restored++; }
    }
    console.log('Preserved installed runtime; restored missing previous-package files: ' + restored);
  }
  const python = path.join(root, '.venv/Scripts/python.exe');
  if (!fs.existsSync(python)) throw new Error('Project .venv Python and PyInstaller are required.');
  const work = path.join(root, 'artifacts/mvp-pyinstaller');
  fs.mkdirSync(work, { recursive: true });
  const fresh = path.join(host, 'feedback');
  if (!fresh.startsWith(root + path.sep) || fs.existsSync(fresh) && fs.lstatSync(fresh).isSymbolicLink()) throw new Error('Unsafe fresh runtime destination.');
  execFileSync(python, ['-m','PyInstaller','--noconfirm','--onedir','--name','G2BHelperHost','--paths',path.join(root,'native'),'--distpath',fresh,'--workpath',work,'--specpath',work,path.join(root,'native/mvp_host.py')], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
  if (args.includes('--build-host-only')) { console.log('Fresh Native Host build: ' + hostApp); process.exit(0); }
}
if (!fs.existsSync(path.join(hostApp, 'G2BHelperHost.exe')) || !fs.existsSync(path.join(hostApp, '_internal'))) throw new Error('A complete Native Host runtime is required; use --build-host.');
function files(directory) {
  const result = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Package contains symlink/junction.');
      if (entry.isDirectory()) visit(filename); else if (entry.isFile()) result.push(filename); else throw new Error('Unsupported package entry.');
    }
  }
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Package root is a symlink/junction.');
  visit(directory); return result;
}
const entries = Object.create(null);
entries['설치안내.txt'] = strToU8("G2B Helper MVP 설치\n\n1. ZIP 전체를 고정된 폴더에 풉니다. mvp-host의 _internal 폴더를 함께 유지합니다.\n2. chrome://extensions 또는 edge://extensions에서 개발자 모드 → 압축해제된 확장 로드 → mvp-extension을 선택합니다.\n3. 표시되는 확장 ID(32자리)를 복사합니다.\n4. ZIP을 푼 폴더에서 PowerShell을 열어 아래 명령의 ID를 바꿔 실행합니다.\n   .\\mvp-host\\install-mvp-host.ps1 -ExtensionId '복사한32자리확장ID'\n   이 명령은 해당 사용자 HKCU에 Native Host를 등록합니다. 관리자 권한은 필요하지 않습니다.\n5. 확장을 다시 로드하고 나라장터 페이지를 새로 고칩니다. 수집 후 DB에서 재조회를 확인합니다.\n\nHost는 확장이 Native Messaging으로 시작합니다. exe를 직접 실행하는 방식이 아닙니다.\n저장 위치: %LOCALAPPDATA%\\G2BHelper\\mvp.sqlite3\n실제 나라장터 화면·확장과 Host의 연결은 수동 검증이 필요합니다.\n기존 PCE DB, 참고 JSON과 업무 원문은 포함하지 않습니다.\n이번 MVP 문서 기능은 JSON 전달 파일까지만 제공합니다.\n");
for (const filename of files(extension)) {
  const relative = path.relative(extension, filename).replaceAll('\\', '/');
  if (!/^(?:manifest\.json|main\.(?:html|js|css)|widget\.js|background\.js|THIRD_PARTY_NOTICES\.txt|assets\/[^/]+)$/.test(relative)) throw new Error('Unexpected extension package entry: ' + relative);
  entries['mvp-extension/' + relative] = fs.readFileSync(filename);
}
for (const filename of files(hostApp)) {
  const relative = 'G2BHelperHost/' + path.relative(hostApp, filename).replaceAll('\\', '/');
  if (/(?:참고자료|prototypes|data_map_|\.sqlite(?:3)?(?:-wal|-shm)?$|\.db$)/.test(relative)) throw new Error('Excluded source/database entry.');
  entries['mvp-host/' + relative] = fs.readFileSync(filename);
}
const installer = path.join(host, 'install-mvp-host.ps1');
fs.copyFileSync(path.join(root, 'scripts/install-mvp-host.ps1'), installer);
entries['mvp-host/install-mvp-host.ps1'] = fs.readFileSync(installer);
const archive = zipSync(entries, { level: 6 });
fs.writeFileSync(output, archive);
const reopened = unzipSync(fs.readFileSync(output));
for (const [name, bytes] of Object.entries(entries)) if (!reopened[name] || !Buffer.from(reopened[name]).equals(bytes)) throw new Error('Archive byte mismatch: ' + name);
console.log('Verified G2B Helper MVP package: ' + output + ' (' + Object.keys(entries).length + ' entries)');

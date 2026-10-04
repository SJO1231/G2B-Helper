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
entries['설치안내.txt'] = strToU8(`G2B Helper MVP 설치

1. ZIP 전체를 계속 사용할 고정 폴더에 풉니다. ZIP 안에서 직접 실행하지 마세요.
2. 맨 위의 설치.cmd를 더블클릭합니다. ID 복사와 명령 입력 없이 Chrome·Edge Native 연결을 함께 등록합니다.
   배포본의 고정 공개키에서 ID를 자동 계산하고 같은 폴더의 기존 등록 파일에 있는 허용 ID도 유지합니다. Python을 별도로 설치하지 않습니다.
3. 처음 한 번은 사용할 브라우저의 chrome://extensions 또는 edge://extensions에서 개발자 모드 → 압축해제된 확장 로드 → 이 폴더의 mvp-extension을 선택합니다.
   스토어 미등록 확장의 최초 브라우저 추가는 수동입니다. 설치.cmd가 이 단계를 대신하거나 브라우저 정책을 바꾸지 않습니다.
4. 나라장터 페이지를 새로 고치고 수집 후 DB 재조회를 확인합니다. 이후 같은 폴더에 배포본을 갱신하면 확장 관리 화면에서 새로고침합니다.

이전 키 없는 배포본을 쓰던 경우: 이 고정 키 배포본은 새 ID로 추가될 수 있습니다. 새 확장을 추가하고 이전 중복 확장은 비활성화하세요. 업무 DB 저장 위치는 동일합니다. 다른 폴더로 새로 설치할 때는 Native 연결 경로도 새 폴더로 바뀝니다.
설치.cmd에서 오류가 표시되면 등록 완료가 아닙니다. 조직의 스크립트 실행 제한은 그대로 따르며 전역 실행 정책을 변경하지 않습니다.
고급 사용자용 기존 install-mvp-host.ps1의 -ExtensionId 및 -Preview 인수도 유지합니다.

Host는 확장이 Native Messaging으로 시작합니다. exe를 직접 실행하는 방식이 아닙니다.
저장 위치: %LOCALAPPDATA%\\G2BHelper\\mvp.sqlite3
공유 설정: 설정 → 공유 설정에서 JSON 내보내기/가져오기, 변경 선택 후 설정 저장.
정정한 DB 셀은 정정 표시를 눌러 최근 수집값을 확인하고 정정 취소할 수 있습니다.
저장 응답이 끊기면 저장 결과 확인을 먼저 처리하세요. 복구 요청은 같은 브라우저 세션 동안 유지됩니다.
문서 생성은 별도 Studio lite를 실행하고 문서생성안내.txt를 따릅니다.
실제 나라장터 화면·확장과 Host의 연결은 수동 검증이 필요합니다. 업무 DB와 참고 원문은 이 패키지에 포함하지 않습니다.
`);
entries['문서생성안내.txt'] = strToU8('문서 생성 연결\n\n별도 Studio lite를 실행한 상태에서 사용합니다(기본 http://127.0.0.1:4318).\nStudio lite에서 서식·원천 키 Column 매핑을 저장하고 Helper 연결에 저장본과 출력 폴더를 지정합니다.\nHelper 설정 → 문서 연결에서 접수/공고/계약에 해당 서식을 한 번 연결합니다.\n화면 또는 DB에서 필요한 행을 선택하고 생성 → 자료 확인 → 생성으로 HWPX 파일을 저장합니다. 화면 자료는 DB에 먼저 저장할 필요가 없습니다.\n서식과 원천 키의 연결은 표시명 변경에 영향을 받지 않습니다.\n첫 연결은 1~100건, 단일 값 서식입니다. 중첩 자료·실제 하위 행·필수값 누락은 보완 사유를 표시합니다.\n소수·큰 금액은 정밀 문자열을 유지하도록 Studio의 문자 필드로 매핑하세요. money 서식은 안전한 정수 원 범위만 지원합니다.\n기존 파일을 덮어쓰거나 자동으로 열기·인쇄하지 않습니다. 통신 실패 시 같은 요청 다시 시도로 결과를 확인하세요.\nStudio lite와 서식·실사용 자료는 이 ZIP에 포함하지 않습니다. 실제 업무 서식 인수는 별도로 확인해야 합니다.\n');
entries['설치안내.txt'] = strToU8(new TextDecoder().decode(entries['설치안내.txt']).replace('이번 MVP 문서 기능은 JSON 전달 파일까지만 제공합니다.', '문서 생성은 별도 Studio lite 연결을 사용합니다. 아래 문서 생성 안내를 참고하세요.')+'\n'+new TextDecoder().decode(entries['문서생성안내.txt']));
delete entries['문서생성안내.txt'];
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
const installEntry = path.join(root, 'dist/설치.cmd');
fs.writeFileSync(installEntry, fs.readFileSync(path.join(root, 'scripts/install-mvp.cmd'), 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
entries['설치.cmd'] = fs.readFileSync(installEntry);
const archive = zipSync(entries, { level: 6 });
fs.writeFileSync(output, archive);
const reopened = unzipSync(fs.readFileSync(output));
for (const [name, bytes] of Object.entries(entries)) if (!reopened[name] || !Buffer.from(reopened[name]).equals(bytes)) throw new Error('Archive byte mismatch: ' + name);
console.log('Verified G2B Helper MVP package: ' + output + ' (' + Object.keys(entries).length + ' entries)');

# Windows 실행 안내

이 안내는 현재 저장소 구현에 대한 개발자 실행 절차다. 제품의 전체 요구사항을 지원하거나 배포 승인을 받았다는 의미는 아니다. 요구사항은 `PRODUCT.md`, 합격 기준은 `ACCEPTANCE.md`, 설계 선택의 출처는 `DECISIONS.md`를 확인한다. 명령 결과와 미검증 범위는 `TEST_REPORT.md`를 본다.

## 준비 및 빌드

저장소 루트 `E:\PROGRAM\PCE`에서 실행한다. Node/npm과 Python이 필요하다. 개발 환경의 Python은 `.venv`를 사용하며 pywebview와 PyInstaller는 `native/requirements.txt` 및 빌드 스크립트가 요구하는 버전으로 설치한다. npm 의존성이 준비되지 않았을 때 `npm ci`를 실행한다.

```powershell
cd E:\PROGRAM\PCE
npm run build
```

빌드 결과의 브라우저 확장은 `dist\extension`, 북마크릿 설치 페이지는 `dist\bookmarklet\install.html`에 생성된다. 현재 북마크릿 빌드 파일은 단일 실행 스크립트를 내보내는 구조이며, Chrome 정책이나 URL 길이 제한이 실행을 막을 수 있다.

데스크탑과 Native Host의 PyInstaller onedir 배포물을 생성하려면 다음 명령을 사용한다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
```

스크립트는 기본적으로 프런트엔드를 다시 빌드한 뒤 `.venv\Scripts\python.exe`에서 PyInstaller를 실행한다. 현재 산출 경로는 `dist\desktop\PCE\PCE.exe`와 `dist\desktop-v4\PCE.NativeHost\PCE.NativeHost.exe`다. 배포 시 각 폴더의 `_internal` 파일을 포함해 폴더 전체를 보존한다. 설치 스크립트는 Python 체크아웃 또는 `-HostExe`로 지정한 패키지 실행 파일을 등록할 수 있다. 실제 사용자 브라우저 등록은 아직 수행하지 않았다.

## 로컬 데스크탑 워크스페이스

```powershell
.\.venv\Scripts\python.exe native\desktop.py
```

인자 없이 실행하면 pywebview가 WebView2 창을 만들고, 인증된 loopback HTTP 서버가 빌드된 Workspace를 제공한다. 현재 PC에서 DPI 초기화 불일치를 수정한 뒤 source 및 배포 EXE의 Workspace 연결·한글 화면·별도 뷰어 smoke가 통과했다. 원인은 `WEBVIEW2_DIAGNOSIS.md`, 검증 범위는 `TEST_REPORT.md`를 따른다.

선택 인자:

```powershell
python native\desktop.py --no-browser
python native\desktop.py --browser
python native\desktop.py --database E:\PCE-data\pce.sqlite3 --port 8765
python native\desktop.py --viewer-file E:\PCE-data\preview.html
```

`--no-browser`는 창 없이 loopback 서버/API를 실행한다. `--browser`는 기본 브라우저를 연다. `--viewer-file`은 파일을 pywebview viewer로 연다. `--database`는 DB 경로, `--port`는 loopback 포트, `--dist`는 UI 산출물 폴더를 지정한다. 새 기본 DB 위치는 `%LOCALAPPDATA%\PCE\pce.sqlite3`이며 `LOCALAPPDATA`가 없는 환경은 사용자 홈 아래 `.local/share/PCE/pce.sqlite3`를 사용한다. 테스트나 샘플 검증에는 별도 임시 DB 경로를 사용한다.

샘플 사용에는 별도 테스트 DB를 지정한다. 예: `dist\desktop\PCE\PCE.exe --database E:\PROGRAM\PCE\demo\pce.sqlite3`. 배포 EXE는 PerMonitorV2 매니페스트를 포함한다. WebView2 프로필은 DB 폴더 아래 `webview2`를 쓰고, `--webview-profile`로 별도 경로를 지정할 수 있다. 다른 PC나 전체 기능의 수용 검증까지 완료한 것은 아니다.

## Chrome 확장과 Native Messaging

1. Chrome에서 `chrome://extensions`를 열고 개발자 모드를 켠다.
2. `압축해제된 확장 프로그램을 로드`를 선택하고 저장소의 `dist\extension` 폴더를 선택한다.
3. 확장 카드에 표시되는 ID를 복사한다. 설치 스크립트는 Chrome 확장 ID가 필요하다.
4. 저장소 루트에서 현재 사용자(HKCU)에 Native Messaging 호스트를 등록한다.

```powershell
powershell -ExecutionPolicy Bypass -File native\install_host.ps1 -ExtensionId YOUR_32_CHARACTER_EXTENSION_ID
```

선택한 Python 실행 파일 또는 호스트 폴더를 지정할 수 있다.

```powershell
powershell -ExecutionPolicy Bypass -File native\install_host.ps1 `
  -ExtensionId YOUR_32_CHARACTER_EXTENSION_ID `
  -PythonExe E:\PROGRAM\PCE\.venv\Scripts\python.exe `
  -InstallDirectory "$env:LOCALAPPDATA\PCE\native-host"
```

패키지 실행 파일을 등록하는 경우:

```powershell
powershell -ExecutionPolicy Bypass -File native\install_host.ps1 `
  -ExtensionId YOUR_32_CHARACTER_EXTENSION_ID `
  -HostExe E:\PROGRAM\PCE\dist\desktop-v4\PCE.NativeHost\PCE.NativeHost.exe `
  -Browser Chrome
```

`-Browser`는 `Chrome`, `Edge`, `Both`를 지원하며 기본값은 `Both`다. 선택한 브라우저의 현재 사용자 NativeMessagingHosts 레지스트리 키와 매니페스트를 만든다. 실행 파일이나 저장소를 이동하면 다시 등록해야 한다. 최소 Chrome 버전은 138이다. 스크립트 지원과 패키지 통신 검증은 실제 브라우저 등록·연결 성공과 구분한다.

## 북마크릿 JSON 전달

1. 빌드 후 `dist\bookmarklet\install.html`을 Chrome에서 연다.
2. 페이지의 `PCE 수집·추출` 링크를 북마크 막대로 끌어 놓는다.
3. 자료가 로딩된 페이지에서 북마크를 실행한다. `1회 수집·보관`과 자동 수집은 지정 화면/규칙과 업무 식별이 일치할 때만 현재 사이트(origin)의 IndexedDB에 저장된다. 자동 수집은 기본으로 꺼져 있다.
4. 북마크릿의 사이트 보관함에서 내보낼 수집을 선택하고 `선택한 수집 JSON 내보내기`를 누른다.
5. 데스크탑 워크스페이스의 `수집 관리자`에서 `북마크릿 JSON 가져오기`로 파일을 가져온다. 원본 보관과 정규화 반영은 별도 단계이며, 미리보기에서 확인 후 필드 충돌을 선택해 반영한다.

JSON 내보내기는 IndexedDB의 원본을 삭제하지 않으며 그 자체로 데스크탑 반영 완료를 뜻하지 않는다. 북마크릿 보관함은 사이트 origin마다 분리된다.

기본 지정은 접수 `01001/01114·01117`, 공고 `01173/01174`, 계약 `01570/01571`이며 번호·차수와 같은 frame의 Dataset을 함께 검사한다. 미지정 화면과 요청 `01108·01118`은 기본 수집을 차단한다. 그 화면은 `임시 추출`로 볼 수 있고 사용자가 `임시 추출 결과를 별도 보관`하면 수집과 구분해 저장한다.

사용자 규칙을 북마크릿에서도 적용하려면 데스크탑 `사전·설정 → 수집 규칙`에서 저장 후 `저장된 수집 정책 내보내기`를 누른다. 북마크릿의 `이 사이트의 수집 정책 · 지정 화면`에서 JSON을 불러오고 `정책 검증·저장`한다. 규칙 목록은 기본 지정 화면을 대체하며 `[]`는 모든 수집을 차단한다. 정책은 사이트마다 저장하고 가져온 설정을 데스크탑에 자동 덮어쓰지 않는다.

화면 조건이 바뀌거나 읽기에 실패하면 자동 수집을 중단한다. 확장은 30초, 북마크릿은 5초마다 현재 로딩된 화면을 다시 검사한다. 정지할 때 이미 진행 중인 한 번의 수집/저장은 마무리될 수 있으며 이후 반복은 재활성화하지 않는다. 반복 실행의 각 이벤트는 별도로 보관하고 동일 이벤트 재전달만 중복 처리한다.

## 백업과 복원

UI의 `백업·복원`에서 전체 또는 선택 테이블 백업을 내려받는다. 복원할 파일을 선택하면 미리보기가 표시되고, 사용자가 복원을 승인해야 적용된다. 현재 백업은 typed rows, table definitions, settings, raw captures를 포함한다. 외부 경로는 참조만 저장되며 파일 내용/첨부 바이트는 포함하지 않는다. 따라서 백업 JSON만으로 외부 파일까지 복구할 수 있다고 간주하지 않는다.

## 검증 명령

```powershell
npm run check:boundaries
npm run typecheck
npm run test
npm run build
python -m unittest discover -s native/tests -v
```

화면과 패키지 검증은 `node scripts/verify-workspace.mjs`, `.\.venv\Scripts\python.exe scripts/verify-package.py`로 실행한다. 최신 결과와 범위는 `TEST_REPORT.md`를 참조한다. 사용자 제공 자료의 구조 검증과 실제 브라우저 권한·Native Messaging 등록·WebView2 GUI 검증은 구분한다. 실제 소스 샘플 값은 공개 픽스처나 보고서에 복사하지 않는다.

네이티브 진입점 검증은 `.\.venv\Scripts\python.exe scripts/verify-desktop.py`, 배포 EXE는 같은 명령에 `--packaged`를 붙인다. 격리 DB·프로필에서 자체 화면을 열고 결과를 기록한 뒤 닫는다.

## GitHub Actions 최소 CI (2026-10-02)

`.github/workflows/ci.yml`은 모든 브랜치의 push와 PR에서 Ubuntu 24.04, Node.js 24로 `npm ci` → `npx playwright install --with-deps chromium` → 기존 `npm run verify`를 실행한다. 의존성 설치·브라우저 준비·verify는 별도 step이다. verify 안의 경계 검사·확장 경계 검사·타입 검사·Vitest·빌드는 기존 package.json 순서와 실패 기준을 그대로 따른다. 첫 실패 명령은 npm 로그에서 확인한다.

이 CI는 `verify:mvp`, Python Native Host 시험, Windows EXE 패키징, 실제 Chrome/Edge 확장 설치·Native Messaging·나라장터 연결의 수용 통과를 뜻하지 않는다. 제품 코드, fixture, 테스트 선택과 기대값은 변경하지 않는다.

### 플랫폼 검사의 실행 경계

| 검사 | 현재 실행 조건 | 이번 처리 |
| --- | --- | --- |
| `npm run verify` | Node 의존성, 기존 lockfile, 위젯 합성 통신 시험용 Playwright Chromium. Python·레지스트리 불필요 | 기본 Ubuntu CI |
| Native Python 회귀·EXE 패키징 | Windows `.venv/Scripts/python.exe`, PyInstaller, 기존 빌드 경로. 공정 하네스는 `E:/Prodev/G2B_Helper` 등 로컬 절대 경로 사용 | 로컬 수용시험; 현재 runner에서 재현 성공을 확인하지 않음 |
| `test:extension:ui` | `.venv/Scripts/python.exe`, Edge. Native Host에 직접 stdio 연결, Chrome API는 하네스 | 로컬 보조 검증; 실제 Native Messaging 통과 근거로 쓰지 않음 |
| `test:extension:runtime` | Edge `msedge`, PowerShell/HKCU 임시 등록, `dist/desktop-v4/PCE.NativeHost/PCE.NativeHost.exe` | 로컬 Edge 연동시험; 실제 Chrome 시험과 구분 |
| MVP 서식·타입 화면 검사 | `scripts/verify-mvp-format-audit.mjs`가 로컬 Chrome 절대 경로 사용. `--require-pass`가 개별 실패를 종료 코드에 반영 | 로컬 수용시험. 보고서 생성 exit 0만으로 통과 판정하지 않음 |
| 실제 Chrome·Native Messaging·나라장터 | 현재 MVP 빌드, 일치하는 확장 ID·allowed_origins·HKCU 등록, 허용된 브라우저 정책·사이트 접근 | 아래 로컬 수용시험으로 별도 확인 |

Windows runner를 지정하는 것만으로 위 조건이 준비되거나 Chrome 연동이 검증되지는 않는다. 따라서 이번에는 신뢰성 있는 실행 근거가 없는 Windows job을 추가하지 않는다. 향후 임시 프로필·DB·호스트 등록의 준비/정리까지 재현한 후 기본 CI와 독립된 Windows job으로 옮긴다.

### 로컬 수용시험

1. 현재 커밋을 기록하고 `npm ci`, `npm run verify`를 실행한다. Native 회귀는 임시 DB를 사용하는 기존 `native/tests`로 실행하고 실제 실행 수·실패·skip을 기록한다. Windows 패키징 및 MVP 회귀는 현재 `docs/process/P00.md`에 등록된 절차를 따른다.
2. 실제 Chrome을 별도 시험 프로필로 열고 현재 MVP 산출물 `dist/mvp-extension`을 로드한다. `scripts/install-mvp-host.ps1`의 인자와 설치 안내에 따라 해당 ID로 현재 MVP 호스트를 등록한다. 과거 `dist/extension`·PCE 호스트의 검증을 MVP 연결 성공으로 대체하지 않는다.
3. 합성 자료와 임시 저장소에서 확장 → Native Host → SQLite 저장/재조회 및 호스트 재시작 후 재조회를 확인한다. 식별 문자열·앞자리 0·decimal·0/false 보존을 확인하고, 호스트 없음·등록 ID 불일치의 오류도 확인한다.
4. Chrome 버전, 확장 ID, 호스트 빌드/커밋, 실행 명령, 통과·실패·미검증, 시험 등록 제거 결과를 기록한다. 사용자 DB와 기존 등록을 덮어쓰지 않는다. 나라장터 실화면/내부망 정책은 별도의 허용된 환경에서 확인하기 전까지 미검증으로 남긴다.

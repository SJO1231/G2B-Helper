# #13 클라우드 인계 접근성과 실행 준비 상태

이 문서는 N13-H1의 **자료 준비·읽기 전용 대조 결과**다. 클라우드 런타임에 접속하거나 검사·빌드·설치·훅을 실행하지 않았다. 읽기용 자료가 있다는 사실을 제품 실행 가능, 제품 검증 완료 또는 사용자 수용으로 표현하지 않는다.

## 기준과 변경 계약

- 실제 승인: [sources/user-messages.json](sources/user-messages.json)의 `messageId=msg_01a107d2-1e84-76e1-a70b-c00c0fe0ca9b`, `sourceRecordLine=10839`, `timestamp=2026-10-04T16:49:33.316Z`인 N13-H1 메시지. 이 문서는 3·4·5·7·8·10절에 대응한다. 원문 전체와 요구 대응은 [requirements.md](requirements.md)를 함께 읽는다.
- 승인 원문: “이번에는 새로운 실행 스크립트를 만들지 마라.” / “읽기용 스냅샷이 있다는 이유로 제품 전체가 실행 가능하다고 선언하지 마라.”
- 원격 제품 기준은 `ae56ddd874eda0cf62c15dbea9f208c6551fe624`, 별도 제품 스냅샷은 `d680ac2244c1a128f186572e79bea79d5d525c78`의 `apps/mvp` 17개 파일이다. 두 버전을 섞어 현재 제품으로 판정하지 않는다. 원격 기준의 `native/**`에 d680 변경을 편입하지 않았다.
- 문서 작성자의 허용 변경은 이 파일 추가뿐이다. 제품·시안 버튼/동작/배치, 기존 실행 구조, 원문·기존 검사·frozen 자료를 보존한다. 추가 의존 자료는 제안만 남기고 실행 스크립트나 새 정책을 만들지 않는다.
- 원래 Windows 작업 폴더는 `E:\Prodev\G2B_Helper`, 인계 worktree는 `E:\Prodev\G2B_Helper_issue13_handoff`다. 이 절의 절대 경로는 출처 설명이며 클라우드에서 접근 가능한 경로가 아니다. 인계 파일은 아래 상대 경로와 manifest로 찾는다.

## 읽을 수 있는 범위와 조건부 실행 범위

| 대상 | 이번 직접 확인 | 다음 단계에 필요한 조건 | 판정 |
| --- | --- | --- | --- |
| 확보 승인 원문·관측 JSON | 저장소 상대 경로의 UTF-8 파일 | 게시 승인 후 해당 묶음이 클라우드 checkout에 실제 존재해야 함 | 로컬 자료 읽기 확인. 게시·클라우드 접근 미확인 |
| `materials/mockup/{legacy4331,F43-before,F44}/index.html` | 분리된 버전과 F44의 inline style/script·시안/샘플 표시 | HTML을 표시할 브라우저, 동일 파일·viewport, 실제 렌더 관측 | 정적 열람 가능. 새 화면 로딩·동작 미검증 |
| `materials/mockup/**/verify*.mjs.txt` | Node/Playwright 의존·파일 입력·JSON/PNG 쓰기 확인 | 별도 실행 승인, 원래 실행 확장자·배치·browser 경로·출력 소유 계약 대조 | 읽기용. 이번 실행 대상 아님 |
| `materials/product-d680/apps/mvp` | 17개 파일과 import·HTML 참조 확인 | 해당 커밋의 외부 모듈·설정·빌드/Native 계약까지 일치하는 별도 기준 필요 | 소스 스냅샷. 독립 실행 패키지 아님 |
| 원격 기준의 타입·단위 검사 | `package.json`, `tsconfig.json`, P00 명령 배열 읽음 | Node/npm 및 lock 의존, 검사 대상과 소유·출력·승인 확정 | 검토 가능한 계획. 실행 통과 근거 없음 |
| 실제 Chrome/Edge 확장·Native·나라장터 업무 | API 호출·등록 소스만 읽음 | Windows 설치/등록, 실제 확장 ID·브라우저 권한·로그인 화면·Native 왕복 관측 | 클라우드 대체 검증 불가. 실제 업무 미검증 |
| Agent 설정·훅 | 현재 root 설정 및 읽기용 local-guidance 사본 읽음 | 도구 지원·trust·실제 로딩·차단 관측과 후속 승인 | 작성/설정 존재만 확인. 로딩·보호 미확인 |

클라우드 OS·설치 도구·Node/Python 버전·브라우저 바이너리·네트워크·도구 trust에 실제 접근하지 않았다. 따라서 “클라우드에서 가능한 검사”는 자료와 환경 조건이 충족될 때의 정적 분류이며 이번 실행 허가가 아니다. 기존 CI의 `ubuntu-24.04`, Node `24`, `npm ci`, Chromium 설치 및 `npm run verify` 선언은 설정 원문이다. 이번에 CI 실행 기록을 조회하지 않았으며 #13 또는 d680/Native 검증을 증명하지 않는다.

## 런타임과 외부 의존

| 의존 | 직접 읽은 근거 | 영향 |
| --- | --- | --- |
| Node ES module, npm workspace/lock | root `package.json`, `package-lock.json`; 검사기의 `node:fs`, `path`, `url`, `crypto`, `assert` import | 패키지 이름만 있어도 설치 완료가 아님. 새 worktree의 `node_modules`는 이번 조사에서 없음 |
| TypeScript/Vite/esbuild/Vitest/Playwright | root package에 TS `5.9.3`, Vite `7.3.6`, esbuild `0.25.11`, Vitest `4.1.11`, `@playwright/test` `1.56.1`; lock의 Vite Node 조건 `^20.19.0 \|\| >=22.12.0`; root CI Node `24` | 설치·호환성·실행 미확인. `tsconfig.json`은 apps/plugins/packages/tests 전체를 include하므로 d680 17개만 독립 타입검사했다고 볼 수 없음 |
| 브라우저 라이브러리 | d680 `grid.ts`, `grid-model.ts`, `user-fields.ts`; root package의 Tabulator `6.5.0`, Decimal.js `10.6.0`, SheetJS URL, fflate `0.8.3` | SheetJS는 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`라는 외부 공급 주소. 설치 접근/캐시 미확인 |
| 스냅샷 밖 모듈 | d680 `background.ts`/`bridge.ts`의 `../../plugins/collector/extractor`, `../../plugins/page-actions/index`; `extractor.ts`의 `../../plugins/collector/scope` | relocated snapshot에서 상대경로는 `materials/product-d680/plugins/...`를 가리키며 그 모듈은 17개 묶음에 없음. 원격 root 모듈로 자동 대체하면 혼합 버전이 됨 |
| 제품 HTML과 빌드 | d680 `index.html`은 `main.css`/`main.js` 참조. root `scripts/build-mvp.mjs`는 3 entry point를 bundle하고 `dist/mvp-extension`에 manifest/assets/notices 작성 | TS·CSS 소스 스냅샷은 빌드된 extension 파일 묶음과 다름. 스냅샷 HTML만 열어 제품이 표시된다고 주장하지 않음 |
| Python/SQLite | root `native/mvp_host.py`, `native/host.py`, `native/pce/mvp.py`의 Python 표준 모듈 및 SQLite; `native/requirements.txt`의 `pywebview==6.2.1` | MVP stdio Gateway와 기존 desktop GUI의 의존 범위를 구분. SQLite 테스트의 임시 DB도 쓰기와 출력이며 순수 읽기 아님 |
| Native 빌드 | `native/requirements-build.txt`: `-r requirements.txt`, `PyInstaller==6.20.0`; root `scripts/package-mvp.mjs` | Windows `.venv/Scripts/python.exe`, PyInstaller onedir, EXE와 `_internal`을 요구. 이번 빌드·설치·배포 ZIP은 제외 |
| 실제 외부 문서 연동 | d680 `main.ts`의 Studio lite 연결 요구와 `bridge.ts`/`background.ts`의 RPC | d680 `apps/mvp`만으로 연결 상대·Native 구현·서식/저장 폴더·문서 생성 실행을 입증할 수 없음. 실제 업무 문서/DB는 인계 제외 |

## Windows 경로·대소문자·Native

- F43-before/F44/legacy 검사기는 `C:/Program Files/Google/Chrome/Application/chrome.exe`를 `chromium.launch`에 고정한다. Linux의 Playwright Chromium 설치만으로 이 경로가 생기지 않는다. root `scripts/verify-mvp-ui.mjs`는 Playwright 설치 경로와 Windows Chrome/Edge를 탐색하지만 이 차이는 시안 검사기에서 자동 반영되지 않는다.
- P00의 `mvp-typecheck`, `mvp-test`, `mvp-build`, `mvp-ui-test` 등은 `C:/Program Files/nodejs/node.exe`; Python 검사기는 원래 폴더의 `E:/Prodev/G2B_Helper/.venv/Scripts/python.exe`를 지정한다. 새 worktree·클라우드에서 실행 가능한 catalog라고 판단하지 않는다.
- root `.claude/settings.json`과 `.codex/hooks.json`에는 `node "E:/Prodev/G2B_Helper/scripts/harness/hook.mjs" ...`가 있다. 새 worktree를 읽어도 원래 폴더 스크립트를 가리킬 수 있다. root 설정은 기반 commit에서 상속된 파일이며 이번에 신규 등록/실행하거나 자동 로딩됐다고 확인하지 않았다. `materials/local-guidance/**/*.txt` 사본은 활성 설정이 아니다.
- Windows에서 `.Claude`와 `.claude`는 같은 디렉터리로 접근되지만 Linux는 별도 경로다. 이번 Windows 조회로 두 독립 트리의 내용/존재가 확인됐다고 선언하지 않는다. 실제 저장소의 tracked 경로는 manifest·Git 목록으로 대조하고, 인계 사본의 표기를 임의로 활성 `.claude` 설정으로 이동하지 않는다.
- `.codex/agents/implementer.toml`의 `gpt-6.1-sol/high`, `.claude/agents/implementer.md`의 `sonnet/high`는 선언/alias다. `.claude` 역할 원문도 실제 모델·호출 승인은 별도 관측이라고 명시한다. 클라우드의 실제 모델/effort/fallback은 미확인이다.
- `scripts/install-mvp-host.ps1`는 EXE·확장 ID를 요구하고 Chrome/Edge `HKCU:\Software\...\NativeMessagingHosts\com.sjo1231.g2b_helper`에 등록한다. `build-mvp.mjs`는 MV3 `nativeMessaging`, `scripting`, `userScripts`, 나라장터 host 권한과 Chrome `138` 최소 버전을 선언한다. 이것은 source evidence이며 실제 등록·확장 주입·Native 연결 근거가 아니다.
- `native/mvp_host.py`는 `%LOCALAPPDATA%/G2BHelper/mvp.sqlite3`를 기본 위치로 사용하고 Windows에서 stdio를 binary로 설정한다. 사용자 환경 상태/업무 DB는 인계하지 않는다. Linux에서 임시 DB의 Python 검사 일부가 성립하더라도 Windows registry/EXE/실제 extension 업무를 대체하지 않는다.
- P00 frozen은 `참고자료`, `prototypes/table-flow`, `prototypes/features/grid`를 포함한다. 이 인계에서 빠진 원본이 있으면 원래 하네스의 frozen hash 전체 대조는 막힌다. frozen 완화·새 baseline·제외 목록 변경으로 통과시키거나 이 제약을 제품 결함으로 분류하지 않는다.

## 준비·통합·서버·조각 제외의 정적 영향

원래 `E:\Prodev\G2B_Helper\artifacts\mvp-feature-mockup\revisions\F44`의 아래 5개 파일을 직접 읽었다. 실행하지 않았다.

| 원본 파일 | 입력/동작 | 제외 후 보존되는 범위와 빠지는 범위 | 추가 자료 제안 |
| --- | --- | --- | --- |
| `prepare.mjs` | root `scripts/harness/core.mjs`의 digest, `.codex/harness-state/F44-coordinator.json`, sibling F43의 HTML/verify/serve/result 읽음. 기본 분기는 before/current 파일 복사, `--verify`는 baseline과 이전 사본 대조 | 최종 inline HTML 화면 검토에는 불필요. 당시 보호 baseline과 prepare 보존 검사를 재현할 수 없음 | 재현 목적 확정 시 스크립트 읽기 사본 및 비밀/개인 상태를 담지 않는 baseline 대체 근거의 제공 범위를 제안. harness-state를 묵시적으로 포함하지 않음 |
| `integrate.mjs` | `contributions/settings.html`, `notes.html`의 CSS/JS를 읽어 current `index.html`에 삽입·작성 | 이미 통합된 HTML의 화면 검사는 조각 없이 계획 가능. 동일 통합 생성 이력/조각별 출처·반영 누락은 재현 못 함 | 통합 출처 검토가 필요하면 2개 조각+integrate 읽기 사본. 기능 수정/재통합 실행은 별도 승인 |
| `serve.mjs` | `/`와 `/index.html`은 current, `/before`는 before HTML 제공. 127.0.0.1:4333 서버·detached child 시작 | F44 verify는 `file:` URL을 직접 열어 서버를 호출하지 않으므로 final HTML 검사 자체의 필수 의존은 아님. 당시 localhost route로 화면을 여는 재현은 빠짐 | localhost 관측을 재현할 필요가 있으면 읽기 사본·포트/프로세스 소유 조건 추가. 이번 서버 실행 없음 |
| `check-fragments.mjs` | 조각 1개 script·외부 저장/통신 패턴·`vm.Script` 구문검사. `runtime:'not-executed'` 출력 | 2개 조각이 없으면 조각 검사 대상 자체가 없음. 구문 유효성을 전체 화면/사용자 요구 통과로 바꿀 수 없음 | 위 2개 조각+check-fragments 읽기 사본을 제안. 대상 0건은 통과 아님 |
| `verify.mjs` | current `index.html` 또는 `--before`일 때 동일 dir의 `before/index.html`, Node/Playwright/Windows Chrome. evidence/runs에 JSON·PNG 작성 | final current 분기는 prepare/integrate/serve/조각을 직접 import하지 않음. `--before`는 relocated `F43-before/index.html`을 자동으로 찾지 못함 | 다음 승인에서 실행 위치·before 매핑·브라우저 경로·출력 경로를 명시해야 함. 읽기용 `.txt`를 이번에 실행 파일로 되돌리지 않음 |

`legacy4331/verify-redo.mjs.txt`의 `root=path.resolve(dir,'../..')`는 인계 경로에서 `materials`가 된다. 원래 root에서 읽던 `apps/mvp/style.css` 및 `참고자료/data_map_1790068571914.txt`, `data_map_1789115253930.txt`, `data_map_1789116164232.txt`, `data_map_1790068650885.txt`는 이 위치에 없다. d680 style 사본이나 원격 style을 자동 연결하면 검사 대상 버전이 바뀐다. 4개 업무 원천 자료는 승인상 제외된 민감 원문일 수 있으므로 무조건 복사/가공하지 않는다. 공개 가능한 구조 fixture 또는 별도 자료 제공 확인을 제안하고, 실제 원본 대조 검사의 제약을 유지한다.

`F43-before/verify.mjs.txt`도 `--before`에서 자신의 `before/index.html`을 찾는다. 이번 파일 배치는 원래 실행 폴더 복제가 아닌 버전별 열람 구조다. Node가 `.mjs.txt`를 원래 실행 진입점으로 취급한다고 가정하지 않으며, 읽기용 이름·경로 변경을 원문 코드 변경과 구별한다.

## 검사 종류와 출력

| 종류 | 예시 | 출력/한계 |
| --- | --- | --- |
| 정적 읽기·파일 대조 | 이번 import/경로/원문 읽기, SHA256 조회 | 소스·사본 정체성 근거. 브라우저·제품 런타임 근거 아님 |
| 산출물 없는 소스 검사 | P00 `mvp-typecheck`의 `tsc --noEmit`, `check-fragments`의 구문판정 | 대상 파일/의존이 필요. 이번 미실행. harness wrapper 자체 evidence/state와 구분 |
| 테스트와 개발 관측 | Vitest, Python 임시 DB 검사, 시안/제품 Playwright | JSON/PNG/downloads/cache/temp DB 등 쓰기 발생. 실제 제품·Native·나라장터 관측과 범위 다름 |
| 빌드·배포 산출물 | `build-mvp.mjs`, PyInstaller, `package-mvp.mjs`, installer | `dist/mvp-extension`, `dist/mvp-host`, `artifacts/mvp-pyinstaller`, ZIP, Native 등록 파일/registry. 이번 실행·인계 제외 |

`package.json`의 `verify:mvp`는 harness 명령으로 typecheck → test → MVP build → host build → Native test → UI test → package → archive test → verify를 연결한다. **순수 검사 명령이 아니다.** `package:mvp --build-host`도 EXE/ZIP 생성이며 읽기 대조로 취급하지 않는다. root `scripts/verify-mvp-ui.mjs`는 이미 빌드된 dist 5개 파일, 제공 JSON 및 mock transport를 필요로 하고 자체 localhost·PNG/JSON/download evidence를 만든다. 소스 주석도 실제 로그인/extension injection/Native SQLite 왕복을 범위 밖으로 명시한다.

## 기존 관측과 버전 대응

이번에는 result JSON의 상태/대상 수·hash와 현재 사본의 hash를 읽기 대조했다. `materials/local-guidance/docs/process/P00.md.txt`의 H02 기록도 과거 28/28을 기술 검사로만 보관하고 F44의 사용자 요구 충족·UI 수용·전체 완료 판정을 철회했다고 명시한다. 이 로컬 변경 사본을 원격 기준의 활성 정책으로 적용하지 않으며, 사용자 미수용 상태를 과거 JSON의 passed로 뒤집지 않는다. PNG의 화면 내용은 이 문서 작성자가 직접 검토하지 않았고 민감정보 검토 완료로 표시하지 않는다. 이미지/출처 검토는 [review.md](review.md)를 확인한다.

| 기존 자료 | 직접 확인한 상태 | 현재 사본과 연결 | 판정 범위 |
| --- | --- | --- | --- |
| `materials/observations/F43/result.json` | failed, 4개 check 중 1개 failed, quickNote를 샘플 리모컨이 가로막은 timeout | HTML hash `55f4c7bda235836d1d7120357f254efc14da0f089403b2c2eecc388c9da37212`는 F43-before HTML과 일치. JSON에 verifier hash 없음 | 역사적 실패. 당시 검사기 정체성·현재 재현은 별도 |
| `materials/observations/F44-2026-10-04T13-14-31-702Z/result.json` | failed, 25개 check 중 1개 failed, `#f45CancelUser` 화면 밖 timeout | HTML `8e1c848e...`, verifier `50b9f2c7...`는 현재 인계 F44 hash와 다름. 당시 해당 쌍 사본 미확보 | 역사적 실패 보고. 현재 버전 실패 재현 또는 통과 근거 아님 |
| `materials/observations/F44-2026-10-04T13-34-50-097Z/result.json` | passed, 28개 check, failed 0 | HTML `3768e54e7d9124de0fc862893f4a170613f17a6f065cea2dff808419c839441f`, verifier `26689568f3241fa78743cfc441c8e1800a82aa4d087869bafedb4fbec2d7b497`는 인계 F44 및 직접 읽은 원본 F44와 일치 | 해당 과거 합성/시안 검사 결과의 파일 정체성 확인. 새 실행·23개 요구 수용·실제 제품 검증 아님 |

날짜가 있는 run 이름과 JSON 경로는 원래 관측을 연결하는 근거다. 단축 hash 표기의 전체 값은 원본 result/manifest에서 보존한다. 인계 시각은 기존 검사 실행 시각과 별개다.

## 추가 필요 자료와 미확인 상태

1. **실행 환경:** 클라우드 OS/설치 정책·Node/npm/Python·Playwright browser·읽기/출력 권한·네트워크 접근. 현재 미접근이며 이번 설치·실행 승인 없음.
2. **시안 재현:** browser 경로와 before 매핑 확정. prepare 보존·조각 검사/통합 이력을 검토할 목적이면 위 4개 스크립트와 2개 조각의 읽기 사본이 추가 필요. 단일 최종 HTML 검사의 직접 의존과 이력 검사의 의존을 구분한다.
3. **legacy 원본 대조:** 원래 style 버전과 업무 JSON 4개의 공개 가능 대체 자료/제공 방식 확인. 원문 업무 자료를 로그·fixture에 복제하지 않음.
4. **d680 제품 실행:** 커밋에 맞는 plugins·Native·설정·검사 및 빌드 계약의 추가 범위 확인. 현재 active remote 코드에 d680 파일을 덮어쓰기하거나 Native를 임의 추가하지 않음.
5. **역사적 F44 실패:** `8e1c848e...` HTML과 `50b9f2c7...` 검사기 쌍의 당시 사본. 현재 자료에서 미확보.
6. **실제 제품 수용:** 실제 Chrome/Edge·확장 ID·Native 등록/왕복·나라장터 화면 및 Studio lite 연결 환경. 실제 업무 DB/문서/인증정보/개인 상태/배포 ZIP은 이 공개 인계에서 제외.
7. **훅·모델:** 실제 지원 버전·trust·hook 로딩/차단·실제 모델 관측. 이번에 root inherited 설정을 활성 적용/신규 등록하지 않음. 설정 작성과 실행 관측은 별개.

## 요구별 처리 결과와 직접 검사 근거

| N13-H1 요구 | 유지/변경/추가/미구현 | 실제 근거 |
| --- | --- | --- |
| 3절 cloud-readiness 문서 | 추가 | 이 문서에 런타임·경로·Windows·조건부 실행 범위 기록 |
| 4절 지침·훅의 읽기 전달 | 유지, 실행 미구현 | root 설정과 local-guidance `.txt` 대조; hook 설치/등록/실행 없음 |
| 5절 제품/시안 버전 보존과 제외 의존 확인 | 유지, 정적 분류 추가 | d680 17개 파일 import/HTML 참조, 원본 F44 5개 스크립트와 copied 3버전 검사기 읽음 |
| 7절 관측을 현재 검증과 구분 | 유지, hash 연결 추가 | 3개 result JSON 상태와 F44 source/copy hash 대조. 새 검사 없음 |
| 8절 경로·case·Native·민감자료 | 유지, 환경 미확인 | Windows 고정 경로·HKCU·MV3 권한·snapshot 외부 import 확인. 업무 원문/DB 복사 없음. 이미지 민감정보 검토는 본 작성자 미실시 |
| 10절 준비와 실행/수용 구분 | 유지, 실행 가능/제품 검증 미구현 | 클라우드 접근/설치/로딩/runtime/user acceptance 근거 없음 |

독립 검토는 작성자의 이 대조와 별도다. [review.md](review.md)의 실제 검토 대상과 미접근 범위를 기준으로 판단한다. 문서 추가 완료를 제품 검증 완료로 확장하지 않는다.

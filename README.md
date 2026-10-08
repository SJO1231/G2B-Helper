# G2B Helper

현재 개발 대상은 **Chrome/Edge MV3 수동 추출·수집·Grid MVP**입니다. 이전 전체 제품 요구와 두 HTML 검토본은 보존하며 자동수집·메모/일정·HWPX·탐색기는 이번 범위에서 보류합니다. 최신 요구는 [MVP 기준](docs/MVP.md), 작업·검증은 [M01](docs/process/M01.md), 하네스 승인과 명령은 [P00](docs/process/P00.md)에 기록합니다.

## 빌드와 실행

```powershell
npm ci
npm run build:mvp
```

1. Chrome `chrome://extensions` 또는 Edge `edge://extensions`에서 개발자 모드 → 압축해제된 확장 로드 → `dist/mvp-extension`을 선택합니다.
2. 확장 ID를 복사합니다. ZIP을 풀어 사용하는 경우에도 확장 폴더 경로를 변경하지 않는 편이 좋습니다.
3. 제공된 Native Host 폴더를 유지하고 다음 설치 명령을 실행합니다. HKCU에 해당 확장의 Native Host만 등록합니다.

```powershell
./scripts/install-mvp-host.ps1 -ExtensionId '복사한32자리확장ID'
```

Host가 아직 없으면 먼저 `.venv`의 Python과 PyInstaller로 `./scripts/package-mvp.ps1 -BuildHost`를 실행합니다. 제품은 상주 서버를 띄우지 않고 확장이 필요할 때 Native Messaging으로 실행합니다. 기존 PCE DB를 열지 않으며 기본 저장 위치는 `%LOCALAPPDATA%/G2BHelper/mvp.sqlite3`입니다.

나라장터를 열면 작은 리모컨이 표시됩니다. 확장 아이콘으로 다시 열 수 있습니다. 추출은 보기 전용 임시 표, 수집은 지정 URL·동일 프레임 화면 코드·업무번호/차수를 검사한 뒤 SQLite에 저장합니다. 수집 대상 화면의 추출 표에서는 ‘저장’이 수집입니다. 기본 추출은 `tables`만, `설정 → 표시 → 추출`에서 전체로 변경할 수 있습니다. 원본 확인에서는 pointInfo도 유지됩니다.

JS 런처는 확장 상세 페이지의 ‘사용자 스크립트 허용’ 설정이 필요합니다. 설정에서 입력하는 단축키는 리모컨이 있는 페이지에 적용됩니다. 브라우저 전체 단축키는 확장 프로그램의 단축키 화면에서도 지정할 수 있습니다. 기본은 수집 Alt+Shift+S, 문서 연결 Alt+Shift+D입니다. 문서는 선택한 자료를 실행 중인 Studio lite의 연결 서식으로 보내 HWPX 파일을 만듭니다. 업무별 서식은 설정의 ‘문서 연결’에서 지정합니다. [Chrome userScripts 공식 설명](https://developer.chrome.com/docs/extensions/reference/api/userScripts)

## Grid

헤더의 필터 버튼과 우클릭으로 필터·표시명·타입·숨김을 지정합니다. 숨김 열은 Grid 행 번호 머리글의 ‘속성’(열 분류 탭)에서 복원하고, 열 필터는 검색 옆 ‘필터 해제’로 한 번에 지웁니다. 원천 키·원값은 사전 표시명과 분리됩니다. 사용자 열은 공통 숨김/표시 버튼이 있습니다. 컬럼 표시명은 ‘컬럼 저장’, 사용자 열 편집과 정의는 ‘저장’으로 반영합니다. 원천 열은 읽기 전용입니다. 실패한 입력은 현재 창에 유지됩니다. 사용자 열 삭제는 표시 정의를 제거하며 기존 저장값은 보존합니다. 저장값의 영구 삭제·삭제한 열 복원 UI는 이번 MVP에 포함하지 않습니다.

DB는 접수·입찰·계약을 구분하며 기본 최근 3개월 날짜 필터와 ±1년 이동을 제공합니다. 자동으로 확정할 날짜 열이 없으면 선택 후 적용합니다. 계약은 종결 버튼/필터, 지정일−납품기한 지체일수, 계약금액−종결금액 미종결금액, 선금보증기한/금액을 제공합니다. 지체일수와 미종결금액은 읽기 계산값입니다.

## 검증과 경계

```powershell
npm run verify:mvp
```

단위·SQLite·Native 프레임·제공 JSON 구조·Playwright 화면 검증을 실행합니다. 검증 명령은 Windows Host도 빌드하므로 프로젝트 `.venv`와 PyInstaller가 필요합니다. UI 검사는 합성 자료와 로컬 참고 JSON을 구분합니다. Playwright는 개발 도구이며 제품 기능에 포함하지 않습니다. 실제 나라장터 로그인 화면 및 Chrome/Edge와 설치 Host의 실제 연결은 별도 수동 검증입니다. 로컬 참고자료는 배포 ZIP과 Git 업로드 대상에서 제외합니다. 보존하는 원본 JSON은 WebSquare에서 읽은 수집 결과이며 HTTP 응답 원문을 뜻하지 않습니다.

`prototypes/table-flow`와 `prototypes/features/grid`는 기존 검토본입니다. 최신 MVP와 기능 완료 상태를 혼동하지 않습니다. 모델 추천/구성/실제 호출도 P00에서 구분합니다. Astra가 필요하면 자동 전환하지 않고 사용자 지시를 기다립니다.

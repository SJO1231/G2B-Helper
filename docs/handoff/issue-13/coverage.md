# #13 요구별 자료와 검증 가능 범위

대응 요구 원문은 [requirements.md](requirements.md)에 있다. 이 문서는 **정적 읽기 대조**와 기존 기록을 연결한다. 제품·시안·검사기·빌드·훅은 이번에 실행하지 않았다. 경로는 이 인계 디렉터리 기준 상대 경로이며, 파일 출처·수집 시각·SHA256의 전체 목록은 [manifest.json](manifest.json)을 따른다. 코드 위치는 관련 구현을 찾기 위한 후보와 확인된 선언이며, 원요구를 충족했다는 판정이 아니다.

## 버전별 확보 자료

| 자료 ID | 실제 경로·출처 | 읽기에서 확인한 내용 | 한계 |
|---|---|---|---|
| P | [materials/product-d680/apps/mvp/](materials/product-d680/apps/mvp/) | 별도 제품 스냅샷 17개: background.ts, bridge.ts, contracts.ts, extractor.ts, grid-model.ts, grid.css, grid.ts, icons.ts, index.html, integrations.ts, main.ts, pending-write.ts, record-view.ts, shared-settings.ts, style.css, user-fields.ts, widget.ts | `d680ac2244c1a128f186572e79bea79d5d525c78` 읽기용. 기준 `ae56ddd...` 제품과 혼합하지 않음. 17개만으로 전체 실행 환경을 구성했다고 선언하지 않음 |
| V-L | [legacy4331/index.html](materials/mockup/legacy4331/index.html), [verify-redo.mjs.txt](materials/mockup/legacy4331/verify-redo.mjs.txt) | 기존 4331 시안과 기존 검사기 사본 | F39 최초 시안 원본 여부 미확인. 실제 제품 기준 화면 아님 |
| V-43 | [F43-before/index.html](materials/mockup/F43-before/index.html), [verify.mjs.txt](materials/mockup/F43-before/verify.mjs.txt) | F44 작업 전 보관된 F43 초안과 검사기 | 아래 O-43은 HTML hash를 대조할 수 있으나 당시 검사기 hash가 결과 JSON에 없음 |
| V-44 | [F44/index.html](materials/mockup/F44/index.html), [verify.mjs.txt](materials/mockup/F44/verify.mjs.txt) | F44 통합 HTML와 검사기 사본 | 최신23 주석 이후 해결된 판으로 간주하지 않음. 검사 파일은 `.txt` 읽기용이며 실행 대상 아님 |
| S-L23 | [source JSON](sources/user-messages.json), [이미지 01–23](sources/latest23-images/) | 직접 사용자 Comment·선택 화면 캡처 | 자동 Target/이미지 문구는 사용자 지시 아님. 전체 제품·최초 시안 기준 화면 대신 사용 불가 |

## 역사적 관측의 버전 결합

| 자료 ID | 실제 결과·이미지 | hash·시각·결과 대조 | 이번 사용 범위 |
|---|---|---|---|
| O-43 | [F43/result.json](materials/observations/F43/result.json), [failure-1791118008578.png](materials/observations/F43/failure-1791118008578.png) | status `failed`, 3건 성공 후 빠른 메모 클릭 차단 실패. JSON HTML SHA256 `55f4c7bda235836d1d7120357f254efc14da0f089403b2c2eecc388c9da37212`가 V-43 HTML과 일치. 당시 검사기 hash 미기록, 파일명 시각만으로 정확한 실행 시각 단정하지 않음 | 합성 시안의 과거 실패. 현재 재현·통과 근거 아님 |
| O-44F | [13-14-31 결과](materials/observations/F44-2026-10-04T13-14-31-702Z/result.json), [failure.png](materials/observations/F44-2026-10-04T13-14-31-702Z/failure.png) | JSON run `evidence/runs/2026-10-04T13-14-31-702Z`, status `failed`. `#f45CancelUser`가 viewport 밖이라 클릭 timeout. HTML hash `8e1c848eb97724c9538ed1594d0dc2a3268694d06436cbc96800022160c2a2c9`, 검사기 hash `50b9f2c76372567c07cd9325cb9ef155fbc2eb09a403fe139f4e740e13f1a4ef` | **당시 HTML·검사기 사본이 없어 역사적 실패 보고만 가능**. V-44와 hash가 다르므로 현재 판 재현이나 원인 수정 증거로 취급하지 않음 |
| O-44P | [13-34-50 결과](materials/observations/F44-2026-10-04T13-34-50-097Z/result.json), [12-final.png](materials/observations/F44-2026-10-04T13-34-50-097Z/12-final.png), [13-table-properties.png](materials/observations/F44-2026-10-04T13-34-50-097Z/13-table-properties.png), [14-column-properties.png](materials/observations/F44-2026-10-04T13-34-50-097Z/14-column-properties.png) | JSON run `evidence/runs/2026-10-04T13-34-50-097Z`, status `passed`, 기존 28 checks. HTML `3768e54e7d9124de0fc862893f4a170613f17a6f065cea2dff808419c839441f`, 검사기 `26689568f3241fa78743cfc441c8e1800a82aa4d087869bafedb4fbec2d7b497`가 V-44 사본 hash와 각각 일치 | 과거 합성/DEMO 기술 검사 기록. 그 이후 사용자 기능 누락·임의 버튼·배치 거부가 있으므로 요구 충족·UI 수용·전체 완료 판정은 철회된 상태. 이 28/28을 최신23 통과로 재사용하지 않음 |

원본 실제제품 기준 화면과 최초 F39 시안 원본이 확인되지 않아, 첨부·선정 PNG와 버전별 HTML의 시각/기능 차이를 **원본 보존 완료**로 판정할 수 없다. 결과 JSON의 동일 hash는 실행 대상 파일 결합 근거이며 사용자 수용의 증거가 아니다.

## 요구별 대응

P 파일명은 모두 `materials/product-d680/apps/mvp/` 아래다. V-L/V-43/V-44는 위 표의 실제 HTML·검사기다. 기존 검사의 `C01`, `C17`, `C18` 등은 그 검사 작성 당시 namespace이며 **L23-C01, L23-C17, L23-C18과 일치하지 않는다**. 검사명이 일부 주제를 다뤄도 최신 사용자 Comment의 수용 기준을 대신하지 않는다. 전 행의 동작 실행은 이번에 미검증이다.

| 요구 ID | 관련 코드·시안 위치 | 화면·기존 검사·역사적 근거 | 누락 / 정적대조·동작 상태 |
|---|---|---|---|
| L23-C01 | P main.ts/style.css; V-44 `settingsContent`, 테마 그룹 | source 이미지 01; 기존 V-44 `Narrow settings/sidebar/remote fit` | 정적 영역·CSS 대조 가능. 최종 치수·원본 기준 배치 미확정; 동작/화면 실행 미검증 |
| L23-C02 | P main.ts; V-44 설정 데이터 그룹·데이터 관리 | 이미지 02; 기존 `C14 trash/backup co-located` | 중복 UI 존재·접근 후보 정적대조 가능. 삭제/이동 확정 없음 |
| L23-C03 | V-44 설정 구획·정렬 CSS | 이미지 03 | 캡처 선택선 확인. 기준 컨테이너 미확정이라 정렬 충족 판정 불가 |
| L23-C04 | P main.ts 문서 연결; V-44 Studio 안내 | 이미지 04 | 문구의 정적 대조 가능. 기능 보존은 M11 실행 자료 부족 |
| L23-C05 | P main.ts 데이터/휴지통; V-44 데이터 관리 | 이미지 05 | 비판 원문 확보. 대체 동작과 기준 빈 상태 미확정 |
| L23-C06 | P main.ts/bridge.ts; V-L·V-43·V-44 데이터 관리 | 이미지 06; 기존 `C14` 시안 백업/복원 검사 | 버전 간 HTML 항목 정적 비교 가능. 레거시 기능·예외 전체 기준, 실제 제품 화면 미확보 |
| L23-C07 | P widget.ts 리모컨; V-44 `remoteSchedule`·관련 메모/일정 | 이미지 07; 기존 `C07 remote schedule below button` | 기존 검사는 선행 요구. 최신 옆으로 띄우는 버튼 동작·최종 배치 미확정·미실행 |
| L23-C08 | P widget.ts 49–51의 수집/추출/DB/문서·런처; V-L·V-43·V-44 리모컨 | 이미지 08; F-REMOTE 인간 거부; 기존 `C16 launcher button and hotkey` | 버튼 선언 정적 대조 가능. 실제 제품 기준 전체 배치·당초 기능/예외 목록 미확보 |
| L23-C09 | P grid.ts/grid-model.ts/grid.css; V-L·V-43·V-44 Grid | 이미지 09; 기존 `Original variant and item details` | 관련 코드 찾기 가능. “빠진 기능”의 완전 목록과 기준 화면 미확보 |
| L23-C10 | P grid.ts 440–453 소수 자릿수 입력·저장; grid-model.ts; V-44 금액 표시 | 이미지 10; 기존 `C01 display hides fractions without rounding or losing raw precision` | 제품 자릿수 UI 선언과 시안 고정 표시를 정적 비교 가능. L23 요구의 설정·변경·취소·원값/내보내기 반례 실행은 미검증 |
| L23-C11 | P grid.ts/grid-model.ts; V-44 Grid 필터·적용 | 이미지 11; 기존 `C18 filter label and semantics preserve search and source precision` | 필터 후보·표시명 정적 비교 가능. 최신 기대 결과·반례와 적용 실행 미확보 |
| L23-C12 | P grid.ts 252–304 속성; main.ts 설정; V-44 `f45Tables` | 이미지 12; O-44P 13-table-properties; 기존 `C19 properties classification tabs` | 설정 요소·탭·링크 정적 대조 가능. 최신 비판 뒤 해결 판정 불가; O-44F는 다른 hash의 역사적 실패 |
| L23-C13 | P grid.ts 속성; V-44 `f45Columns` | 이미지 13; O-44P 14-column-properties; 기존 `C19` | 열분류 요소 정적대조 가능. 사용자 대체 구성 미결정·동작 미실행 |
| L23-C14 | V-44 `quickBody`·빠른 입력 안내 | 이미지 14; 기존 `C04-C09 sidebar...quick/body-only screen memo`; O-43 클릭 차단 | 안내 정적 대조 가능. 빠른 메모 원본 동작 수용 여부 미확인 |
| L23-C15 | V-44 `calendarToggle`·관리자 메모/일정 탭 | 이미지 15; 기존 `C06 monthly/week/day calendar` | 이벤트/종속 전환 정적 대조 가능. 독립 접근 기준 화면·기대 동작 미확정 |
| L23-C16 | V-44 `calendarView .calendar-tools`·CSS | 이미지 16; 기존 `C06`; O-44P 화면 | 정렬 선언 정적대조 가능. 기준 컨테이너·viewport별 시각 결과 미검증 |
| L23-C17 | V-44 `calendarGrid` 날짜/기간 선택 | 이미지 17; 기존 `C06...range schedule selection`, `C20...period and Eisenhower views` | 선택 로직 읽기 가능. 클릭/다중선택/기간 반례·원본 기대 계약 미확보 |
| L23-C18 | V-44 `manager` dialog·CSS | 이미지 18; 기존 `Narrow settings/sidebar/remote fit` | 높이 선언 정적 비교 가능. 맞출 기준 높이 미확정·실화면 미검증 |
| L23-C19 | V-44 일정 `manager-row`·CSS | 이미지 19; 기존 `C20 legacy metadata...` | 행 구조/정보 정적 비교 가능. 행 높이와 정보 생략 허용 미확정 |
| L23-C20 | V-44 `managerList` 편집 버튼 | 이미지 20; 기존 메모 편집/취소 검사 | 버튼 선언 정적대조 가능. 정확한 개선 결과 미확정·실행 미검증 |
| L23-C21 | V-44 `managerList` 휴지통 버튼 | 이미지 21; 기존 `C14 trash/backup...` | 버튼·휴지통 처리 읽기 가능. 복원까지 실제 제품 연동 미검증 |
| L23-C22 | V-44 메모 `manager-row`·CSS | 이미지 22; 기존 `C20 legacy metadata...` | 행 구조 정적대조 가능. 최종 두께·정보 보존의 사용자 수용 미확정 |
| L23-C23 | V-44 `f46LegacyLimits` 설명 | 이미지 23 | 설명 정적대조 가능. 문서·실패기록·레거시 기능 삭제는 승인 없음 |
| F-SETTINGS | P main.ts 설정 메뉴; V-L·V-43·V-44 | S-SETTINGS; V-L 검사기 126의 메뉴 목록; L23-C01/02/06 | 메뉴·그룹 대응 정적대조 가능. 최종 UI 수용 미확인 |
| F-FILTER | P grid.ts/grid-model.ts; V-44 | S-SETTINGS; 기존 V-44 `C18`; L23-C11 | 표시명·호출 후보 대조 가능. 기존 검색/필터/적용 보존 실행 미검증 |
| F-PROPERTIES | P grid.ts/main.ts; V-44 `f45Tables/f45Columns` | S-SETTINGS; 기존 `C19`; L23-C12/13 | 탭·직접 설정·설정 링크 차이 읽기 가능. 최신 요구 충족/동작 미검증 |
| F-SHARED | P shared-settings.ts/main.ts; V-43·V-44 공유 초안/이력 | S-SHARED; 기존 V-44 `C17` payload/충돌/적용/restore/취소 | 메모리 적용·되돌리기 계약 정적대조 가능. 실제 파일 동작은 승인 범위 밖; 동작 미실행 |
| F-REMOTE | P widget.ts; V-L·V-43·V-44 리모컨 | S-BUTTONS; L23-C07/08; 직접 임의 버튼 거부 | 선언된 기능 대조 가능. 당초 실제 제품·최초 시안 배치/기능 전체 미확보 |
| F-VERSIONS | V-L·V-43·V-44 각각의 HTML·검사기와 선정 결과 | S-VERSIONS; manifest의 출처·hash; O-43/O-44F/O-44P | 버전별 보관·hash 정적대조 가능. F39 원본과 O-44F 당시 사본 누락으로 모든 판 완전 보존 판정 불가 |
| M04 | P extractor.ts/contracts.ts/grid-model.ts/grid.ts; 원격/로컬 MVP 양쪽 문장 | requirements의 정확한 문장 두 개; 기존 검사 원천/정밀도 보존 항목 | 로컬 변경·원천 보존 코드 후보 정적대조 가능. 새 숨김 기본값 직접 결정 미확보, 전체 실행 미검증 |
| M11 | P integrations.ts/main.ts/bridge.ts/background.ts/pending-write.ts | 인간 recordLine 2991의 구현 계획 승인; 로컬 P00 D01/D02는 이전 공정 보고 | 전달/상태 분기 정적대조 가능. Native/Studio/HWPX 실제 통합 자료와 실환경 실행 미확보·이번 실행 금지 |

## 제외된 실행 보조 자료의 영향

V-44/F43 검사기 텍스트는 `@playwright/test`, `index.html`, 브라우저 설치, 쓰기 가능한 `evidence` 경로에 의존한다. V-44는 `--before` 선택 시 `before/index.html`도 필요하다. **복사된 상대 디렉터리와 `.txt` 이름은 원래 실행 구조가 아니며 직접 실행 가능하다고 주장하지 않는다.**

V-L 검사기는 `root=path.resolve(dir,'../..')` 기준 `apps/mvp/style.css`와 `참고자료/data_map_1790068571914.txt`, `data_map_1789115253930.txt`, `data_map_1789116164232.txt`, `data_map_1790068650885.txt`를 읽는다. 현재 자료 패키지의 `materials/mockup/legacy4331` 기준으로 이 경로 계약이 보존되었다고 확인하지 못했다. 참고자료에는 업무 정보가 있을 수 있어 조용히 복사하거나 fixture로 공개하지 않는다.

F44 `prepare/integrate/check-fragments/serve`와 contributions 조각 없이 **완성된 HTML/검사기 텍스트의 정적 검토**는 가능하다. 통합 재생성, 조각 검토, 보존 검사, 원래 서버 구조의 재현은 이 자료만으로 확인할 수 없다. 필요자료 목록은 [missing-materials.md](missing-materials.md)에 있다. 이번에 새 실행 스크립트를 만들거나 필요한 자료의 안전 검토를 건너뛰지 않는다.

자료 파일을 읽을 수 있다는 사실과 클라우드의 런타임·브라우저·Native·Studio 실행 가능성은 분리한다. 상세 실행 의존 경계는 [cloud-readiness.md](cloud-readiness.md)에서 다룬다. **정적 대조 가능 / 동작 실행 미검증 / 사용자 수용 미확인**이 현재 상태다.

# 확장 검증 보고서 — v4.1 형태·단순함 반영

2026-09-29 KST, `E:/PROGRAM/PCE`. 요구 기준은 EXTENSION_REQUIREMENTS.md, 요구별 현재 상태는 STATUS.md를 따른다. 과거 북마크릿 스냅샷은 `history/TEST_REPORT-bookmarklet-20260928.md`에 보존했다. 이번 UI 변경은 과거 v4.1 전체 복제가 아니며 SQL·CAS·원본 보존·백업 경계를 유지한다.

## 증거 구분

- 단위 검사: 조건·불변식·오류·원자성 검증. 브라우저의 실제 화면 조작과 구분한다.
- UI harness: 실제 Edge 렌더링과 실제 임시 SQLite Host를 사용하지만 Chrome 메시지 API는 모의 전달이다. 별도 테스트 페이지에서 기능 화면을 검수하므로 실제 iframe 통신의 증거는 아래 runtime 결과를 사용한다.
- 확장 runtime: 별도 Edge 프로필의 실제 MV3, scripting, 페이지 내부 확장 iframe, connectNative를 사용한다. 테스트 복사본에는 localhost 권한과 고유 Native Host 이름만 추가하며 사용자 프로필·생산 DB·기존 Host 등록을 변경하지 않는다.
- 실제 나라장터는 미실행. 제공 JSON은 구조 근거이며 현재 사이트 권한·화면 로딩 검증을 대신하지 않는다.

## 이번 실행 기록

`npm run verify`에서 TypeScript 16개 파일의 175개 테스트, 플러그인 경계 17개 소스, 확장 68개 입력 검사, 타입 검사 및 Vite/esbuild가 통과했다. Native 단위 검사도 이번 실행에서 45개 통과했다. 이후 스티커 배경·중복 상태문구 표시 수정 뒤 타입/빌드와 실제 runtime 16개를 다시 확인했다. UI harness 29개는 같은 DB 기능 버전에서 그 시각 수정 전에 실행한 결과다. 두 브라우저 경로는 서로 다른 증거이며 전체 사용자 요구의 합격 수가 아니다.

| 검사 | 근거·범위 |
|---|---|
| 경계·타입·회귀·빌드 | `npm run verify`: 플러그인 경계·확장 입력, 활성 확장 IndexedDB/localStorage 차단, TypeScript, Vitest 175개, Vite/esbuild |
| Native — 45개 통과 | `python -m unittest discover -s native/tests -v`: 제공 data_map 31개 포함, URL/화면·병합·차수·멱등·트랜잭션·SQL 제한·문서 CAS·백업 |
| UI harness — 29개 통과 | `scripts/verify-extension-browser.mjs`, `dist/evidence/extension/browser-results.json`, 기록 시각 2026-09-29 00:24:33 KST |
| 실제 확장/Native — 16개 통과 | `scripts/verify-extension-runtime.mjs`, `dist/evidence/extension/native-runtime.json`, 최종 기록 시각 2026-09-29 00:27:01 KST. `runtimeErrors=[]`, `rangeWarnings=[]`, `productionProfileModified=false` |
| 이전 Grid·작업실 — 36개 | `artifacts/ui-verification.json`, 2026-09-28 16:24 KST 실행. 기존 Workspace 24개와 보존 북마크릿 12개 경로다. 이번 확장 검증에 합산하거나 변경된 페이지 패널 재검수로 표현하지 않음 |

## UI harness에서 확인한 동작

340px 위젯·배경 페이지 사용·이동·접기/펼치기·시작/정지 UI, 임시 추출의 저장 없음·XLSX·0/false/코드 보존·명시 규칙 등록을 확인했다. 화면 메모의 SQL 저장/재열기, 기간 일정·달력·아이젠하워, 런처의 명시 추가·저장/재열기, 텍스트 및 HWPX 템플릿 SQL 저장/재열기와 생성 ZIP/XML, 레코드 연결 임시 폴더 생성을 검사했다.

DB는 클릭 선택·F2·Esc, 타이핑 시 편집 버퍼만 변경, Tab 확정/이동, 범위 복사/붙여넣기, CAS 저장과 재열기의 0/false 보존, 새로고침 시 미저장 폐기 확인, Import 미리보기의 쓰기 없음, 서버 필터를 검사했다. 스크린샷 `dist/evidence/extension/db.png`, `db-import.png`, `db-filter.png`는 이 테스트 경로의 화면 증거다. 스크린샷 자체가 실제 확장 설치 증거는 아니다.

## 실제 페이지 내부 확장에서 확인한 동작

실제 MV3 service worker와 isolated-world 위젯, MAIN-world 읽기, Native Messaging을 통한 SQLite 연결을 확인했다. 확장 iframe에서 쓴 값을 SQL로 재조회했으며 추출창이 원천 페이지 내부에서 열리고 열린 창 위에서도 위젯을 조작할 수 있음을 검사했다. URL 규칙 등록→수동 수집→검토/반영→정규화 SQL 재조회와 탭별 알람 시작/정지도 확인했다.

사전 Grid 편집·명시 CAS 저장·iframe 재열기와 실제 SQLite 재조회를 검사했다. 미저장 Grid의 창 닫기 취소는 편집 버퍼를 유지하고 SQL을 바꾸지 않았으며 명시적 폐기 후 재열기는 저장된 값을 읽었다. 기능창이 별도 브라우저 popup 없이 원천 페이지 안에 남고, 메모 카드와 해당 메모 스티커가 서로 다른 페이지 내부 창으로 함께 열림을 확인했다. 위젯 동작 오류, headerSort/range 경고, 잡히지 않은 페이지 오류는 기록되지 않았다.

최종 화면 확인에서 스티커를 옅은 노란 배경으로 정리하고 중복 연결 상태문구를 숨겼다. 오류 안내는 유지한다. DB·Import·필터·위젯·사전·메모/스티커 PNG 검토와 Impeccable 정적 검사 기록은 `V41_PARITY.md`의 최종 시각 확인 절을 따른다. 정적 검사는 `filter-group`의 2px 왼쪽 선 한 건을 감지했고 AND/OR 조건 계층 구분 용도로 유지했다. 경고가 전부 없었다고 표현하지 않는다.

## 변경과 보존

1. 별도 브라우저 새창과 DB의 전체 데스크탑 App 복제를 페이지 내부 iframe 창·좁은 표 탐색·빠른 탭·Grid 중심 화면으로 대체했다. SQL 조회·백업·관계·문서·폴더 경로는 유지한다.
2. 사전·수집 목록을 Grid로 확인하도록 정리했다. 설정과 원본 이벤트를 같은 자료로 취급하지 않는다.
3. 기본 Grid 동작은 클릭 선택 후 타이핑 편집이며 단일 클릭 편집은 선택 옵션이다. 미저장 닫기 확인과 CAS 실패 시 편집 유지 계약을 보존했다.
4. 메모는 본문 기본·제목 선택으로 정리하고 무제목은 본문 첫 줄을 표시한다. 검색·범위 필터와 작은 도구, 단일 SQL 메모를 여는 스티커 경로를 추가했다. 창 닫기는 데이터 삭제 버튼과 별개다.
5. v3/v4 피드백의 간결한 형태를 반영했지만 원본 IndexedDB/eval 실행 방식을 재도입하지 않았다. 사용자 데이터는 기존 SQLite Gateway를 사용한다.

## 이전 문제 해결 기록

추출 자료형 오판·1,000행 이후 레코드 누락·저장 중 전환 경합, HWPX CAS와 ID 검사, 기본/사용자 규칙 합집합의 원본 행 보존, 같은 frame의 URL/화면 조건, 자동 정지 후 후속 전달 차단을 이전 구현에서 수정했다. 이미 Native에 전달한 저장은 완료될 수 있다는 상태 구분을 유지한다.

이전 실제 Native 연결 검사에서 CMD 래퍼는 통신 오류가 발생했고 EXE 직접 등록으로 연결되어 설치 도구가 EXE를 사용하도록 정정했다. CMD 실패의 모든 환경별 원인을 규명했다는 주장은 하지 않는다.

## 미완료·미검증

- v5 이벤트/직링크 전체 분석, 런처 정렬·설명·화면 규칙 저장의 전체 동작은 미완료다.
- 반복·알림·칸반·다중 드래그와 메모 색상·상단 고정의 지속 설정은 남아 있다. 기본 메모 스티커 창을 전체 일정·스티커 기능 완료로 보지 않는다.
- 실제 나라장터 조회·Excel 다운로드·화면 감지, 사용자 Chrome 설치·조직 정책, 한글 인쇄 렌더링, 실제 외부 앱 실행, 장시간 운영·대량 성능은 별도 검증이 필요하다.
- OS 탐색기 열기는 harness에서 stub이다. 실제 임시 폴더 생성과 OS 창 열기를 같은 결과로 표현하지 않는다.
- Vite의 큰 공용 번들 경고가 남는다. 전체 1·2·3차 완료를 주장하지 않는다.

## 배포 상태

새 설치 ZIP은 `dist/PCE-extension-0.3.0.zip`이며 `dist/evidence/extension/package.json`에서 75개 항목과 75개 파일 검증을 확인했다. 생성 도구는 ZIP 재개봉·필수 경로·파일 해시를 검사했다.

- SHA-256: `343CA3AB6F102ABC98A9128B21C960A5D2EF81B244E8568E5F431E42A3D4E53F`.
- 기존 0.2.0의 74개 파일·해시는 이전 배포 기록이며 이번 결과로 대체한다.
- 실제 사용자 Chrome의 운영 Native Host 등록은 수행하지 않았다. 테스트용 격리 프로필과 실제 사용 환경의 설치 완료를 구분한다.

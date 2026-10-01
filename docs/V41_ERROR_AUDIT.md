# v4.1 전환 — 첨부 오류 자료 확인

검사일: 2026-09-29. 첨부 원본은 수정하지 않았다.

## 확인한 증거

- 대상: 사용자 첨부 `f472adeb-cc0b-4a65-a8ac-04691a229f45/붙여넣은 텍스트.txt`.
- 파일 크기 1,244,101 bytes, UTF-8 텍스트 1,236,921자. 앞 176줄은 `1`부터 `176`까지의 줄 번호다.
- 뒤의 JavaScript에서 후행 공백만 제외하면 당시 `dist/extension/assets/App-B2h2_ta0.js`와 **1,236,323자 전체가 동일**하다. SHA-256: `a4e5ac8d424edd69513a33b3486dd057e5532ac4d7e167efdabdb8601d347dd9`.
- 실제 오류 제목·메시지·발생 위치·오류 스택은 코드와 별도로 포함되어 있지 않다. 검색된 `Error`, `Uncaught` 등은 React·Tabulator·SheetJS가 번들에 포함한 코드 문자열이다.
- 파일 내 대체 문자 U+FFFD는 0개다. 터미널 CP949 출력 중 일부 문자가 깨져 보이는 현상은 첨부 파일의 인코딩 손상을 증명하지 않는다.
- Python `splitlines()`는 번들의 문자 매핑표 안에 있는 U+0085도 줄 경계로 취급한다. LF만 기준으로 줄 번호를 제거하고 다시 비교하여 완전 일치를 확인했다.

## 판단과 한계

첨부는 빌드된 소스를 복사한 자료다. 이 자료만으로 사용자가 경험한 런타임 오류의 원인을 확정할 수 없었다. 코드에 오류가 없다는 결론도 아니다. Root가 오류 제목·메시지와 발생 동작을 별도로 요청했다.

## 후속 사용자 확인으로 특정한 경고

사용자가 `feature.html?surface=db`에서 다음 경고를 확인했다.

> Using column headerSort with selectableRangeColumns option may result in unpredictable behavior. Consider using headerSortClickElement: 'icon'.

설치된 Tabulator 6.5.0의 `node_modules/tabulator-tables/dist/js/tabulator.js:27006`에 동일한 경고가 있다. 공용 `plugins/grid/index.tsx`는 열 범위 선택(`selectableRangeColumns:true`)과 헤더 정렬(`headerSort:true`)을 함께 켰다. 정렬 클릭 대상을 별도 지정하지 않아 같은 헤더 조작에 범위 선택과 정렬이 겹치는 구성이었다. 공용 Grid는 정렬 클릭을 아이콘으로 한정하는 `headerSortClickElement:'icon'` 설정으로 수정했다. 이 경고 자체는 SQLite 손상이나 데이터 소실 증거가 아니다. 수정 후 경고 제거와 열 선택·정렬·편집의 실제 동작 검증 결과는 최신 검증 보고서에 별도로 기록한다.

## 페이지 내부 iframe 전환 관련 확인

기존 `background.ts`는 `sender.url`이 확장 URL인 경우 확장 화면으로 판별한다. `sender.tab.id`가 존재한다는 이유만으로 읽기 전용 페이지 위젯으로 전환하지 않는다. `feature.html?sourceTabId=...`의 ID를 `transport.ts`가 명령에 전달해야 한다. 누락하면 원본 탭 ID 오류로 중단하고 활성 탭을 임의로 수집하지 않는다.

독립 회귀 `tests/extension-iframe-context.test.ts`에서 모의 Chrome sender를 사용해 4개를 확인했다: iframe 명시 탭으로 추출, 탭 ID 누락 시 추출 전 차단, iframe SQL 저장 명령 전달, 페이지 위젯의 거짓 탭 ID 무시. 2026-09-29 00:05 실행에서 4개 통과. 이는 라우팅 코드 검증이며 실제 Chrome iframe의 권한·CSP·DOM 동작 검증을 대신하지 않는다.

## 실제 확장 검수 중 발견한 추가 문제

격리된 Edge MV3 확장과 임시 Native Host를 연결해 실제 SQL 저장·재열기를 검수했다. 사용자의 나라장터 대신 로컬 합성 WebSquare 페이지를 사용했고 운영 브라우저 프로필·Native 등록·DB는 수정하지 않았다.

- 내부 추출 창이 위젯 버튼을 가리는 것을 실제 클릭의 pointer-intercept 오류로 재현했다. 메인은 위젯을 상단에 두고 창의 기본 폭을 옆 가용 공간에 맞췄다. 후속 빌드에서 추출 창을 연 채 위젯 DB·업무 탭을 실제 클릭해 회귀 통과했다.
- 메모 SQL 저장·재열기, 추출·규칙 등록, 수동 수집 검토·반영, `01`·`0`·`false` 재조회, 자동 시작·정지, 사전 Grid CAS 저장·재열기, 미저장 닫기 취소·폐기, 카드와 스티커 동시 열기를 검수했다. 헤더 정렬 경고와 uncaught page error는 없었다.
- 마지막 스크린샷에서 `Error: 업무 동작 종류를 확인하세요.` 상태를 발견했다. `.window-bar` 버튼 클릭이 같은 ShadowRoot의 위젯 click 핸들러로 버블링되어, `data-do`가 없는 내부 창 버튼을 `work.action {kind:undefined}`로 보내는 코드 경로를 확인했다. SQL 저장 실패를 의미하지는 않지만 정상 동작으로 보고할 수 없다. 메인 담당자에게 클릭 처리 경계를 요청했고 검수에 위젯 오류 상태 검사를 추가했다.

최신 실행 증거는 `dist/evidence/extension/native-runtime.json`, `native-widget.png`, `native-notes-sticky.png`다. 위젯 클릭 경계 수정 뒤 최종 재검수 결과는 아래에 갱신한다. 실제 나라장터 접근·CSP 검증은 별도다.

### 최종 재검수

2026-09-28T15:24:58.665Z 실행에서 **16개 실제 런타임 검수 통과**. 내부 창 버튼을 위젯 명령 처리에서 제외한 최신 빌드를 사용했다. 위젯 업무 오류 상태 없음, `runtimeErrors: []`, `rangeWarnings: []`를 확인했다. 두 PNG를 직접 열어 사전 Grid, 메모 카드·스티커·위젯 동시 표시와 오류 메시지가 사라진 상태를 확인했다. 실제 나라장터 화면 검증을 완료했다는 의미는 아니다.

스티커의 중복 상태 표시·배경 보완 후 2026-09-28T15:27:01.195Z 실제 runtime 16개 재실행도 통과했다.

# 확장 0.4.0 검증 보고서

2026-09-29 KST. 최신 기준은 `UI_REVISION_20260929.md`, 구현 상태는 `STATUS.md`다. 이전 결과는 `history/TEST_REPORT-extension-0.3.0.md`에 보존했다.

## 최종 실행

| 검사 | 결과 | 범위·근거 |
|---|---|---|
| `npm run verify` | 통과, 02:15 | 플러그인 경계18·활성 확장 입력76·타입·TS222개/19파일·Vite/esbuild. IndexedDB/localStorage 업무 저장 없음 |
| Native unittest discover | 51개 통과, 02:15 | area/URL/frame·원본/표 ID별칭·참조/CAS·롤백/멱등·SQL 제한·백업·사전 이관·폴더 경계 |
| `test:extension:ui` | 34흐름 통과 | `dist/evidence/extension/browser-results.json`: 실제 Edge+임시 SQLite, Chrome 전달은 하네스 |
| `test:extension:runtime` | 19흐름 통과 | `native-runtime.json`: 실제 MV3·scripting·iframe·connectNative·SQL. 별도 Edge 프로필/고유 임시 Host/합성 WebSquare 화면 |
| `test:extension:notes` | 13흐름 통과 | `notes-v4-results.json`: 자동저장·IME/동시수정·응답유실 동일ID재시도·휴지통/복원·기간 일정·보기 |
| `test:extension:launcher` | 9흐름 통과 | `launcher-v4-results.json`: 종류 탭·추가/수정·CAS·dirty·갱신 실패와 저장 성공 구분. 실제 위젯 수신은 runtime에서 별도 확인 |
| `test:extension:collection` | 11흐름 통과 | `collection-aggregation-results.json`: 추출 표·다중파일 헤더/취합·0/false/선행0·오류시 미반영·관찰 보관 |
| `test:extension:database` | 11흐름 통과 | `dist/evidence/database/results.json`: 빈행 입력/자동보충·헤더+·Decimal수식·무효수식 이전값·클립보드·그룹/관계·테마 |
| Native Host PyInstaller | 통과, 02:15 | 최종 collector.py를 포함해 `dist/desktop-v4/PCE.NativeHost` 재빌드. 실제 runtime은 이 EXE로 실행 |

위 숫자는 서로 중복되는 검사 흐름 수다. 전체 사용자 요구의 완료 개수로 합산하지 않는다. Vite 공용 번들 크기 경고(약1.2MB)와 transport 동적/정적 import 경고는 남아 있으며 빌드 오류는 아니다.

## 확인한 동작

- 버튼 순서·조회건수 목록/숫자 입력, 테마 SQL 저장과 열린 위젯 반영, 런처 저장 직후 실제 버튼 표시.
- URL+areaCd14+depth1+depth2 기본 수집, 사용자 등록 조건 유지, 수동/자동 탭 범위와 알람 정지, 수집→검토→반영→재조회.
- 동적 WebSquare component ID와 getOriginalID 대응, 기존 규칙 별칭, 빈값/0/false/원본 출처 보존.
- 복수 Excel의 모든 헤더 승인 전 무쓰기, 같은 헤더 누적, 불일치 파일이 있으면 부분 취합하지 않음.
- 사전 Grid의 미저장 닫기 취소·명시 폐기·SQL 재열기. 기본 사전은 사용자 항목을 덮어쓰지 않고 한 번 이관.
- 텍스트/HWPX 템플릿 SQL 재열기·앵커·생성 ZIP/XML. 문서 목록↔상세의 미저장 초안 보존.
- 레코드 A 폴더의 늦은 응답이 레코드 B 목록을 덮어쓰지 않음. 경로 탈출 차단.
- 흰색/검정 DB, 추출/취합/수집, 작은 스티커, 페이지 내부 위젯을 PNG로 직접 확인. Tabulator headerSort/selectableRange 경고 및 실제 runtime 미처리 오류 0.

## 근거와 한계

제공된 `참고자료/data_map*.txt` 31개는 구조 근거이며 변경하지 않았다. 화면메타 집계에서 모두 areaCd14를 확인했다. 최신 원천 사이트의 권한·로딩·다운로드는 별도 실기 검증이 필요하다. 합성 WebSquare 화면과 Chrome 메시지 하네스를 실제 나라장터 검증으로 표시하지 않는다.

실제 MV3 검사는 localhost 권한과 테스트 Native Host 이름만 바꾼 확장 복사본, 분리 Edge 프로필/임시 SQL을 사용했다. 사용자의 실제 Chrome 프로필이나 업무 DB·기존 Host 등록은 변경하지 않았다. 기존 빌드 폴더의 사용 중 라이브러리 잠금으로 새 Native 출력은 desktop-v4로 분리했고, 기존 desktop/PCE.NativeHost는 이전0.3 배포본과60개 파일 해시 일치를 확인했다.

OS 프로그램 열기, 실제 나라장터, 한글 인쇄 배치 재현, v5 gfnExecute/XHR/fetch 전체 추적, 남은 2·3차 기능은 이번 합격 범위가 아니다.

UI 참고는 원본 v3/v4/v4.1와 [Google Keep 정리 동작](https://support.google.com/keep/answer/6191044?co=GENIE.Platform%3DDesktop&hl=en), [Sticky Notes 직접 입력](https://support.microsoft.com/en-gb/windows/apps/stickynotes/create-a-sticky-note)이다. 본문 직접 편집·색·중요 고정 원칙만 참고했고 해당 제품 전체 호환을 뜻하지 않는다.

배포 검증은 `dist/evidence/extension/package.json`에 ZIP 재개봉·필수 항목·모든 파일 SHA256 대조 결과를 기록한다.

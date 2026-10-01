# 검증 보고서

검증 스냅샷: 2026-09-28 17:47 KST (Windows, `E:\PROGRAM\PCE` 체크아웃). 이번 구현 후 실행한 TypeScript/Python 및 세 북마크릿 E2E 결과를 반영했다. Workspace·데스크탑 패키지·WebView2 창 검사는 별도 표시한 이전 결과다.

요구사항/합격 기준은 구현 완료 증거가 아니다. 단위 테스트·브라우저 E2E·headless 패키지 검사·네이티브 창 smoke는 서로 다른 증거이며 실제 나라장터와 사용자 Chrome 등록/연결은 미검증이다.

## 실행 결과

| 명령 | 결과 | 근거 |
|---|---|---|
| `npm run verify` | 이번 실행 통과 | Vitest 4.1.11의 9개 파일/82개 테스트, 플러그인 경계 검사 17개 소스·타입 검사·빌드 통과(17:46 KST). |
| `.venv\Scripts\python.exe -m unittest discover -s native/tests -v` | 이번 실행 통과 | 35개 Native 테스트 통과, 3.611초. |
| `node scripts/verify-bookmarklet-prototype.mjs` | 이번 실행 통과 | `artifacts/bookmarklet-prototype-verification.json`: 22개 흐름, errors 없음, 17:47:24 KST 종료. |
| `node scripts/verify-hwpx-bookmarklet.mjs` | 이번 실행 통과 | `artifacts/bookmarklet-hwpx-verification.json`: 14개 흐름, errors 없음, 17:47:29 KST 종료. |
| `node scripts/verify-hwpx-insertion.mjs` | 이번 실행 통과 | `artifacts/bookmarklet-hwpx-insertion-verification.json`: 16개 흐름, errors 없음, 17:47:23 KST 종료. |
| `npm run package:bookmarklet` | 이번 실행 통과 | 설치/연습 링크의 실제 코드 일치, 세 E2E의 번들 해시 일치, ZIP 9개 파일 재개봉 해시 확인. 결과는 `artifacts/bookmarklet-package-verification.json`. |
| `node scripts/verify-workspace.mjs` | 이전 실행 통과 | `artifacts/ui-verification.json`: Edge headless 36개 흐름, errors 없음, 16:24:01 KST 종료. 이번 최종 번들로 재실행하지 않음. |
| `powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1 -SkipFrontend` | 이전 패키지 생성 | PyInstaller onedir `dist/desktop/PCE/PCE.exe`, `dist/desktop/PCE.NativeHost/PCE.NativeHost.exe` 생성 기록. 이후 웹 자산 변경분으로 재빌드·재검증하지 않음. |
| `artifacts/package-verification.json` | 이전 패키지 검사 통과 | 6개 검사, `registryChanged=false`. 당시 자산 일치·packaged Host 수집 화면 차단 포함. 현재 웹 자산과 기존 EXE의 일치를 보증하지 않음. |
| `artifacts/desktop-verification.json` | 이전 창 검사 통과 | 수정 후 소스 진입점 Workspace/Gateway/한글 및 별도 viewer, 5개 확인. |
| `artifacts/desktop-packaged-verification.json` | 이전 창 검사 통과 | 당시 EXE 진입점의 같은 5개 확인. `configuredBy=manifest-or-parent`, `registryChanged=false`. |

전체 요구사항의 합격을 뜻하지는 않는다. 각 결과는 아래의 범위에서만 유효하다.

TypeScript/Python 개수는 이번 도구 실행 기록을 따른다. E2E 개수·종료 시점·오류 목록은 위 JSON 파일에서 직접 확인했다. 세 북마크릿 보고서는 모두 최종 JS 번들의 SHA-256 `e35c5adedbf7f22e556785f140404da07aa398dc0484ba3e170e50b5331deaaf`를 기록하며 실제 `dist/bookmarklet/pce-bookmarklet.js` 파일 해시와 일치한다. Vite 7.3.6, Vitest 4.1.11, fflate 0.8.3의 버전 선언과 실제 실행 결과는 구분한다.

Vite의 큰 청크 경고는 남아 있다. 17:46 KST 빌드 파일의 북마크릿 JS는 UTF-8 1,395,679바이트, `javascript:` 전달 파일은 1,960,452바이트다. 실제 링크 실행은 로컬 E2E에서 확인했지만 브라우저 북마크 막대 저장·URL 보존 한계와 실제 나라장터 CSP는 별도 확인 대상이다.

## 브라우저 E2E 증거

`artifacts/ui-verification.json`은 Edge headless UI 흐름 36개 항목과 빈 `errors`를 기록한다. 이 스냅샷의 실행 종료는 2026-09-28 16:24:01 KST다. `artifacts/workspace.png`와 `artifacts/bookmarklet.png`는 해당 실행의 화면 캡처다.

확인한 동작은 Dataset 편집·저장·재조회, 숨긴 빈 행 보존, Escape/F2/Tab/Enter와 빠른 입력, 이동 취소·명시적 편집 폐기, 사각 범위 복사·다중 행 붙여넣기·채우기·삭제, 읽기 전용 및 JSON 가상 열 보호, 실패 저장 시 버퍼/DB 보존, 다중값 AND·JSON 경로 중첩 필터다. CSV 선행 0 보존과 추가 열·행의 저장 전 보류·실패 유지·승인 저장도 확인했다.

추가로 레코드 메모·기간 일정 연결과 재조회, 중앙/테이블별 같은 관계 정의의 수정과 다중 매칭 정책, 파생 텍스트 템플릿 렌더링, 백업 다운로드·미리보기 승인 복원·내부 ID 유지, 북마크릿 IndexedDB→JSON→정규화 저장·재전달·패널 재열기를 확인했다. 템플릿의 `viewer.open` 응답은 테스트에서 stub 처리했으므로 실제 뷰어 창을 확인한 결과가 아니다. 수집 UI 입력은 로컬 가상 WebSquare 페이지이며, 사용자 제공 원본의 구조·정규화 검증은 Native 테스트와 구분한다.

추가 북마크릿 검사에서는 미지정 화면의 1회/자동 수집이 IndexedDB에 쓰기 전에 차단되고, 임시 추출은 가능하며 명시적 별도 보관에는 `extraction-save`가 표시됨을 확인했다. 화면 조건 변경 후 자동 중단·후속 쓰기 없음, 데스크탑 정책 JSON 내보내기/적용, 빈 규칙 목록의 기본값 대체, 손상 정책 거부·재열기 후 정책 유지, 느린 IndexedDB 정책 조회에서 임시 기본값으로 수집하지 않음, 첫 저장 중 정지해도 자동 반복을 재시작하지 않음을 확인했다. 반복 관찰은 서로 다른 이벤트로 남고 JSON 출력은 보관함을 삭제하지 않는다.

`artifacts/package-verification.json`의 여섯 검사는 당시 UI 자산과 패키지 자산의 바이트 일치, 한글/공백 경로의 Native Host health, 요청 재생·프로세스 재시작 뒤 선행 0 보존, 추가 열·소수 행 원자적 저장, 지정 화면 수집/재전달과 미지정 화면의 저장 전 차단, Workspace headless 제공이다. **이후 공용 Grid/Import 모듈 및 웹 빌드 의존성이 변경됐고 기존 EXE를 최신 웹 자산으로 재빌드·재검증하지 않았다. JSON 안의 “current extension build”는 검사 당시를 뜻한다.** `registryChanged=false`이며 `nativeWindow=UNVERIFIED`는 headless 검사의 경계를 뜻한다. 네이티브 창은 다음의 별도 이전 결과로 확인했다. Chrome 레지스트리 등록은 수행하지 않았다.

이전 WebView2 실패는 호스트 System DPI와 현재 런타임 DPI 초기화 불일치로 재현했다. 로그의 DPI 설정 거부 및 `0x8007139F`, 기존/System 실패와 Per-Monitor V2 성공 비교를 `WEBVIEW2_DIAGNOSIS.md`에 기록했다. source 시작과 EXE 매니페스트 수정 후 `scripts/verify-desktop.py`와 `--packaged`가 각각 5개 확인을 통과했다. 격리 DB/profile에서 실제 진입점의 WebView2 페이지, Workspace Gateway 연결·한글 렌더링, 별도 viewer 문서를 확인했다. 사용자 UI 조작 전체·멀티 모니터 이동·다른 PC의 실행까지 검증한 것은 아니다.

Native 수집 검사에는 TypeScript와 같은 13개 화면 사례, 원본 JSON 31개의 지정 화면 판별, frame별 필터와 출처·0/false·부분 읽기 경고 보존, 서로 다른 물품 2/24행과 일반 표의 여러 식별값, 같은 식별값의 충돌, 정책 변경·실패·재전달 원자성을 포함했다. 모든 원천 필드의 DB 왕복 비교, 대량/장시간 운영 및 강제 종료 시점을 망라하는 안정성 테스트는 수행하지 않았다.

## 올인원 북마크릿·HWPX 검증 증거

`artifacts/bookmarklet-prototype-verification.json`은 실제 단일 `javascript:` 링크로 네 영역 화면을 열고, 합성 WebSquare와 실제 IndexedDB에서 22개 흐름을 검사했다. 지정 화면 수집과 미지정 차단, 임시 추출의 명시적 Dataset 생성, ShadowRoot의 단일 클릭·Esc·Enter·Tab·사각 복사/붙여넣기, 숨긴 행 보존, 복수 값 AND/OR·제외 필터, CSV 추가 열 보류, 동시 수정 시 편집 버퍼 보존을 포함한다. 레코드 메모/기간 일정, 중첩 JSON 텍스트 치환, URL 런처, 관계 미리보기, 전체 백업/복원/재열기와 복원 전후 버전 충돌도 검사했다. 이벤트 재전달의 키 순서 무시·자료형/배열 순서 유지, 여러 이벤트 중 후반 충돌의 전체 롤백, 손상 백업의 쓰기 전 거부를 확인했다.

사용자가 직접 추출한 원본 JSON 31개를 같은 브라우저에서 원본 파일 검증기로 읽었으며, 파일 열기는 임시 표시이고 자동 수집 저장을 만들지 않음을 확인했다. 이는 앞선 21개 계획 수보다 실제 저장소에서 확인한 파일 집합을 따른 결과다. 파일 구조를 검증한 것이 실제 나라장터 권한·frame 접근을 재현한 것은 아니다. `artifacts/bookmarklet-prototype-db.png`는 해당 합성 UI의 화면 증거다.

`artifacts/bookmarklet-hwpx-verification.json`은 14개 흐름에서 원본 불변성, 기존 run 참조 및 비수정 ZIP 항목 바이트 보존, 변경한 section만의 배치 캐시 제거, mimetype 순서/무압축과 출력 재열기를 확인했다. 오래된 위치·겹친 앵커·허용되지 않는 다중 문단 치환·제어 객체 포함 위치·잘못된 XML·DTD·손상 CRC를 거부했다. 조건 치환의 정확한 소수 계산, 뷰어 위치 클릭→DB 열 연결→앵커 저장→생성 파일 다운로드를 검사했다.

참고 HWPX는 `template_v1.hwpx`, `구매요청서.hwpx`, `form_purchase_v1.hwpx`, `form_purchase_v2.hwpx`, `spec_revision_2026.hwpx` 다섯 파일을 읽고 허용된 위치를 치환한 뒤 다시 열었다. 이 중 두 파일은 동일 내용이므로 다섯 독립 문서 형식의 검증으로 표현하지 않는다. 파생 템플릿이 마스터 ZIP을 복제하지 않고 참조하는지, 마스터 저장 버전 및 삭제 참조 검사가 원자적으로 적용되는지, 전체 백업·복원·재열기 후 앵커가 남는지 확인했다. 복원 전 자동 수집 정지와 이후 추가 수집 없음도 검사했다. `artifacts/bookmarklet-hwpx.png`는 구조 뷰와 앵커 편집 화면의 증거다.

추가한 `artifacts/bookmarklet-hwpx-insertion-verification.json`은 16개 흐름에서 최상위 본문 문단 뒤 새 문단과 JSON 배열 기반 직사각 표를 삽입하고 다시 여는 동작을 확인했다. 모든 앵커를 불변 원본에서 먼저 해석하므로 앞선 삽입으로 위치가 밀려도 다른 앵커에 잘못 연결되지 않으며, 동일 위치의 여러 삽입 순서도 확인했다. 기존 서식 참조와 문서 전체의 새 ID 중복 방지, 표의 행/열 주소·자식 순서·전체 폭, 0/false·선행 0·소수 보존, 빈 배열 및 거짓 조건의 구조 생략을 검사했다.

잘못된 자원·표 크기·JSON 원천·출력 한도·XML 제어 문자·오래된 section·중첩 위치 삽입은 거부한다. 마스터 변경이 손자 파생 템플릿을 무효화하면 저장 버전을 포함한 전체 트랜잭션이 롤백됨을 확인했다. 점이 들어간 실제 JSON 키와 중첩 경로의 구분, 느린 파일 읽기 중 선택·편집 잠금, 화면에서 삽입 앵커 저장·미리보기·다운로드, 생성 미리보기에서 원본 위치 오연결 차단, 저장 템플릿을 다시 열어 생성해도 이전 출력이 누적되지 않음을 확인했다. 앞의 참고 HWPX 다섯 파일에도 문단·표 삽입 후 재열기 검사를 수행했다. 두 파일이 동일 내용이라는 한계는 유지한다.

이 결과는 한글/COM의 실제 문서 열기·인쇄·페이지 렌더링 검증이 아니다. 교차 문서 자원 ID 병합, 병합 셀·중첩 위치 삽입, 전체 필드·북마크 영역, 그림·도형·수식의 정확한 표시는 미완료다. 원본 코드의 정적 근거와 불완전한 참고 구현은 `HWPX_REFERENCES.md`, 요구별 미완료 항목은 `BOOKMARKLET_REQUIREMENTS_MATRIX.md`를 따른다.

## 1차 요구사항 코드 커버리지 검토

이 절은 현재 소스에 있는 동작과 위의 좁은 브라우저 E2E 증거를 `PRODUCT.md`/`ACCEPTANCE.md` 요구 ID에 대조한 코드 검토다. 기능 이름, 버튼, 설정 필드가 있다는 사실만으로 합격 처리하지 않았다.

| 요구 ID | 코드에서 확인한 범위 | 남은 구현/검증 공백 |
|---|---|---|
| U01–U03 | SQLite 저장소, 6개 조달 기본 논리 표와 참고 표, 플러그인 레지스트리, 브라우저/데스크탑 Gateway 연결 코드가 있다. E2E에서 한 Dataset 로드/편집/저장/재조회 흐름을 확인했다. | 전체 요구 범위의 테이블·메모·일정·런처·DB 화면을 합격 처리한 것은 아니다. Native Messaging 설치 연결과 실제 앱 전체 운영은 미검증이다. |
| U04 | 북마크릿 IndexedDB→TransferBundle JSON→가져오기→정규화 저장, 중복 재생 확인이 synthetic E2E에서 확인됐다. 패키지 Native Host의 protocol/restart는 별도 패키지 검사에서 확인됐다. | 실 G2B WebSquare/frame 권한·추출, Chrome 레지스트리 등록/연결은 미검증이다. |
| U05–U07 | CSS 선택자에 의한 날짜/조회/건수/Excel 명령과 네 추출 보기·임시 표·Dataset·규칙 설정 코드가 있다. 저장 전 지정 화면 검사, 북마크릿 정책 전달/지연 읽기/자동 정지, 확장 시작 중 정지 경합은 테스트로 확인했다. | 실제 나라장터의 CSS 요소 명령·각 화면 규칙·Native Messaging 연결은 미검증. 자동 정지 테스트 사례가 전체 실환경 합격을 뜻하지 않는다. |
| U08–U10 | 업무별 번호·차수/물품 후보, 규칙, 미리보기·저장 버전 검사가 있다. 중앙과 테이블별 같은 관계 정의의 수정, 다중 매칭 정책을 UI E2E에서 확인했다. | 모든 원본 화면의 실제 동작과 관계 조건 조합 전체는 미검증이다. 추가 업무 스키마는 사용자 허가 없이 만들지 않는다. |
| U11–U12 | Grid 키보드·범위·붙여넣기·삭제·채우기·버퍼 유지, CSV 선행 0·추가 열 보류·열과 행의 원자적 저장을 E2E에서 확인했다. Native 테스트는 잘못된 행의 스키마/행/버전 전체 롤백을 확인한다. | XLSX·CSV·헤더/영역/중복의 전체 조합과 Grid acceptance matrix 전체는 아직 미검증이다. 수식은 세션 계산 문법이다. |
| U13 | 다중값 AND·중첩 그룹·JSON 경로 필터를 E2E에서 확인했다. TS/Python의 공통 11개 필터 사례도 통과했다. | 필터의 모든 자료형·표시값·복합 조건 조합에 대한 전체 검증은 남아 있다. |
| U14 | JSON false 값을 표시하는 가상 읽기 전용 열이 E2E에서 확인됐다. 구조/원문/요약/배열 보기·경로 표시·출력 코드가 있다. | JSON 표시 열은 읽기 전용 투영이다. 실제 JSON 원본 편집기 구현/검증으로 보지 않는다. 누락/null/빈문자 전체 기준도 미검증이다. |
| U15–U16 | 사전·숨김·헤더·화면 바인딩·수집 규칙·JSON 표시 설정과 수집 원본/경고/감사 로그 저장 코드가 있다. | 각 설정의 검증·버전 충돌·실행 효과와 관리자별 원본/화면/규칙 추적 UI는 요구 기준 전체를 충족했는지 검증되지 않았다. 설정 편집 화면 존재만으로 판정하지 않는다. |
| U17 | 메모·기간 일정의 업무 레코드 연결·저장·우측 문맥 재조회를 E2E에서 확인했다. 잘못된 연결 저장은 Native 테스트에서 롤백한다. | 일반/화면/레코드 메모 전체 조합 검증은 남아 있다. 달력·반복·알림·다중 보기는 2차다. |
| U19–U20,U28 | Workspace의 파생 텍스트 상속·치환·뷰어 요청, 별도 소스/EXE의 viewer 창 확인 기록이 있다. 북마크릿에서는 조건 텍스트, HWPX 구조 뷰·기존 위치 앵커·DB 치환·생성·마스터/파생 참조를 확인했다. 최상위 문단 뒤 새 문단/JSON 배열 직사각 표 삽입, 기존 서식·문서 전체 ID·하위 파생 정합성도 별도 E2E로 확인했다. | Workspace viewer 요청은 stub이고 Markdown은 원문 표시다. 북마크릿 텍스트의 마스터/파생, HWPX 교차 문서 자원 병합·병합 셀·정확한 페이지 렌더링 및 카드/보고서 설계는 미완료다. HWPX의 좁은 착수 범위를 2차 전체 완료로 보지 않는다. |
| U21–U22 | 레코드 문맥의 메모/일정 표시를 E2E에서 확인했다. 파일·폴더·URL·스크립트 런처와 확장 권한 안내 코드가 있다. | 실제 파일 열기·런처·Chrome 스크립트 실행·드래그 배치와 전체 파일 관리 검증은 남아 있다. |
| U23 | 전체 백업 다운로드·설정/템플릿/메모 포함·미리보기 승인 복원·내부 ID 유지를 E2E에서 확인했다. Native 테스트는 캡처 메타데이터 정확 복원과 부분 의존성을 확인한다. | 외부 파일 실물은 포함하지 않는다. 종류별 복원의 전체 UI 조합과 새 사용자 환경 복원 검증은 남아 있다. |

2차는 HWPX의 위 범위만 일부 구현·검증되었다. 달력·아이젠하워·칸반·계획 범위·다중 드래그·반복·알림·스티커메모 전체, 카드/보고서, 탐색기·PDF·이미지·압축·OCR 및 3차 고급 기능 요구는 계속 남는다. 전체 기준은 `PRODUCT.md`와 `ACCEPTANCE.md`를 유지하고 북마크릿별 공백은 요구 충족 대장으로 연결한다. 이번 문서 정리로 미완료 항목을 완료 처리하지 않는다.

## 검증 범위와 한계

- Vitest 결과는 저장소의 단위/계약 테스트 증거다. 실제 나라장터 WebSquare 화면, iframe/frame 접근, 사용자 사이트 권한을 검증한 결과가 아니다. 로컬의 실제 `javascript:` 링크 실행은 별도 북마크릿 E2E에서 확인했지만 북마크 막대 저장·실사이트 CSP까지 검증하지 않았다.
- 빌드는 개발 산출물을 만들었다. Chrome에 확장을 설치하거나 Native Messaging 레지스트리 연결을 확인하지 않았다.
- Python 테스트는 Native Gateway 코드 일부를 임시 DB와 HTTP 테스트 서버에서 다룬다. 이 결과만으로 사용자의 기본 DB, Windows 레지스트리, 설치된 Chrome 연결 또는 데스크탑 시각 동작을 확인한 것이 아니다.
- 패키지 headless·Edge browser·실제 WebView2 창 smoke는 별도 결과로 통과했다. 창 smoke는 당시 자체 문서 로딩 및 Gateway 연결 범위이며 전체 사용자 수용은 아니다. 현재 웹 자산과 기존 데스크탑 EXE 조합은 재검증하지 않았다.
- Phase 1 전체는 미완료다. 2차 HWPX 일부가 단계 횡단 프로토타입으로 구현되었고, 나머지 2차 및 3차 요구는 요구 충족 대장의 미완료 상태를 유지한다.

## 상태 분류

- **확인된 코드/검증 사실:** 표에 기록한 `npm run verify`, Native Python, PyInstaller package, Edge headless UI 결과.
- **요구사항:** `docs/PRODUCT.md`와 `docs/ACCEPTANCE.md`의 사용자 요구 및 선택 확정. 요구가 있다는 사실은 기능 구현·검증 사실과 별개다.
- **설계 제안/기술 선택:** `docs/DECISIONS.md`에서 `설계 제안` 또는 `구현 기술 선택`으로 표시한 항목. 사용자 원문 요구로 취급하지 않는다.
- **미검증:** 실제 G2B, Chrome 레지스트리/Native Messaging 연결, 제한 PC 권한, 다른 PC·전체 데스크탑 UI 및 최종 사용자 배포 수용.

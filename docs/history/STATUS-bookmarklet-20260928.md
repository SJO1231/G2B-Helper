# 구현·검증 현황

검증 기준 시점: 2026-09-28 17:47 KST. 이번 구현 후 TypeScript/Python 및 북마크릿 검증을 다시 실행했다. Workspace·데스크탑 패키지·WebView2 창 검사는 아래에 별도 표시한 이전 결과다. 요구사항의 출처/분류는 `PRODUCT.md`, 설계 제안 및 채택 이력은 `DECISIONS.md`를 따른다. 아래 코드 존재, 자동 테스트, 브라우저 E2E, 패키지 검사, 실제 운영 검증은 서로 다른 증거다.

## 1차

**구현 일부, 전체 합격 아님.** 현재 저장소에는 공통 Gateway와 조달 논리 표, Dataset/Grid, 관계·필터, 브라우저 수집·추출·규칙, 설정, 텍스트 템플릿, 메모/기본 일정, 파일·런처, 백업 흐름이 구현되어 있다. 올인원 북마크릿은 업무·DB·메모/일정·런처와 조건 치환·HWPX 보조 화면을 조립하고 사이트별 IndexedDB를 사용한다. 사용자 선택자에 의한 브라우저 검색 기간/건수/Excel 조작은 코드가 있으나 실제 나라장터 화면에서 확인되지 않았다. 상세 범위는 `BOOKMARKLET_REQUIREMENTS_MATRIX.md`, 실행 증거와 한계는 `TEST_REPORT.md`를 따른다.

## 2차·3차

**2차 일부 착수, 3차 고급 확장 미착수.** 단계 횡단 북마크릿 요청에 따라 HWPX ZIP/XML 읽기·구조 뷰·문단/셀/텍스트 위치 선택·DB 열 앵커·조건 치환·다운로드·마스터/파생 참조를 구현하고 좁은 범위를 검증했다. 최상위 본문 문단 뒤 새 문단 및 JSON 배열 기반 직사각 표 삽입도 추가 검증했다. 한글의 정확한 페이지 렌더링, 교차 문서 자원 ID 병합·병합 셀 등은 미완료다. 달력·아이젠하워·칸반·계획 범위·다중 드래그·반복·알림·스티커메모 전체, 카드·보고서, 탐색기/미디어·OCR, 3차 고급 검색·명령 팔레트·매크로·분석 등 기존 요구는 계속 남아 있다. 세부 상태는 요구 충족 대장으로 구분하며 전체 범위를 축소하지 않는다.

## 확인된 검증과 미검증

- TypeScript 이번 실행: `npm run verify`에서 Vitest 4.1.11의 82개 테스트/9개 파일, 플러그인 경계 17개 소스·타입 검사·빌드 통과(17:46 KST).
- Native Python 이번 실행: 35개 통과(3.611초). 저장·롤백, 저장 전 화면 검사, 정책 버전, 13개 공통 화면 사례 및 실제 JSON 31개 구조 검사 포함.
- 올인원 북마크릿 E2E: 저장된 `artifacts/bookmarklet-prototype-verification.json`의 22개 흐름과 빈 `errors` 확인. 실제 `javascript:` 링크·합성 WebSquare·실제 IndexedDB에서 Grid·필터·Import·관계·메모·백업·충돌·31개 원본 JSON 열기를 검사했다.
- HWPX/조건 템플릿 E2E: `artifacts/bookmarklet-hwpx-verification.json`의 14개 흐름과 빈 `errors` 확인. 참고 HWPX 5개 파일 읽기/치환/재열기, 원본 및 비수정 항목 보존, 앵커 UI·파생 참조 검사·백업/재열기·복원 전 자동 수집 정지 포함. 두 파일은 동일 내용이며, 한글에서 페이지를 검증한 결과가 아니다.
- HWPX 삽입 E2E: `artifacts/bookmarklet-hwpx-insertion-verification.json`의 16개 흐름과 빈 `errors` 확인. 불변 원본에서 일괄 앵커 해석, 같은 위치 삽입 순서, 문서 전체 ID 중복 방지, 기존 서식 참조, 직사각 표 좌표/크기, 빈 배열·조건 생략, 손자 파생까지 저장 원자성, 특수문자 키 경로, 비동기 열기 경합, 참고 파일 5개의 삽입·재열기를 검사했다.
- 위 세 북마크릿 E2E는 17:47 KST에 같은 최종 번들로 통과했다. 저장 보고서와 실제 파일의 SHA-256은 `e35c5adedbf7f22e556785f140404da07aa398dc0484ba3e170e50b5331deaaf`로 일치한다.
- 설치 묶음: `dist/PCE-bookmarklet-prototype.zip`. `npm run package:bookmarklet`은 설치/연습 링크와 번들의 동일성, 세 E2E의 번들 해시, ZIP 9개 파일의 재개봉 해시를 검사한다. `artifacts/bookmarklet-package-verification.json`에 결과를 기록한다.
- 이전 Edge headless Workspace E2E: `artifacts/ui-verification.json`의 36개 흐름과 빈 `errors` 확인(16:24 KST). Grid·Import·메모·관계·백업, 북마크릿 미지정 화면 차단·정책·정지 경합 포함. 뷰어 요청은 stub이며 이번 최종 번들로 재실행한 결과는 아니다.
- 이전 PyInstaller 패키지 검사: 6개 통과. 당시 UI 자산 바이트 일치, 한글·공백 경로의 Host 연결·재시작·소수 Import, 수집 화면 차단, headless UI 제공. `registryChanged=false`. **이후 웹 자산과 의존성이 변경되어 기존 EXE를 최신 자산으로 재빌드·재검증하지 않았다. 당시 바이트 일치는 현재 패키지 일치 증거가 아니다.**
- WebView2 원인 재현: System DPI에서 실패/런타임 DPI 설정 거부, Per-Monitor V2에서 성공. 소스 시작과 EXE 매니페스트 수정 후 source/frozen 진입점 각각 5개 확인 통과(Workspace 연결·한글·별도 viewer). 근거는 `WEBVIEW2_DIAGNOSIS.md`와 `TEST_REPORT.md`. 다른 PC·전체 UI 수용 검증과 구분.
- 실제 G2B, 사용자 Chrome Native Messaging 등록/연결, 제한 PC 권한 및 배포 사용자 검증: 미검증.
- 추가 업무 테이블·스키마는 사용자 승인 없이 생성하지 않는다.

제공 자료는 사용자가 실제 화면에서 직접 추출한 구조 기준이다. 자료 출처·샘플 구조 검증과 브라우저 실행 권한·frame 접근 검증을 구분한다. 세부 근거와 남은 기능은 TEST_REPORT.md를 따른다.

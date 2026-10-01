# 구조와 공개 경계

현재 확장·저장·UI 기준은 EXTENSION_REQUIREMENTS.md, 누적 기능 요구는 PRODUCT.md, 설계 선택은 DECISIONS.md, 실행 증거는 STATUS.md를 따른다. 아래 구조와 코드 존재는 실제 설치·나라장터 동작 완료를 뜻하지 않는다.

메인은 화면·명령·선택 상태를 조립하고 기능 플러그인은 자신의 규칙과 데이터를 소유한다. TypeScript 공통 UI/계약과 Python SQLite 실행부를 사용한다. 활성 브라우저 진입점은 작은 이동형·접기 확장 위젯과 기능별 feature.html popup이며, 데스크탑 Workspace와 같은 SQL DB를 Native Messaging Gateway로 사용한다. 연결 실패를 별도 브라우저 DB로 우회하지 않는다. 이전 북마크릿 원본·검증 자료는 보관하고 활성 Vite 입력에서 제외한다.

widget.js는 isolated world에서 목록과 업무 리모컨을 조립한다. 원천 읽기와 업무 조작은 MAIN world에 독립 함수를 frame별 주입한다. 팝업에는 원본 sourceTabId를 전달하며 팝업 자신의 활성 탭을 수집 대상으로 사용하지 않는다. 페이지 위젯의 tabId는 sender.tab.id로 고정하고 직접 Gateway 요청은 table.list/read, settings.read, gateway.health로 제한한다. 기능창의 저장·설정은 기존 Gateway 계약을 사용한다.

범용 내부 저장소와 승인된 접수/공고/계약·물품 논리 표 프리셋을 사용한다. 샘플에서 발견한 추가 업무 표를 임의 생성하지 않는다. 사용자 Dataset 생성은 명시적 명령이다. 안정적 recordId와 storeVersion을 업무키와 구분한다.

수집·전달·테이블·관계·Grid·필터·JSON 표시·사전·메모/일정·템플릿/뷰어·런처/파일·백업 경계를 유지한다. 다른 플러그인 내부 구현 import 금지. 공통 저장소 접근은 공개 저장 API를 사용한다.

요청 ID와 본문을 비교하여 재시도 중복을 막는다. 쓰기는 원자적 트랜잭션, 읽기는 전체 자료에 필터 적용 후 페이지 반환. SQL 조회는 공개 pce_records/pce_tables 뷰의 읽기 전용 연결·authorizer·시간/행 제한을 사용한다. 수집 이벤트 재전달은 식별자+내용 해시로 중복 판정하며 서로 다른 시점의 관찰과 구분한다.

CollectionPolicy와 CollectionScope로 저장 전에 같은 frame의 URL+화면 조건·업무 식별을 검사한다. 확장은 collector.policy를 읽고 허용된 frame URL을 쓰기 전에 다시 확인하며 capture.collect는 정책 버전을 검사한다. rules=null은 기본 조건, 명시 rules는 사용자 조건, includeDefaults=true는 두 조건의 합집합이다. 같은 frame/Dataset을 합칠 때 원본 행과 중복 횟수를 줄이지 않고 서로 다른 조달 부모는 모호함으로 판정한다. frame이 없는 명시 입력은 CapturePayload.url을 URL 조건에 사용한다. 수동 파일 가져오기 capture.import와 명시적 임시 추출 보관은 자동/1회 수집과 구분한다.

자동 수집 알람은 시작한 탭 ID에 묶는다. 정지는 알람과 세대를 무효화하여 아직 전달하지 않은 후속 자동 저장 요청을 막는다. 이미 Native Host에 전달한 쓰기는 완료될 수 있으며 정지 응답에 그 상태를 표시한다. 추출은 현재 로딩 자료를 읽는 임시 결과로서 추출만으로 DB에 저장하지 않는다.

자동 테스트, 빌드, 실제 UI, 실제 나라장터 검증은 서로 다른 증거다. 샘플 파싱으로 실제 화면 완료를 주장하지 않는다.

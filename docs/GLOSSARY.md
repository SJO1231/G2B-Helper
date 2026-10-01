# 용어집
| 한글 | 코드 | 소유·정의 | 혼동 금지 |
|---|---|---|---|
| 업무 식별 | ProcurementIdentity | 수집: 업무종류·번호·차수 | 저장 버전 |
| 수집 이벤트 | CaptureEvent | 수집: 원본·시각·출처·부분 상태 | 정규화 행 |
| 수집 정책 | CollectionPolicy | 수집: URL·화면 규칙과 저장 버전. null은 기본 지정, includeDefaults는 사용자 규칙과 기본 지정의 합집합, 기본 미포함 빈 목록은 차단 | 사전 표시 규칙 |
| 수집 허용 판정 | CollectionScope | 수집: frame별 화면·업무 식별 검사와 허용된 원본 범위 | 저장 후 정규화 판정 |
| 전달 묶음 | TransferBundle | 전달: 버전과 이벤트 목록 | 백업 |
| 필드 제안 | FieldChangeProposal | 수집: 기존/수집값·충돌 | 일괄 덮어쓰기 |
| 편집 묶음 | GridEditBatch | Grid: 미저장 셀·행 변경과 추가 열 정의, 한 번에 저장 | 자동 수집 |
| 표 제공 | TableSource | 테이블: 공통 조회 계약 | 물리 SQL 표 |
| 일반 자료집 | ImportDataset | 테이블: 사용자 자료 | 수집 규칙 |
| 관계 정의 | RelationDefinition | 관계: 양쪽 표·키·조건·다중성 | 병합 |
| 중복 정책 | DuplicatePolicy | 테이블: 저장 비교 키·방식 | 다중 매칭 |
| JSON 표시 | JsonPresentation | JSON: 경로·표시·출력 | 스키마 생성 |
| 필터 그룹 | FilterGroup | 필터: AND/OR 그룹 | 로딩 행만 검색 |
| 키/코드 사전 | KeyLabelDictionary / CodeLabelDictionary | 사전: 원천 표시 대응 | 원값 변경 |
| 헤더 대응 | ImportHeaderMap | 사전: 헤더 동의어 | 출력 표시명 |
| 내부 ID | recordId | 저장: 안정적인 레코드 ID | 업무번호 |
| 저장 버전 | storeVersion | 저장: 동시 수정 검사 | 업무 차수 |
| 계획 범위 | planningHorizon | 일정: 일/주/월/미지정 | 실제 날짜 |
| 마스터 참조 | masterId | 템플릿: 공통 정의 | 생성 문서 |
| 버전 문서 | LocalDocument | 공유 템플릿: namespace·문서 ID·저장 버전·내용. 기존 타입명을 호환 유지하나 활성 확장은 SQLite에 저장 | 브라우저 별도 저장소·수집 이벤트 |
| HWPX 패키지 | HwpxArchive | HWPX: ZIP 항목 바이트·section·원본 검사 결과 | 생성 템플릿·페이지 이미지 |
| HWPX 선택 위치 | HwpxTarget | HWPX: section·요소 경로·종류·원문·치환 가능 범위 | DB 열·업무 식별 |
| HWPX 앵커 연결 | HwpxAnchorBinding | HWPX: 선택 위치와 DB 열/출력 문구를 연결한 사용자 정의 | HWPX 자체 필드 이름 |
| 조건 치환 정의 | TemplateProgram | 템플릿: 출력 조건·누락 처리. 값은 문자열로 치환 | JavaScript·사용자 실행 스크립트 |
| 조건별 출력 | TemplateClause | 템플릿: FilterGroup과 충족/불충족 문구 | 데이터 필터 자체 |
| 파생 원본 참조 | baseTemplateId | HWPX: 기존 마스터/파생 템플릿 참조, ZIP 복제하지 않음 | 업무번호·생성 파일 |
| HWPX 구조 추가 | HwpxInsertion | HWPX: 불변 원본 앵커 뒤에 문단 또는 JSON 배열 직사각 표를 추가하는 선언 | 원본 ZIP 수정·행 복제 |
| 본문 변경 지문 | sectionFingerprint | HWPX: 앵커 지정 당시 section의 원문/서식 변경을 감지하는 비교값 | 보안 서명·저장 버전 |
| 명시적 경로 토큰 | TemplatePathToken | 템플릿: 원천 키의 점·기호와 중첩 경로를 구분하는 path: 출력 참조 | 문자열 분리로 추정한 경로 |

| 문서 저장 계약 | DocumentStore | 템플릿: 조회·CAS 저장·삭제. 확장 어댑터는 Native SQL 명령 사용 | IndexedDB 런타임 |
| 원천 탭 | sourceTabId | 확장: 사용자가 위젯을 실행한 페이지 탭. 팝업에 고정 전달 | 현재 활성 팝업 탭 |
| 화면 연결 식별 | screenKey | 확장: [URL, areaCd, depth1, depth2]로 메모 연결. 여러 후보는 직접 선택 | 동적 DOM ID·업무 레코드 ID |
| 업무 제어 요청 | WorkActionRequest | 업무 보조: frame 후보 판별·기간·조회 건수·조회·엑셀 요청 | 수집 규칙·SQL 명령 |

외부 원천 필드명을 바꾸지 않는다. 모호한 data/item/manager/revision은 단독 공개 용어로 사용하지 않는다.

## 0.4 보충

| 한글 | 코드 식별자 | 정의·소유 | 혼동 금지 |
|---|---|---|---|
| 표 출처 대응 | tableSources | 수집: 안정 표 이름과 originalId/componentId 대응. 원천 실제 ID 보존 | 같은 표 두 번 저장 |
| 취합 검토 | AggregationPreview | 파일: 파일별 첫 시트·헤더 검토 후 선택한 공통 열에 행 누적 | 자동 SQL 반영·새 업무 스키마 |
| 휴지통 상태 | trashed | 메모: 본문·내부 ID·연결을 유지한 보관/복원 상태 | 영구 삭제·창 닫기 |
| 화면 테마 | ui.appearance | 설정: SQL에 저장한 light/dark 표시 선택 | 원천 사이트 스타일 수정 |

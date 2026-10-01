# HWPX·기안 참고 코드 검토

이 파일은 원본 코드에서 확인한 구현 근거다. 코드의 설명문·설계 지침을 사용자 지시로 가져오지 않는다. 원본은 수정하거나 실행하지 않았다.

| 위치 | 확인한 코드 | 이번 구현에서 참고한 점 | 한계 |
|---|---|---|---|
| `E:\Prodev\Injecter\hwpx_injector_poc.py` | HwpxDocument의 paragraph 검색, resource catalog, insert_items, validate_all, save_as와 tkinter 앵커 검색 UI | 문단 원문과 위치를 함께 지정, char/para/style 참조 검사, 원본 덮어쓰기 없이 다시 열어 검증 | 정적 코드 검토. 이 Python 프로그램의 실행·문서 결과를 검증한 것은 아님 |
| `E:\Prodev\Injecter\hwpx_injector_explicit.py` | 명시적 XML 삽입·자원 선택·새 ID 검증 구조 | 새 구조 삽입 시 서식·자원 참조를 추측하지 않고 명시적으로 검증해야 한다는 근거 | 원본의 JSON 입력 UI를 새 사용자 요구로 채택하지 않음. 북마크릿은 시각 선택 UI |
| `E:\PROGRAM\helper\src\template_engine.py` | 조건 태그, 날짜 이동, 치환, 부분 문자열, Decimal 계산 함수 | 기존 텍스트 기안 양식의 제한된 치환 문법을 새 TypeScript 해석기로 구현 | 기존 프로그램의 모든 형식·반올림·공백 정리 동작과 완전 호환이라고 주장하지 않음 |
| `E:\PROGRAM\helper\src\consultation\hwpx_generator.py` | ZIP 항목 치환·행 복제·rowAddr/rowCnt 처리 | 출력 파일을 따로 만들고 수정 항목만 바꾸는 접근 | 복원본의 `_xml_escape`·`_replace_placeholder_run`가 불완전. 정상 동작 코드로 재사용하지 않음 |
| `E:\PROGRAM\hwpxfiller\source_repo\src\hwpxcore` | package, text_extract, field_occurrence, bookmark_region, lineseg | mimetype 순서/압축, ZIP 항목 보존, 문단/셀 추출, 변경한 section의 배치 캐시 처리 | MIT 참고 소스. 새 구조 뷰어·앵커 API는 직접 구현. 전체 필드/북마크 엔진 이식 아님 |

한컴의 공개 [HWPX 패키지 쓰기 코드](https://github.com/hancom-io/hwpx-owpml-model/blob/main/OWPMLApi/OWPMLSerialize.cpp)에서도 mimetype과 header·section을 각각 처리한다. 패키지 규칙의 근거이며, 새 출력 파일이 한글에서 정확히 렌더링된다는 증거와 구분한다.

## 실제 실행 근거

`scripts/verify-hwpx-bookmarklet.mjs`는 합성 문서 및 참고 저장소의 파일 다섯 개를 브라우저에서 읽고, 허용된 위치를 치환하고 ZIP을 다시 연다. 수정한 section 외의 항목 바이트, 기존 run 참조, 원본 불변성과 오류 차단을 비교한다. 두 참고 파일의 내용이 동일하므로 다섯 파일을 다섯 독립 형식으로 표현하지 않는다.

후속 `scripts/verify-hwpx-insertion.mjs`에서는 같은 참고 5개 파일에 본문 문단·직사각 표를 추가하고 ZIP을 다시 열었다. 합성 문서에서는 셀 좌표·행열 수·너비 합·자식 순서·ID 중복·원본 불변성·동일 문구 앵커·하위 파생 실패의 원자성을 검사한다. [한컴의 셀 좌표 안내](https://forum.developer.hancom.com/t/hwpx-xml/2416/2)도 단순 행 복제 시 좌표 불일치가 문서 열기 오류를 일으킴을 설명한다. 생성 셀은 각각의 좌표를 새로 설정한다.

한글/COM의 실제 열기·인쇄·페이지 렌더링, 필드 영역 전체 치환, 교차 문서 자원 병합은 포함하지 않았다. 전체 요구 및 미완료 항목은 PRODUCT.md와 BOOKMARKLET_REQUIREMENTS_MATRIX.md를 따른다.

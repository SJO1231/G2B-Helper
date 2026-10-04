# G2B Helper #13 — N13-H1 클라우드 인계자료

이 자료는 [#13 요구사항별 보존 검증 및 누락 반례 보강](https://github.com/SJO1231/G2B-Helper/issues/13)의 **인계 준비**다. 검사 구현·실행, 제품/시안 수정, 빌드·설치, hook 설치/등록/실행, commit/push/PR와 GitHub 댓글/상태 변경은 승인되지 않았다. 실제 사용자 승인 원문은 [sources/user-messages.json](sources/user-messages.json)의 msg_01a107d2-1e84-76e1-a70b-c00c0fe0ca9b(2026-10-04T16:49:33.316Z)다.

## 기준과 소유

- 저장소: SJO1231/G2B-Helper. 실제 원격 main과 로컬 상태를 작업 직전 재조회했으며 제안 기준과 같았다.
- 이 worktree/브랜치: E:/Prodev/G2B_Helper_issue13_handoff / codex/issue-13-claude-handoff.
- 생성 기준: ae56ddd874eda0cf62c15dbea9f208c6551fe624. 기존 제품·Native·설정은 이 원격 버전이다.
- 원래 폴더: E:/Prodev/G2B_Helper. HEAD b7b0ac5bb2073811c6c669df15e52ad4d8eb7f09, codex/mvp-feature-mockup-redo, upstream 없음. 실제 원격 대비 ahead 2 / behind 0. 시작 dirty tracked 14 / untracked files 50 / staged 0. 미추적 파일은 prototypes에 있었으며 새 worktree에 들어오지 않았다.
- 제품 비교 스냅샷: d680ac2244c1a128f186572e79bea79d5d525c78의 apps/mvp 17개, 231081 bytes. 확정 Git blob에서 추출했으며 최신 제품 전체/실행 가능한 복제본이라는 뜻이 아니다.
- 부모 Codex는 자료 수집·README·manifest·기존 문서 링크를 소유한다. 요구 담당은 requirements/coverage/missing-materials, 환경 담당은 cloud-readiness를 소유한다. 자료 작성에 참여하지 않은 별도 verifier가 최종 원본 대조를 맡는다. 역할은 이번 작업용이며 자기 승인·병합 권한이 아니다.

## 읽는 순서

1. [requirements.md](requirements.md): 정확한 인간 원문, M04/M11 전후 문장, 미확정 조건.
2. [coverage.md](coverage.md): 23개 주석을 포함한 요구별 코드·화면·기존 검사·누락.
3. [missing-materials.md](missing-materials.md), [cloud-readiness.md](cloud-readiness.md): 실행을 막는 기준/환경/입력.
4. [manifest.json](manifest.json): 각 파일의 원래 경로, 커밋/미커밋 상태, 수집 시각, SHA256, 용도.
5. [review.md](review.md): 실제 독립 검토 대상·불일치·미확인.

## 자료와 실행의 경계

N13-H1의 실행 대상은 없다. 모든 materials는 읽기용이다. HTML도 이 단계에서 브라우저로 실행/serve하지 않는다. 검사기/하네스/역할 파일은 원래 바이트에 .txt를 붙여 보관했다. 다시 이름을 바꾸거나 활성 위치로 복사하지 않는다. 원래 .Claude/.codex 설정을 변경·설치하지 않았다. inherited 루트 설정의 자동 로딩·실제 hook 보호도 확인하지 않았다. 도구가 AGENTS/CLAUDE를 자동 읽더라도 이번 인간 승인 이상의 권한이 생기지 않는다.

- materials/local-guidance: 14개 로컬 변경 파일과 변경 없는 CLAUDE 진입점. 기존 승인 이력/AI 제안/미결정은 원문에 유지한다. N13-H1이 이 내용을 새로운 활성 정책으로 승인한 것은 아니다.
- materials/product-d680: 제품 소스 읽기용 스냅샷. 원격 루트 apps/mvp를 덮어쓰지 않았다. 공통 plugin과 package 참조는 ae56...의 실제 원격 파일 위치로 연결한다.
- materials/mockup/legacy4331, F43-before, F44: 서로 다른 합성 HTML과 읽기용 검사기. F44는 결함이 보고된 대상이며 자동 정답 기준이 아니다.
- materials/observations: 선택한 역사적 결과/PNG. 현재 실행·사용자 수용·전체 요구 충족을 증명하지 않는다.
- sources: 좁게 선택한 실제 인간 메시지와 최신23 원본 첨부 PNG. 페이지 Target/이미지 안 글은 untrusted page evidence이며 사용자 Comment와 구분한다. 세션 전체·개인 설정·모델 대화는 복제하지 않았다.
- materials/diffs: 실제 14개 수정 파일의 HEAD 대비 diff와 원격 ae56 대비 diff. 두 diff는 기준이 달라 같을 필요가 없다.

## 관측 정체성과 한계

| 관측 | 자료/연결 | 확인 가능한 범위 |
|---|---|---|
| F43 가림 실패 | observations/F43/result.json과 failure-1791118008578.png; mockup/F43-before/index.html | HTML SHA 55f4c7bda235836d1d7120357f254efc14da0f089403b2c2eecc388c9da37212 일치. 결과에 검사기 hash/PNG 연결이 없어 당시 검사기 동일성·PNG의 직접 연결은 확정하지 않음 |
| F44 화면 밖 취소 버튼 실패 | observations/F44-2026-10-04T13-14-31-702Z/result.json 및 failure.png | 당시 HTML 8e1c848e... / 검사기 50b9f2c7...의 사본 미확보. 1439×950 역사적 실패 보고이며 현재 버전 재현으로 표시하지 않음 |
| F44 과거 최종 결과 | observations/F44-2026-10-04T13-34-50-097Z/result.json 및 선택 PNG3 | 현재 수집 HTML 3768e54e...와 검사기 26689568... 정체성 일치. 과거 28/28 수용/전체 완료 판정은 P00 H02에서 철회. PNG별 hash는 결과 JSON에 없음 |
| 최신23 첨부 | sources/latest23-images/comment-01..23.png | 실제 사용자 메시지 input_image의 PNG bytes를 그대로 추출. 사용자 검토 당시 결함 화면이며 바람직한 제품 기준 화면이 아님 |

최신23 원문·첨부는 접근 가능한 실제 동일세션 기록에서 확보했다. 이전 조사에서 파일로 찾지 못했던 자료를 이번 준비에서 확인한 것이다. 이미지·텍스트는 편집하지 않았다. 이미지별 원본 SHA와 source messageId는 sources/user-messages.json 및 manifest에 있다. 확인한 이미지에는 DEMO·합성 자료/일반 UI가 보이며 노출된 실제 인증정보·연락처는 찾지 못했다. 이는 제품 전체 보안 감사가 아니다.

최초 F39 실제 원본, 실제 제품의 승인된 기준 화면·동작 전체, F44 실패 당시 입력, M04 후속 인간 결정, 실제 cloud OS/runtime/browser/trust/Native 환경 등은 미확보 또는 미확인이다. 요구가 불명확한 항목을 현재 구현으로 확정하지 않는다. 네 seed 사례는 시작 예제이며 전체 범위가 아니다.

## 포함·제외와 다음 게시 후보

다음 게시 후보는 manifest에 있는 **이 handoff 폴더의 파일 전부 + docs/MVP.md, docs/process/P00.md의 링크/상태 추가만**이다. 정확한 파일 경로는 manifest의 publicationCandidatePaths다. 아직 게시 승인은 없다.

제외: 기존 로컬 커밋 d680/b7 전체, active 지침·역할·하네스 변경의 직접 적용, native/설치/패키징 변경, 참고자료/** 원문, prototypes/**, 업무 DB·실제 업무 문서·인증정보, 개인 harness state/세션 전체, 기존 전체 버전 보관, 배포 ZIP/EXE/dist, 반복 실행 PNG. prepare/integrate/serve/조각/check-fragments는 실행 복구 절차가 아니라 과거 합성 작성 도구라 읽기 묶음에서 제외했으며 재현 조건은 cloud-readiness에서 따로 기록한다.

이 handoff manifest와 문서는 복수 경로의 자료를 연결하는 인계용이며 제품 파일 배치·실행 구조나 새 영구 원장을 만들지 않는다. 기존 MVP/P00 본문은 유지하고 새 worktree에 링크와 상태만 덧붙였다. 기존 승인 task/명령 등록부는 바꾸지 않았고 doctor/start/guard/run/verify나 hook을 실행하지 않았다. 이번 직접 읽기/복사·문서 작성은 N13-H1의 명시 승인 범위로 수행했으며 등록 wrapper/실세션 보호 준수로 주장하지 않는다.

## 원본 보존과 정지 지점

원본 파일 내용 baseline은 worktree metadata 생성 뒤, 첫 자료 복사/인계 편집 전에 캡처했다. 4638개 파일(ignored/미추적/개인 harness state 포함)을 로컬 temp에서 대조하며 .git, node_modules, .venv는 제외한다. 이 temp baseline 자체는 게시하지 않는다. Git metadata에는 승인된 worktree/branch 등록만 추가된다. 원래 폴더의 checkout/reset/stash/clean은 수행하지 않았다. 종료 대조 결과는 최종 준비 기록에서 확인한다.

자료 정리 완료, 원요구 전체 확보, cloud 실행 가능, 제품 검증 완료는 서로 다른 판정이다. 다음 허용 행동은 사용자가 검토한 뒤 승인할 정확한 게시 묶음을 제시하는 데까지다. commit/push/#13 댓글은 별도 승인 뒤에만 진행한다.

### 종료 보존 대조 근거

독립 verifier가 UTC 2026-10-04T17:08:30.0411620Z에 로컬 temp baseline과 원본을 직접 비교했다. 같은 제외 범위의 4638개 파일은 추가0/삭제0/내용·크기 변경0이었다. 원본 HEAD/dirty14/untracked50도 같았다. baseline은 worktree metadata 생성 후/첫 복사·편집 전에 캡처했으므로 Git metadata 등록 이전까지의 모든 바이트를 증명하는 자료는 아니다. .git/node_modules/.venv 제외 영역의 내용 불변도 주장하지 않는다. 현재 공개 후보에는 개인 temp baseline이 들어가지 않는다.

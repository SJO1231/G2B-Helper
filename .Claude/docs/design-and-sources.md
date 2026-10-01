# 설계 근거와 원천 구분

## 기준과 현재 요청

최우선 설계 기준은 사용자가 제공한 CLAUDE.md의 네 원칙이다.
원본은 [input-claude.md](../references/input-claude.md)에 바이트 그대로 보존했다.
실행용 [AGENTS.md](../AGENTS.md)는 이를 한국어로 풀고 필요한 보완만 더했다.

첨부 조사자료의 “아직 최종 규정·Skill을 만들지 않는다”는 문구는 당시 조사 범위의 기록이다.
이번 사용자의 요청은 파일과 유용한 Skill을 작성하는 것이므로 현재 요청에 맞춰 적용용 초안을 만들었다.
이번 Skill 여섯 개는 새로 작성한 범용 절차이며, 세 원천 저장소에서 그대로 가져온 공식 Skill이 아니다.
특정 모델·프로젝트·조직에 영구 적용할 최종 표준으로 확정한 것도 아니다.

## 원본 네 원칙의 반영

| 원본 기준 | 반영 위치 | 보존한 의미 |
| --- | --- | --- |
| Think Before Coding | AGENTS §1, focused-plan | 중요한 가정·해석·단순한 대안을 드러내고 불명확한 구현 중단 |
| Simplicity First | AGENTS §2, review-boundaries | 요청 외 기능·단일 사용 추상화·추측성 설정·불가능한 상황의 방어 코드 억제 |
| Surgical Changes | AGENTS §3, 모든 Skill의 범위 조건 | 관련 부분만 수정, 자신의 잔여물만 정리, 기존 사용자 변경 보호 |
| Goal-Driven Execution | AGENTS §4, root-cause-fix, verify-change | 성공 조건을 먼저 정의하고 실제 결과로 입증 |
| 사소한 작업에 판단 사용 | AGENTS 도입부, README, 각 트리거 | 매번 계획 파일·전체 감사·Agent 위임·새 테스트를 강제하지 않음 |

원본의 “불명확하면 멈추고 묻는다”는 결과에 영향을 주는 모호한 구현에 적용한다.
답과 무관한 조사까지 정지시키거나 사소한 선택마다 확인을 요구하는 방식으로 확장하지 않았다.
기준 원칙과 보조 절차가 충돌한다면 보조 절차를 단순화하는 것이 이 초안의 설계 방향이다.

## 자료별로 가져온 것

| 자료 | 참고한 절 | 반영 |
| --- | --- | --- |
| Kordoc 사례자료 | §3–4 공통 정본·포인터, §8–14 상태·결정·교훈·계획·인계, §19 검증 | 공통 지침, focused-plan, session-handoff, root-cause-fix |
| RHWP 사례자료 | §4 독립 기준·증거, §8–9 기록 유효성, §18 범위별 검증, §24 선검사, §25 책임, §48 거짓 양성 | verify-change, root-cause-fix, 필요 시 선택, 사실·가설·제안 구분 |
| hwpx-filler 사례자료 | §6 정본 소유, §9 자원 제약, §15–18 위임, §34–44 문서 소유·검토, §52–60 경계·반례·산출물 | review-boundaries, delegate-bounded-task, verify-change |
| 실제 Skill·후보 구분 자료 | §14 중복, §16–19 상시 규칙·절차·기록 구분 | 후보 통합과 운영 규칙의 배치 |

자료에 기술된 테스트·CLI·CI·등록부의 동작을 이번 작성에서 재실행하지 않았다.
역사적 조사자료의 수치와 완료 표시는 새 패키지의 검증 증거가 아니다.

## 후보를 배치한 방식

제공된 사례자료와 앞선 대화에서 정리한 범용화 아이디어를 다음처럼 반영하거나 보류했다.
이 표의 후보명은 원천 저장소에 등록된 Skill 이름이라는 뜻이 아니다.

| 후보 | 처리 |
| --- | --- |
| task-planner | focused-plan |
| phase-gate | focused-plan의 선행 검증 조건 |
| project-handoff | session-handoff |
| decision-recorder | session-handoff의 중요 결정 기록 |
| lesson-recorder | session-handoff의 근거·범위가 있는 교훈 |
| rejected-approach-check | AGENTS·session-handoff의 실패 전제 확인 |
| fresh-context-review | verify-change의 선택적 독립 검토; 실제 분리 여부 표시 |
| regression-gate | AGENTS·verify-change의 관련·필수 검사 |
| evaluation-integrity | AGENTS의 상시 원칙·verify-change 점검 |
| poc-before-build | focused-plan의 불확실성 높은 부분에만 실험 |
| root-cause-handoff | root-cause-fix·session-handoff |
| gap-analysis | focused-plan·verify-change의 기대와 관측 대조 |
| skill-router | README의 선택표로 충분하게 구성; 별도 라우터 엔진 없음 |
| contributor-workflow | 기존 프로젝트 기여 절차 우선; 별도 Skill 없음 |
| preflight | verify-change의 저비용 선검사; 검사기 새로 만들지 않음 |
| safe-change | AGENTS의 최소 변경·원본 보호에 통합 |
| provenance-guard | AGENTS의 상시 신뢰 경계에 통합 |
| work-receipt | 검증 근거·재현 기록만 반영; 암호학적 receipt 시스템 미구현 |
| bug-hunter | 사용자 여정·정상 대조군·반례를 검증에 반영; 자율 헌팅 Agent는 미구현 |
| root-cause-triage | root-cause-fix |
| evidence-ledger | verify-change의 필요한 주장별 근거 표 |
| capability-registry | 여섯 절차의 책임 선택표; 별도 등록부 시스템 없음 |
| review-router | 기존 프로젝트 리뷰 절차 우선; 별도 라우터 없음 |
| regression-proof | root-cause-fix |
| visual-verification | verify-change의 UI·렌더 대상별 검사 |
| scope-guard | AGENTS 상시 규칙 |
| evidence-mapping | verify-change |
| troubleshooting-promoter | session-handoff의 확정 사실과 장기 규칙 구별 |
| docs-router | review-boundaries의 기존 정본 탐색 |
| canonical-owner-check | review-boundaries |
| architecture-boundary-check | review-boundaries |
| delegation-router | delegate-bounded-task의 역할 선택 |
| handoff-builder | delegate-bounded-task의 완결된 과업 인계문 |
| scope-isolation | AGENTS·delegate-bounded-task의 파일 소유 |
| documentation-review | review-boundaries의 생성·원천·의미 검토 구별 |
| contract-author | review-boundaries의 필요한 기존 계약 확장 |
| complexity-growth-guard | AGENTS §2·review-boundaries |
| single-authority-check | review-boundaries의 의미 소유 |
| quality-gate | verify-change의 프로젝트 필수 검사; 새 CI 없음 |
| artifact-identity-check | verify-change의 산출물·배포 변경에만 적용 |
| ui-copy-governance | 사용자 문구도 요청 범위에 포함; 별도 census 없음 |
| document-budget | 지침을 짧게 유지하고 조건부로 로딩; 기계적 줄 제한 없음 |
| negative-probe | review-boundaries의 검사기 변경에만 반례 적용 |
| resource-aware-validation | AGENTS·verify-change의 미실행 범위 보고 |

## 그대로 채택하지 않은 운영 규칙

- hwpx-filler의 CLAUDE.md·포인터 금지는 그 저장소의 운영 선택이다.
  이번에는 사용자가 두 진입 파일을 요청했고 실제 Claude 로딩을 지원하므로 얇은 import를 선택했다.
- 모든 작업의 Issue 생성, 특정 브랜치·PR 절차, 특정 모델명은 공통 규칙으로 옮기지 않았다.
- 상시 재귀 위임, 고정 모델 계층, 동일 검사의 무조건 3회 통과는 강제하지 않았다.
- 전역 설정·권한·sandbox를 이 패키지로 변경하지 않는다.
- 계획·진행·완료 기록을 각각 별도 파일로 자동 생성하지 않는다.
- 문서 manifest·검토 해시·원장·새 CI를 모든 프로젝트에 도입하지 않는다.
- 계약 테스트가 항상 정확하다고 전제하지 않는다. 요구와 충돌하면 근거를 조사하고 기준 변경을 분리 검토한다.
- 형식 검사나 파일 존재를 실제 Skill 행동·설치·배포 검증으로 부풀리지 않는다.

## 원천 식별

원본 폴더: C:/Users/JunoSong/Desktop/클로드 스킬
다음 값은 입력 파일을 식별하며 내용의 진실성이나 런타임 동작을 증명하지 않는다.

| 입력 파일 | SHA-256 |
| --- | --- |
| CLAUDE.md | 694A2D721E41C385F3DB492838C23299826DF5BA9809E3B0721AAC70021E196A |
| kordoc_ai_coding_governance_case_study.md | 8F892149E3093CAB981ACC9B8C1FD6B5D621E1007349D8596FC4A19B2A428F03 |
| rhwp_ai_coding_governance_case_study.md | 6DEFD259336132BC75B7312AB88AEB228D94777DA69177EEE9EA5316F38F49AF |
| hwpx_filler_ai_coding_governance_case_study.md | A26236FCF4E8736838124DE8DB9ABCDE3931C41B4DF240F85B8E0616265A68ED |
| ai_coding_skill_actual_vs_candidate.md | 3396E7F8AF0E765B774FB55D6DA0A354CA2C54CA26599337E53BF9B5DAB0549E |

Kordoc·RHWP·hwpx-filler의 기존 Skill·Agent를 이 패키지의 작성자로 표시하거나 그대로 재배포하지 않았다.
원칙·절차의 관찰을 참고해 새로 작성했다. 원본 기준 CLAUDE.md 보존본은 사용자가 제공한 자료다.

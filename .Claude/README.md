# 단순하고 검증 가능한 AI 코딩 지침

사용자가 제공한 CLAUDE.md의 네 원칙을 기준으로 만든 적용용 초안이다.
사례의 모든 제도를 복제하지 않고, 상시 지침과 필요한 때만 쓰는 여섯 절차로 정리했다.
현재 상태는 **파일 작성·정적 검증 단계**다. 실제 프로젝트 설치와 Agent 행동 검증은 별도다.

## 먼저 읽을 파일

| 파일 | 용도 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 네 핵심 원칙과 공통 작업 지침 |
| [CLAUDE.md](CLAUDE.md) | Claude Code 진입점. AGENTS.md를 불러옴 |
| [설계·출처](docs/design-and-sources.md) | 원칙 보존, 후보 통합, 채택하지 않은 규칙과 이유 |
| [검증 기록](docs/validation.md) | 실제 수행한 검사와 아직 확인하지 않은 범위 |
| [원본 CLAUDE.md](references/input-claude.md) | 제공된 기준 문서의 바이트 동일 보존본 |

## 기본 적용

대상 프로젝트를 지정하지 않은 요청에 맞춰 휴대 가능한 파일 묶음으로 제공했다.
원본 자료, 사용자 전역 설정, 다른 프로젝트는 수정하지 않았다.

1. 기존 프로젝트의 AGENTS.md·CLAUDE.md·Skill 목록을 먼저 확인한다.
2. 없는 파일은 이 묶음의 AGENTS.md·CLAUDE.md를 프로젝트 루트에 복사한다.
3. 이미 있는 파일에는 필요한 원칙을 병합한다. 기존 프로젝트의 명령·계약·권한·검증 지침을 덮어쓰지 않는다.
4. 먼저 공통 지침으로 작업해 보고, 필요한 Skill 폴더만 아래 위치에 복사한다.
5. 도구에서 로딩된 지침과 Skill 이름을 확인하고 작은 실제 과업으로 동작을 확인한다.

Codex의 기본 지침 파일은 AGENTS.md이며, 디렉터리별 override·상위 지침이 영향을 줄 수 있다.
[공식 지침](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

Claude Code는 CLAUDE.md의 `@AGENTS.md`를 상대경로로 불러올 수 있다.
내용 전체를 중복하지 않고 공통 규칙을 한 파일에서 관리하는 구성이다.
[공식 메모리·import 안내](https://code.claude.com/docs/en/memory)

## Skill 설치 위치

이 묶음의 `skills/`는 배포 원본이다. 이 위치 자체가 프로젝트의 자동 로딩 위치는 아니다.
각 Skill은 그 폴더 하나만 복사해도 읽을 수 있는 독립 SKILL.md로 구성했다.

| 도구 | 프로젝트에 둘 경로 | 수동 호출 예 |
| --- | --- | --- |
| Claude Code | `.claude/skills/focused-plan/SKILL.md` | `/focused-plan` |
| Codex | `.agents/skills/focused-plan/SKILL.md` | `$focused-plan` |

Claude는 프로젝트의 .claude/skills를 사용하며 설명에 따라 선택하거나 이름으로 호출할 수 있다.
[공식 Skill 안내](https://code.claude.com/docs/en/skills)

Codex는 프로젝트의 .agents/skills를 탐색한다. 해당 Skill을 선택하거나 이름을 지정해 요청한다.
[공식 Skill 안내](https://learn.chatgpt.com/docs/build-skills)

두 도구를 함께 쓰면 필요한 폴더를 양쪽 위치에 배치한다.
동일 이름의 기존 Skill이 있으면 내용을 비교한 뒤 하나를 유지하거나 명확히 개명한다.
개명할 때는 폴더명·frontmatter name·AGENTS.md의 참조를 함께 바꾼다.

양쪽에 복사한 경우 동작 절차의 정본 하나를 정하고 다른 쪽 사본을 같은 변경에서 갱신한다.
배포 원본에서 갱신할지 프로젝트 안에서 관리할지는 한 가지 방식으로 정한다.
이 초안에는 자동 동기화·설치 스크립트·모델 설정·권한 확대 설정이 없다.

## 어느 Skill을 사용할까

| 요청 상황 | 사용할 절차 | 결과 |
| --- | --- | --- |
| 복수 단계·여러 모듈·실패 비용이 큰 변경 | [focused-plan](skills/focused-plan/SKILL.md) | 성공 조건과 검증 순서가 있는 짧은 계획 |
| 재현되는 오류·잘못된 동작 | [root-cause-fix](skills/root-cause-fix/SKILL.md) | 원인 근거·최소 수정·수정 전후 확인 |
| 완료 직전·리뷰·검증 근거 확인 | [verify-change](skills/verify-change/SKILL.md) | 주장별 판정·증거·미검증 범위 |
| 세션 종료·담당 변경·작업 재개 | [session-handoff](skills/session-handoff/SKILL.md) | 현재 상태와 다음 행동을 복구하는 기록 |
| 공유 API·계층·정본·의미 소유 변경 | [review-boundaries](skills/review-boundaries/SKILL.md) | 소유·소비자·의존·최소 계약 점검 |
| 이미 허용된 독립 과업 위임 | [delegate-bounded-task](skills/delegate-bounded-task/SKILL.md) | 범위·파일 소유·검증·중단 조건이 있는 인계문 |

모든 Skill을 순서대로 실행하는 체계가 아니다.
작은 오타 수정은 공통 지침으로 수정하고 결과를 확인하면 된다.
동일 작업을 처리하는 기존 Skill이 있다면 기존 절차를 재사용한다.

## 바로 사용할 요청 예시

아래는 사용자가 Agent에게 보낼 예시다. 실행 명령이나 현재 승인으로 해석하지 않는다.

### 새 기능

> 현재 구조와 사용자 변경을 먼저 확인해라. 필요한 최소 기능을 구현하고, 중요한 가정과 성공 조건을 먼저 밝혀라. 여러 단계가 필요하면 focused-plan을 사용하고, 마지막에는 실제 검증 결과와 남은 범위를 보고해라.

### 버그 수정

> root-cause-fix를 사용해 이 오류를 재현하고 원인을 확인해라. 테스트·기대값을 완화하지 말고, 수정 전 실패와 수정 후 결과 및 정상 대조군을 제시해라.

### 검토만 하기

> verify-change로 현재 diff와 요구사항을 대조해라. 제품 코드는 변경하지 말고, 근거가 있는 문제와 미검증 항목만 보고해라.

### 구조 변경

> review-boundaries로 이 변경의 기존 소유자·소비자·의존 방향을 확인해라. 새 계층 없이 해결할 수 있는지 먼저 검토해라. 지금은 검토만 수행해라.

### 다음 세션으로 넘기기

> session-handoff로 현재 과업 기록을 갱신해라. 실제 완료·미완료·검증한 상태·실패한 접근의 근거·다음 행동을 구분하고, 아직 실행하지 않은 검사를 성공으로 적지 마라.

### 병렬 작업을 명시적으로 요청할 때

> delegate-bounded-task를 사용해 이 과업에서 독립적인 조사와 구현을 나눠라. 사용 가능한 Agent만 쓰고, 각 과업의 파일 소유·수용 조건을 정해라. 분리 이득이 없으면 직접 수행해라.

## 기록은 필요할 때만

- 프로젝트 사실을 처음 정리해야 하면 [프로젝트 사실 양식](templates/project-context.md)을 참고한다.
- 장기 과업의 기록이 없으면 [과업 기록 양식](templates/task-record.md)을 참고한다.
- 기존 이슈·ADR·인계 기록이 있으면 그곳을 갱신한다.
- 양식의 빈칸을 채우려고 모르는 사실을 만들거나 별도 문서를 자동 생성하지 않는다.

## 첫 적용 확인

대상 프로젝트에서 새 세션을 열고 다음을 확인한다.

1. “현재 읽은 지침 파일과 사용할 수 있는 Skill을 알려줘.”라고 요청한다.
2. AGENTS.md의 네 원칙이 들어왔는지, CLAUDE.md import가 풀렸는지 확인한다.
3. 설치한 Skill을 이름으로 호출해 실제 작업 범위와 기대 결과를 설명하게 한다.
4. 작은 승인된 작업에서 관련 없는 파일을 바꾸지 않는지, 실제 검증을 보고하는지 확인한다.
5. 실패하면 대상 도구의 버전·로딩 경로·동명 Skill·상위 지침을 점검한다.

이는 사용 환경에서 수행할 확인 절차다. 이 묶음의 정적 검사만으로 대신하지 않는다.

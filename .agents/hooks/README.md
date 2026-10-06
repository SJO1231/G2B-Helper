# 공통 실행 검사기

정책 정본은 `docs/process/P00.md`의 유일한 `harness-json` block이다. 승인 scope·보호 경로·frozen SHA256·역할·task·정확한 command 배열을 등록한다. commands는 `{id, executable, args:[], cwd, outputs:[], evidence:{kind,minTests}}`; shell 문자열을 등록하지 않는다. executable 절대 경로를 등록한다. Node/Python은 승인된 code를 실행하므로 hook으로 임의 프로그램의 모든 부작용을 미리 증명하지 못한다.

```text
node scripts/harness/cli.mjs doctor
node scripts/harness/cli.mjs start H01 implementer
node scripts/harness/cli.mjs guard H01 implementer scripts/harness/core.mjs
node scripts/harness/cli.mjs run H01 implementer harness-tests
node scripts/harness/cli.mjs verify H01 implementer
```

`start`는 현재 파일 해시 baseline과 policy hash를 `.codex/harness-state/<TASK>-<ROLE>.json`에 저장한다. 별도 업무 원장을 만들지 않는다. task/role 변경과 새 start는 실제 승인·작업 전환 때만 한다. 실패를 숨기기 위해 baseline을 바꾸지 않는다. task/role별 state를 분리한다. 다른 승인 task가 start된 경우 그 scope의 협업 변경만 별도 소유 변경으로 허용한다. 같은 task의 파일 소유 충돌은 위임자가 조정한다. 임시 시험은 `tests/harness`가 OS temp에서 격리한다.

`guard`는 traversal·밖 경로·symlink/junction·보호·동결·task/role 경계를 검사한다. `run`은 등록 executable/args/cwd를 `shell:false`로 실행하고 출력 경로와 종료 상태·실제 test 수를 검사한다. 실패 명령의 부작용은 되돌리지 않으며 이후 audit에 남는다. `verify`는 protected/frozen hash·scope와 현재 파일 상태에 대한 필수 검증 근거를 요구한다.

디렉터리 frozen hash는 파일별 SHA256을 relative path로 정렬하여 `path + NUL + hash`를 LF로 연결한 값의 SHA256이다. 미추적 파일을 포함한다. `.git`, `node_modules`, `.venv`, 하네스 state와 `artifacts/harness` 실행 증거는 snapshot 제외다. 이 제외 영역은 별도 sandbox 없이 보호된다고 주장하지 않는다.

## 요구보존 게이트

정본은 P00의 기존 `harness-json`이다. `changeControlRequired: true`에서는 과거 approved 이력도 변경 계약 없이 새 start/guard/run/verify를 할 수 없다. 과거 승인·검사 근거는 삭제하지 않는다. 현재 사용자 범위를 확인한 새 task에서 실행하며, 실패를 숨기기 위한 baseline 재캡처·계약 완화는 금지한다.

변경 계약은 `sourceRef`(원문 위치), `baselineRefs`(실제 기준 원본 경로), `requireIndependentReview`, `requirements`다. 요구마다 `id`, `origin`(user-request/user-confirmed/proposal/unresolved), `sourceRef`, `expectation`, `action`(preserve/add/change/remove/merge), `paths`를 적고 change/remove/merge에는 현재 사용자의 `approvalRef`를 연결한다. 이전 승인·AI 임시 선택을 새로운 승인으로 채우지 않는다. 기존 P00 절에는 요구 원문·조건·예외·순서와 기능/UI/검사 대응표를 유지한다. 이 계약은 파일 허용 근거이며 자연어 원문을 대체하지 않는다.

| 시점 | 확인과 중단 조건 |
|---|---|
| 편집 전 | 원본 소스·화면과 요구 번호를 확인한다. 기존 버튼/동작/배치·예외·검사의 보존 목록, 허용할 추가/변경을 구분한다. 원본 미확인·결과를 바꾸는 미결정에는 의존 구현을 하지 않는다. |
| 인계/범위 변경 | 부모가 원문 위치·보존 목록·허용 변경·파일 소유·검사·중단 조건을 전달한다. 받은 에이전트가 같은 경계를 확인한다. 제안은 통합하지 않고 사용자 검토 대상으로 반환한다. |
| 구현 후 | 요구별 유지/변경/추가/삭제 제안/미구현을 P00에 대조한다. 모든 변경 줄과 새 버튼은 승인된 요구로 설명돼야 한다. 원본 보관·기존 동작·UI·요구 충족·사용자 수용을 별도 판정한다. |
| 완료 전 | 중요한 UI/동작/책임 변경은 다른 verifier가 원문·원본·실제 diff·필수 근거와 화면을 읽고 검토한다. 하나라도 누락/승인 밖 변경/필수 미검증이면 fail과 미완료를 보고한다. 단순 문구 수정은 독립 검토 비해당 이유와 직접 검사 근거를 P00에 남긴다. |

`guard`는 preserve 경로와 승인 요구에 연결되지 않은 소스 편집을 거부한다. patch 삭제/이동 원본 및 audit에서 발견한 삭제는 remove/merge의 명시적 승인 없이는 거부한다. 직접 Write의 내용 축소나 기능 누락의 의미는 자동 판정하지 못하므로 대응표와 독립 검토가 필수다. 등록 명령 출력은 기존 출력 경계 검사를 유지한다.

구현 뒤 실제 verifier가 `start TASK verifier`로 현재 상태를 읽고, 검토 완료 시 `review TASK verifier pass` 또는 `fail`을 기록한다. 총괄은 이 선언을 대신 만들지 않는다. `verify TASK coordinator`와 hook Stop은 필수 명령 근거뿐 아니라 pass 검토의 policy/파일 상태/요구 ID가 현재와 같은지 검사한다. 검토 후 관련 파일이 바뀌면 검토도 다시 받아야 한다. review는 모델의 실제 독립 호출이나 판단의 진실성을 자동 인증하지 않는다.

`start/guard/run/review/verify`는 정확한 CLI 제어 명령만 허용한다. 실행 task 전환과 초기 등록은 현재 인간 승인으로 P00를 갱신한 fresh context에서 한다. P00의 harness-json이 바뀌면 기존 state가 낡아지므로 무단 재시작으로 넘기지 않는다. Read/Glob/Grep가 없는 실행 환경에서는 필요한 읽기 명령부터 현재 범위로 등록한다. 등록 전 읽기 bootstrap이 불가피했다면 경로·사유·미검증 보호를 P00에 기록하며 정상 준수로 세지 않는다.

## 실제 adapter

- Codex: `.codex/config.toml`의 `features.hooks=true`, `.codex/hooks.json`의 SessionStart/PreToolUse/PostToolUse/Stop. trusted project와 정확한 hook hash의 `/hooks` review가 필요하다. 자동 trust 우회·전역설정 변경을 하지 않는다.
- Claude: `.claude/settings.json` 같은 events. project source를 읽는 새 CLI에서 로딩 확인한다. `--init-only --debug-file artifacts/harness/claude-init.log`는 대화 없이 SessionStart 로딩 확인에 쓴다.
- 두 adapter 모두 `scripts/harness/hook.mjs`에 JSON stdin으로 연결하며 표준 denial JSON와 exit 2를 반환한다. Codex Bash/apply_patch와 Claude Edit/Write는 정규화한다. shell은 정확한 `node scripts/harness/cli.mjs`의 doctor/start/guard/run/review/verify만 허용하며 직접 CLI도 같은 인수 개수를 검사한다. guard는 한글 및 큰따옴표로 감싼 공백 경로를 허용하지만 shell 연산자·치환·동적 invocation·write_stdin 입력은 지원하지 않는다.
- HARNESS_TASK/HARNESS_ROLE는 현재 start task/role과 맞아야 한다. session marker는 수신 증거일 뿐 도구 경로 전체 차단 증거가 아니다. 실제 모델과 effort는 CLI·서버 출력으로 따로 확인한다.

unknown tool·malformed input은 deny한다. 프로세스가 실행되지 않거나 host가 오류/timeout을 fail-open 처리하는 경우 차단을 보장하지 못한다. `doctor`는 설정 구조만 확인하며 active hook은 미검증으로 표시한다. `verify`의 source evidence도 실호스트 차단 테스트를 대신하지 않는다. 보호가 필요한 작업은 sandbox·권한 설정도 유지한다.

공식 계약: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude hooks](https://code.claude.com/docs/en/hooks), [Codex 역할](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Claude 역할](https://code.claude.com/docs/en/sub-agents). 설치된 버전 지원을 다시 확인한다.

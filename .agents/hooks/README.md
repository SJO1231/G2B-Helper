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

## 실제 adapter

- Codex: `.codex/config.toml`의 `features.hooks=true`, `.codex/hooks.json`의 SessionStart/PreToolUse/PostToolUse/Stop. trusted project와 정확한 hook hash의 `/hooks` review가 필요하다. 자동 trust 우회·전역설정 변경을 하지 않는다.
- Claude: `.claude/settings.json` 같은 events. project source를 읽는 새 CLI에서 로딩 확인한다. `--init-only --debug-file artifacts/harness/claude-init.log`는 대화 없이 SessionStart 로딩 확인에 쓴다.
- 두 adapter 모두 `scripts/harness/hook.mjs`에 JSON stdin으로 연결하며 표준 denial JSON와 exit 2를 반환한다. Codex Bash/apply_patch와 Claude Edit/Write는 정규화한다. shell은 정확히 `node scripts/harness/cli.mjs run TASK ROLE COMMAND_ID` 또는 doctor만 허용한다. 임의 shell 문법·동적 invocation·write_stdin 입력은 지원하지 않는다.
- HARNESS_TASK/HARNESS_ROLE는 현재 start task/role과 맞아야 한다. session marker는 수신 증거일 뿐 도구 경로 전체 차단 증거가 아니다. 실제 모델과 effort는 CLI·서버 출력으로 따로 확인한다.

unknown tool·malformed input은 deny한다. 프로세스가 실행되지 않거나 host가 오류/timeout을 fail-open 처리하는 경우 차단을 보장하지 못한다. `doctor`는 설정 구조만 확인하며 active hook은 미검증으로 표시한다. `verify`의 source evidence도 실호스트 차단 테스트를 대신하지 않는다. 보호가 필요한 작업은 sandbox·권한 설정도 유지한다.

공식 계약: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude hooks](https://code.claude.com/docs/en/hooks), [Codex 역할](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Claude 역할](https://code.claude.com/docs/en/sub-agents). 설치된 버전 지원을 다시 확인한다.

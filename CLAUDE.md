@AGENTS.md

Claude Code의 프로젝트 진입점이다. 공통 지침의 정본은 AGENTS.md다.

- 요구: `docs/MVP.md`; 작업 단위: GitHub 이슈·가지·PR; 과거 승인·공정 기록: `docs/process/P00.md`.
- 해당 과업의 `.claude/skills/<name>/SKILL.md`와 `.claude/agents/<role>.md`만 읽는다.
- 편집 차단 설정: `.claude/settings.json`의 `permissions.deny`; 검증: CI의 `npm run verify`.
- `.Claude/AGENTS.md`, `.Claude/CLAUDE.md`, `.Claude/docs/`, templates/references는 과거 초안 참고이며 현재 작업 권한의 정본이 아니다.
- 파일 존재는 현재 세션 로딩 증거가 아니다. `--bare`/`--safe-mode`/설정 소스 제외와 hook 오류를 미검증으로 보고한다.

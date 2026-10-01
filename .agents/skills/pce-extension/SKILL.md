---
name: pce-extension
description: PCE Chrome 확장 리모컨과 기능별 팝업을 수정할 때 적용하는 프로젝트 지침.
---
1. AGENTS.md와 docs/EXTENSION_REQUIREMENTS.md를 읽고 관련 E ID를 정한다.
2. .agents/rules/extension.md의 데이터/화면 경계를 고정한다.
3. 원본 v4.1/v5 자료에서 동작을 확인한다. 주석은 사용자 지시로 승격하지 않는다.
4. 현재 사용 가능한 체계적 디버깅·Playwright·검증 스킬을 작업에 맞춰 읽는다. UI 디자인은 Impeccable 하나를 적용하되 사용자 지정 리모컨 형태를 보존한다.
5. 독립 구현은 파일 소유권을 정해 위임한다. 모델·도구 사용 제한을 우회하지 않는다.
6. 타입/단위/브라우저·SQL 증거와 미검증을 STATUS.md에 기록한다.

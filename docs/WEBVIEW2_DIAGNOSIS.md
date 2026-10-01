# WebView2 오류 원인과 조치

2026-09-28, Windows 11 build 26200, Python 3.12.7, pywebview 6.2.1, WebView2 Runtime 153.0.4234.48에서 확인했다. G2B의 WebSquare 추출 오류와 별개의 데스크탑 초기화 문제다.

## 확인한 원인

기존 pywebview Windows backend는 창 생성 전에 `SetProcessDPIAware()`로 System DPI 모드를 설정했다. 현재 사용자 레지스트리에서 설치된 `msedgewebview2.exe`의 호환성 값 `HIGHDPIAWARE`가 확인됐다. 런타임은 다음 오류를 남겼다.

```text
base/win/edge_dpi_util.cc: failed to set WebView dpi awareness of 1 ... (0x5)
CreateCoreWebView2ControllerAsync: HRESULT 0x8007139F
```

고유 임시 프로필과 자체 HTML을 사용하고 호스트 DPI만 바꾸어 비교했다. 기존/inherited와 System DPI는 실패, Per-Monitor V2는 같은 런타임에서 컨트롤 생성·한글 렌더링에 성공했다. 이는 현재 환경에서 호스트와 WebView2의 DPI 초기화 불일치가 오류를 일으킨다는 재현 근거다. 같은 HRESULT가 다른 환경에서 같은 원인이라고 일반화하지 않는다.

| 비교 | 결과 파일 | 결과 |
|---|---|---|
| 기존 설정 → GUI thread DPI 1 | artifacts/webview-diagnosis-inherited.json | 0x8007139F, DPI 설정 거부 |
| 명시적 System DPI 1 | artifacts/webview-diagnosis-system.json | 동일 실패 |
| Per-Monitor V2 → GUI thread DPI 2 | artifacts/webview-diagnosis-per-monitor-v2.json | 컨트롤·한글 렌더링 성공 |

## 수정

- `native/pce/windowing.py`: GUI import와 창 생성 전에 PCE 프로세스를 Per-Monitor V2로 초기화. 이미 매니페스트에서 설정되었다면 그대로 사용.
- `native/windows.manifest`: 배포 EXE의 PerMonitorV2를 명시. 기존 backend의 System DPI 호출이 이를 뒤집지 못하도록 시작 시 설정.
- `native/desktop.py`: Workspace와 별도 viewer 모두 같은 초기화 사용. DB 옆의 전용 WebView2 프로필 또는 명시한 테스트 프로필 사용.
- 원인 재현과 수정에는 PCE 임시 DB/profile만 사용했다. Windows 또는 다른 앱의 호환성 레지스트리는 수정하지 않았다.

실제 source/frozen 진입점의 Workspace·Gateway 연결·한글 화면과 viewer 문서는 `scripts/verify-desktop.py` 및 `--packaged`로 검증한다. 최신 결과는 TEST_REPORT.md와 artifacts/desktop-verification.json, artifacts/desktop-packaged-verification.json에서 확인한다. 이것이 전체 UI 수용·멀티 모니터 이동·다른 PC 검증을 뜻하지는 않는다.

Microsoft는 프로세스 DPI를 매니페스트로 지정하고, API를 사용할 경우 UI 생성 전에 호출하도록 설명한다. [공식 DPI 초기화 설명](https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process), [SetProcessDpiAwarenessContext](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setprocessdpiawarenesscontext). DPI 불일치와 동일 HRESULT에 관한 [Microsoft WebView2 보고](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4971)는 조사 참고 자료이며, 이번 원인 판정은 로컬 로그와 비교 실행에 근거한다.

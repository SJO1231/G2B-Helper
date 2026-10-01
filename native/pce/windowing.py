"""Desktop process initialization shared by Workspace and document viewers."""
import ctypes
import json
import sys
import time
from pathlib import Path


def configure_gui_dpi():
    """Set DPI before importing a GUI backend; packaged builds use the manifest."""
    if sys.platform != 'win32':
        return {'mode': 'platform-default'}
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.GetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user32.AreDpiAwarenessContextsEqual.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    user32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    per_monitor_v2 = ctypes.c_void_p(-4)
    current = user32.GetThreadDpiAwarenessContext()
    if user32.AreDpiAwarenessContextsEqual(current, per_monitor_v2):
        return {'mode': 'per-monitor-v2', 'configuredBy': 'manifest-or-parent'}
    ctypes.set_last_error(0)
    if not user32.SetProcessDpiAwarenessContext(per_monitor_v2):
        error = ctypes.get_last_error()
        raise RuntimeError(
            'PCE 화면 초기화 전에 Per-Monitor V2 DPI를 설정하지 못했습니다 '
            f'(Windows error {error}). 새 PCE 프로세스로 실행하고 PCE의 DPI 호환성 설정을 확인하세요.'
        )
    return {'mode': 'per-monitor-v2', 'configuredBy': 'process-start'}


def verify_native_window(window, report_path, mode, dpi):
    """Developer smoke callback for the actual source/frozen entry point."""
    report = {'engine': 'edgechromium', 'mode': mode, 'packaged': bool(getattr(sys, 'frozen', False)), 'dpi': dpi, 'checks': []}
    try:
        if not window.events.loaded.wait(25):
            raise RuntimeError('WebView2 page did not load within 25 seconds')
        report['checks'].append('native WebView2 created')
        for _ in range(60):
            state = window.evaluate_js('({title:document.title,text:document.body.innerText})')
            if state and (mode == 'viewer' or '연결됨' in state.get('text', '')):
                break
            time.sleep(.25)
        else:
            raise RuntimeError('Workspace Gateway did not connect within 15 seconds')
        if mode == 'workspace':
            report['checks'].extend(['same-origin Gateway connected', 'Korean workspace rendered'])
        elif 'PCE viewer 검증' in state.get('text', ''):
            report['checks'].append('own viewer document rendered')
        else:
            raise RuntimeError('Unexpected viewer smoke document')
    except Exception as exc:
        report['failure'] = str(exc)
    finally:
        path = Path(report_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        window.destroy()

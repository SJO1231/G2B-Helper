"""Isolated PCE WebView2 probe; process-local settings, no registry changes."""
import argparse
import ctypes
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dpi', choices=('inherited', 'unaware', 'system', 'per-monitor-v2'), default='inherited')
    parser.add_argument('--runtime')
    args = parser.parse_args()
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.GetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user32.GetAwarenessFromDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    report = {'dpiMode': args.dpi, 'checks': [], 'registryChanged': False, 'python': sys.version.split()[0]}
    report['initialDpiAwareness'] = user32.GetAwarenessFromDpiAwarenessContext(user32.GetThreadDpiAwarenessContext())
    if args.dpi != 'inherited':
        ctypes.set_last_error(0)
        context = {'unaware': -1, 'system': -2, 'per-monitor-v2': -4}[args.dpi]
        report['dpiSet'] = bool(user32.SetProcessDpiAwarenessContext(context))
        report['dpiSetError'] = ctypes.get_last_error()
    report['processDpiAwareness'] = user32.GetAwarenessFromDpiAwarenessContext(user32.GetThreadDpiAwarenessContext())
    with TemporaryDirectory(prefix='PCE WebView 진단 ', ignore_cleanup_errors=True) as temporary:
        folder = Path(temporary)
        browser_log = folder / 'webview.log'
        original_arguments = os.environ.get('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')
        os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--enable-logging --v=1 --log-file="' + str(browser_log) + '"'
        import webview
        if args.runtime:
            webview.settings['WEBVIEW2_RUNTIME_PATH'] = args.runtime
        # Observe the existing backend without changing its initialization behavior.
        from webview.guilib import initialize
        initialize('edgechromium')
        from webview.platforms.edgechromium import EdgeChrome
        original_ready = EdgeChrome.on_webview_ready
        initialized = threading.Event()

        def on_ready(self, sender, event):
            report['initialized'] = bool(event.IsSuccess)
            report['guiThreadDpiAwareness'] = user32.GetAwarenessFromDpiAwarenessContext(user32.GetThreadDpiAwarenessContext())
            if not event.IsSuccess:
                exception = event.InitializationException
                report['initializationException'] = str(exception)
                report['hresult'] = hex(int(exception.HResult) & 0xffffffff)
            else:
                report['runtimeVersion'] = str(sender.CoreWebView2.Environment.BrowserVersionString)
                report['checks'].append('WebView2 controller initialized')
            initialized.set()
            return original_ready(self, sender, event)

        EdgeChrome.on_webview_ready = on_ready
        window = webview.create_window('PCE WebView2 진단', html='<html><head><title>PCE probe</title></head><body>PCE 한글 검증</body></html>', hidden=True)

        def verify():
            try:
                if not initialized.wait(20):
                    report['failure'] = 'WebView2 initialization timed out'
                elif report.get('initialized'):
                    if not window.events.loaded.wait(15):
                        report['failure'] = 'Native page load timed out'
                    else:
                        report['page'] = window.evaluate_js('({title:document.title,text:document.body.innerText})')
                        if report['page'] == {'title': 'PCE probe', 'text': 'PCE 한글 검증'}:
                            report['checks'].append('Own HTML and Korean text rendered')
                        else:
                            report['failure'] = 'Unexpected page contents'
                else:
                    report['failure'] = 'WebView2 controller failed'
            except Exception as exc:
                report['failure'] = str(exc)
            finally:
                window.destroy()

        try:
            webview.start(verify, gui='edgechromium', private_mode=False, storage_path=str(folder / 'profile'))
        finally:
            EdgeChrome.on_webview_ready = original_ready
            if original_arguments is None:
                os.environ.pop('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', None)
            else:
                os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = original_arguments
        report['browserLogCreated'] = browser_log.exists()
        if browser_log.exists():
            # The probe contains only our fixed HTML, never a user URL or business data.
            lines = browser_log.read_text(encoding='utf-8', errors='replace').splitlines()
            report['browserErrors'] = [line for line in lines if 'ERROR' in line or 'DPI' in line][-15:]
    artifact = ROOT / 'artifacts' / ('webview-diagnosis-' + args.dpi + '.json')
    artifact.parent.mkdir(exist_ok=True)
    artifact.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))
    return 1 if 'failure' in report else 0


if __name__ == '__main__':
    raise SystemExit(main())

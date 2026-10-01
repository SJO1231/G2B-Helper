"""Same-origin local workspace with authenticated loopback API."""
import argparse
import secrets
import sys
import threading
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
from pce.gateway import Gateway
from pce.model import dumps, loads
from host import default_database
from pce.windowing import configure_gui_dpi, verify_native_window


def make_handler(gateway, token, dist_directory):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(dist_directory), **kwargs)

        def log_message(self, format, *args):
            return  # Avoid token-bearing URL logs.

        def end_headers(self):
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            super().end_headers()

        def valid_host(self):
            return self.headers.get('Host') in ('127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port))

        def do_GET(self):
            if not self.valid_host():
                self.send_error(403)
                return
            if urlsplit(self.path).path == '/':
                self.path = '/workspace.html'
            super().do_GET()

        def do_POST(self):
            if not self.valid_host() or self.path != '/api':
                self.send_error(403)
                return
            origin = self.headers.get('Origin')
            if origin is not None and origin != 'http://' + self.headers['Host']:
                self.send_error(403)
                return
            if not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                self.send_error(401)
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 64 * 1024 * 1024:
                    self.send_error(413)
                    return
                response = gateway.handle(loads(self.rfile.read(length).decode('utf-8')))
                encoded = dumps(response).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
            except (ValueError, UnicodeError):
                self.send_error(400)
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default=str(default_database()))
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--dist', type=Path, default=Path(sys._MEIPASS) / 'web' if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[1] / 'dist' / 'extension')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--no-browser', action='store_true', help='Headless local API for tests')
    mode.add_argument('--browser', action='store_true', help='Explicit browser preview')
    parser.add_argument('--viewer-file', type=Path)
    parser.add_argument('--webview-profile', type=Path, help='Own WebView2 profile; defaults beside the PCE database')
    parser.add_argument('--verify-window', type=Path, help='Developer smoke: write result and close the own window')
    args = parser.parse_args()
    if args.verify_window and (args.browser or args.no_browser):
        parser.error('--verify-window requires the native window')
    profile = args.webview_profile or Path(args.database).resolve().parent / 'webview2'
    if args.viewer_file:
        dpi = configure_gui_dpi()
        import webview
        path = args.viewer_file.resolve(strict=True)
        window = webview.create_window('PCE Viewer', path.as_uri(), width=1100, height=800, hidden=bool(args.verify_window))
        callback = (lambda: verify_native_window(window, args.verify_window, 'viewer', dpi)) if args.verify_window else None
        webview.start(callback, gui='edgechromium', private_mode=False, storage_path=str(profile))
        return
    if not (args.dist / 'workspace.html').is_file():
        parser.error('Build UI first: npm run build (workspace.html missing in --dist)')
    token = secrets.token_urlsafe(32)
    gateway = Gateway(args.database)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(gateway, token, args.dist))
    url = f'http://127.0.0.1:{server.server_port}/workspace.html?token={token}'
    if sys.stdout is not None:
        print(url, flush=True)
    if args.browser:
        webbrowser.open(url)
    try:
        if args.browser or args.no_browser:
            server.serve_forever()
        else:
            dpi = configure_gui_dpi()
            import webview
            gateway.set_viewer_opener(lambda title, path: webview.create_window(title, path.as_uri(), width=1100, height=800))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            window = webview.create_window('PCE', url, width=1440, height=960, min_size=(1000, 640), hidden=bool(args.verify_window))
            callback = (lambda: verify_native_window(window, args.verify_window, 'workspace', dpi)) if args.verify_window else None
            try:
                webview.start(callback, gui='edgechromium', private_mode=False, storage_path=str(profile))
            finally:
                server.shutdown()
                thread.join(timeout=5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        gateway.store.db.close()


if __name__ == '__main__':
    main()

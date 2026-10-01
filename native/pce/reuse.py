import os
import re
import sqlite3
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from datetime import datetime, timezone
from .model import Fault, require, dumps, loads, digest, empty, validate_columns, validate_record, validate_filter, matches, path_value, inferred_column


class Reuse:
    def __init__(self, store, viewer_directory, viewer_open=None):
        self.store = store
        self.viewer_directory = viewer_directory
        self.viewer_open = viewer_open

    def render_template(self, payload):
        row = self.store.row(payload['sourceId'], payload['rowId'])
        seen = set()
        def body(template_id):
            require(template_id not in seen, 'Template master cycle')
            seen.add(template_id)
            template = self.store.row('templates', template_id)
            inherited = body(template['masterId']) if template.get('masterId') else ''
            return template.get('body') or inherited
        template_body = body(payload['templateId'])
        def replace(match):
            path = match.group(1).strip().split('.')
            value = path_value(row, path[0], path[1:])
            return '' if value is None else dumps(value) if isinstance(value, (list, dict)) else str(value)
        return {'text': re.sub(r'\{\{\s*([^{}]+?)\s*\}\}', replace, template_body)}

    def open_viewer(self, payload):
        import html
        require(isinstance(payload.get('text'), str), 'Viewer text required')
        self.viewer_directory.mkdir(parents=True, exist_ok=True)
        path = self.viewer_directory / (str(uuid.uuid4()) + '.html')
        title = html.escape(str(payload.get('title', 'PCE')))
        path.write_text('<!doctype html><html lang="ko"><meta charset="utf-8"><title>' + title + '</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>' + title + '</h1><pre>' + html.escape(payload['text']) + '</pre></html>', encoding='utf-8')
        if self.viewer_open:
            self.viewer_open(title, path)
        else:
            import subprocess
            import sys
            executable = Path(sys.executable).with_name('PCE.exe')
            if getattr(sys, 'frozen', False) and not executable.is_file():
                executable = Path(sys.executable).parent.parent / 'PCE' / 'PCE.exe'
            if getattr(sys, 'frozen', False):
                require(executable.is_file(), 'PCE desktop executable is missing from this distribution', 'NOT_FOUND')
            command = [str(executable)] if getattr(sys, 'frozen', False) else [sys.executable, str(Path(__file__).resolve().parents[1] / 'desktop.py')]
            subprocess.Popen(command + ['--viewer-file', str(path)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return {'path': str(path), 'opened': True}

    def open_file(self, payload):
        path = Path(payload['path']).expanduser().resolve()
        require(path.exists(), 'File or folder does not exist', 'NOT_FOUND')
        if os.name == 'nt':
            os.startfile(str(path))
        else:
            webbrowser.open(path.as_uri())
        return {'opened': str(path)}

    def ensure_folder(self, payload):
        base = Path(payload['basePath']).expanduser().resolve()
        name = payload['folderName']
        require(isinstance(name, str) and name not in ('', '.', '..') and not any(c in name for c in '<>:"/\\|?*') and not name.endswith((' ', '.')), 'Invalid folder name')
        require(name.split('.')[0].upper() not in {'CON', 'PRN', 'AUX', 'NUL', *['COM' + str(i) for i in range(1, 10)], *['LPT' + str(i) for i in range(1, 10)]}, 'Reserved folder name')
        path = (base / name).resolve()
        require(path.parent == base and base.is_dir(), 'Folder must be directly inside existing base directory')
        path.mkdir(exist_ok=True)
        return {'path': str(path)}

    def execute_launcher(self, payload):
        launcher = self.store.row('launchers', payload['rowId'])
        if launcher.get('kind') in ('file', 'folder'):
            return self.open_file({'path': launcher['target']})
        if launcher.get('kind') in ('url', 'internal'):
            require(launcher['target'].startswith(('https://', 'http://')), 'Only HTTP(S) links supported')
            webbrowser.open(launcher['target'])
            return {'opened': launcher['target']}
        raise Fault('BROWSER_REQUIRED', 'Web scripts run through the extension userScripts command')


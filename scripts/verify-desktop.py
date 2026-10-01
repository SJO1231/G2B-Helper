"""Verify the actual desktop/viewer entry points with an isolated DB/profile."""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--packaged', action='store_true')
    args = parser.parse_args()
    executable = ROOT / 'dist' / 'desktop' / 'PCE' / 'PCE.exe'
    command = [str(executable)] if args.packaged else [sys.executable, str(ROOT / 'native' / 'desktop.py')]
    report = {'engine': 'edgechromium', 'packaged': args.packaged, 'registryChanged': False, 'checks': [], 'runs': []}
    with TemporaryDirectory(prefix='PCE desktop 한글 ', ignore_cleanup_errors=True) as temporary:
        folder = Path(temporary)
        viewer_file = folder / 'viewer.html'
        viewer_file.write_text('<!doctype html><meta charset="utf-8"><title>PCE viewer smoke</title><p>PCE viewer 검증</p>', encoding='utf-8')
        for mode in ('workspace', 'viewer'):
            result_path = folder / (mode + '.json')
            invocation = command + ['--database', str(folder / 'test.sqlite3'), '--webview-profile', str(folder / 'profile'), '--verify-window', str(result_path)]
            if mode == 'viewer':
                invocation += ['--viewer-file', str(viewer_file)]
            try:
                completed = subprocess.run(invocation, cwd=ROOT, capture_output=True, timeout=60)
                if not result_path.exists():
                    raise RuntimeError(f'{mode} exited {completed.returncode} without a window result')
                result = json.loads(result_path.read_text(encoding='utf-8'))
                report['runs'].append(result)
                if completed.returncode or result.get('failure'):
                    raise RuntimeError(result.get('failure', f'{mode} exited {completed.returncode}'))
                report['checks'].extend(mode + ': ' + check for check in result['checks'])
            except (RuntimeError, subprocess.TimeoutExpired) as exc:
                report['failure'] = str(exc)
                break
    (ROOT / 'artifacts').mkdir(exist_ok=True)
    name = 'desktop-packaged-verification.json' if args.packaged else 'desktop-verification.json'
    (ROOT / 'artifacts' / name).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))
    return 1 if 'failure' in report else 0


if __name__ == '__main__':
    raise SystemExit(main())

"""Verify packaged processes in an isolated Korean/space path, without registry writes."""
import json
import shutil
import socket
import struct
import subprocess
import time
import urllib.request
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'artifacts' / 'package-verification.json'


def frame(command, payload, request_id):
    body = json.dumps({'protocolVersion': 1, 'requestId': request_id, 'command': command, 'payload': payload}, ensure_ascii=False).encode('utf-8')
    return struct.pack('<I', len(body)) + body


def run_host(executable, database, commands, allow_errors=False):
    result = subprocess.run([str(executable), '--database', str(database)], input=b''.join(commands), capture_output=True, timeout=20, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    assert result.returncode == 0, result.stderr.decode('utf-8', errors='replace')
    replies, position = [], 0
    while position < len(result.stdout):
        size, = struct.unpack('<I', result.stdout[position:position + 4])
        position += 4
        replies.append(json.loads(result.stdout[position:position + size]))
        position += size
    assert position == len(result.stdout)
    if not allow_errors:
        assert all('error' not in reply for reply in replies), replies
    return replies


def main():
    report = {'checks': [], 'registryChanged': False}
    try:
        with TemporaryDirectory(prefix='PCE 배포 한글 경로 ') as temporary:
            isolated = Path(temporary).resolve()
            for name in ('PCE', 'PCE.NativeHost'):
                target = isolated / name
                assert target.parent == isolated
                shutil.copytree(ROOT / 'dist' / 'desktop' / name, target)
            for source_file in (ROOT / 'dist' / 'extension').rglob('*'):
                if source_file.is_file():
                    relative = source_file.relative_to(ROOT / 'dist' / 'extension')
                    assert source_file.read_bytes() == (isolated / 'PCE' / '_internal' / 'web' / relative).read_bytes(), f'Stale packaged UI asset: {relative}'
            report['checks'].append('packaged UI assets match the current extension build byte for byte')
            database = isolated / '검증 자료.sqlite3'
            executable = isolated / 'PCE.NativeHost' / 'PCE.NativeHost.exe'
            health = run_host(executable, database, [frame('gateway.health', {}, 'health')])[0]
            assert health['result']['protocolVersion'] == 1
            report['checks'].append('packaged Native Host health in Korean and space path')
            creation = frame('dataset.create', {'name': '패키지 검증', 'columns': [{'field': 'code', 'label': '코드', 'kind': 'text'}], 'rows': [{'code': '0001'}], 'duplicatePolicy': {'mode': 'allow', 'keys': []}}, 'create-once')
            replies = run_host(executable, database, [creation, creation])
            assert replies[0] == replies[1]
            source = replies[0]['result']['sourceId']
            stored = run_host(executable, database, [frame('table.read', {'sourceId': source}, 'read-after-restart')])[0]['result']
            assert len(stored['rows']) == 1 and stored['rows'][0]['code'] == '0001'
            report['checks'].append('packaged request replay and process restart preserve leading zero record')
            changes = {'columns': stored['columns'] + [{'field': 'amount', 'label': '단가', 'kind': 'decimal'}], 'added': [{'code': '0002', 'amount': '3.25'}], 'updated': [], 'deleted': []}
            run_host(executable, database, [frame('grid.commit', {'sourceId': source, 'tableVersion': stored['storeVersion'], 'changes': changes}, 'import-staged')])
            appended = run_host(executable, database, [frame('table.read', {'sourceId': source}, 'read-appended')])[0]['result']
            assert len(appended['rows']) == 2 and appended['rows'][1]['amount'] == '3.25' and len(appended['columns']) == 2
            report['checks'].append('packaged atomic import commits new column and exact decimal row')
            policy = run_host(executable, database, [frame('collector.policy', {}, 'collection-policy')])[0]['result']
            payload = {'pointInfo': {'depth1': '01001', 'depth2': '01114', 'ctrtDmndRcptNo': 'TEST-PACKAGE', 'ctrtDmndRcptOrd': '000'}, 'tables': {}}
            bundle = {'format': 'pce-transfer', 'version': 1, 'captures': [{'captureId': 'package-event', 'purpose': 'collection', 'origin': 'https://fixture.test', 'payload': payload}]}
            request = frame('capture.collect', {'bundle': bundle, 'policyVersion': policy['storeVersion']}, 'collect-once')
            collected = run_host(executable, database, [request, request])
            assert collected[0] == collected[1] and len(collected[0]['result']['captureIds']) == 1
            payload['pointInfo']['depth2'] = 'UNKNOWN'
            bundle['captures'][0]['captureId'] = 'blocked-event'
            blocked = run_host(executable, database, [frame('capture.collect', {'bundle': bundle, 'policyVersion': policy['storeVersion']}, 'blocked-collection')], allow_errors=True)[0]
            assert blocked['error']['code'] == 'COLLECTION_SCOPE'
            captures = run_host(executable, database, [frame('capture.list', {}, 'list-after-block')])[0]['result']
            assert len(captures) == 1
            report['checks'].append('packaged collection gate rejects unknown screen before raw storage and replays allowed event once')
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            desktop = subprocess.Popen([str(isolated / 'PCE' / 'PCE.exe'), '--no-browser', '--port', str(port), '--database', str(database)], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                for _ in range(60):
                    try:
                        with urllib.request.urlopen(f'http://127.0.0.1:{port}/workspace.html', timeout=.5) as response:
                            html = response.read().decode('utf-8')
                            assert response.status == 200 and '<div id="root">' in html
                            break
                    except OSError:
                        assert desktop.poll() is None, 'Packaged desktop exited before serving'
                        time.sleep(.1)
                else:
                    raise AssertionError('Packaged desktop server did not start')
                report['checks'].append('packaged desktop serves bundled workspace in headless mode')
            finally:
                desktop.terminate()
                desktop.wait(timeout=10)
        report['nativeWindow'] = 'UNVERIFIED: headless package check does not validate WebView2'
    except Exception as error:
        report['failure'] = str(error)
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))
    return int('failure' in report)


if __name__ == '__main__':
    raise SystemExit(main())

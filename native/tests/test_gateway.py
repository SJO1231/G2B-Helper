import importlib.util
import io
import json
import sqlite3
import struct
import sys
import tempfile
import threading
import unittest
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'native'))
from pce.gateway import Gateway
from pce.model import loads, dumps, matches, validate_filter, Fault
from host import native_loop, response_frames
from desktop import make_handler


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='PCE 한글 경로 ')
        self.gateway = Gateway(Path(self.directory.name) / '테스트 DB.sqlite3')

    def tearDown(self):
        self.gateway.store.db.close()
        self.directory.cleanup()

    def send(self, command, payload=None, request_id=None):
        return self.gateway.handle({'protocolVersion': 1, 'requestId': request_id or str(uuid.uuid4()), 'command': command, 'payload': payload or {}})

    def ok(self, command, payload=None, request_id=None):
        response = self.send(command, payload, request_id)
        self.assertNotIn('error', response, response)
        return response['result']

    def dataset(self, rows=None, policy=None):
        return self.ok('dataset.create', {'name': '검증', 'columns': [{'field': 'code', 'kind': 'text'}, {'field': 'name', 'kind': 'text'}, {'field': 'amount', 'kind': 'decimal'}, {'field': 'details', 'kind': 'json'}], 'rows': rows or [], **({'duplicatePolicy': policy} if policy else {})})['sourceId']

    def capture(self, name='원래 제목', event='event', stage='receipt', order='000'):
        fields = {'receipt': ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd'], 'contract': ['ctrtNo', 'ctrtChgOrd']}[stage]
        item = 'ctrtDmndRcptItemSqno' if stage == 'receipt' else 'ctrtItemSqno'
        identity = {fields[0]: 'R26TEST', fields[1]: order}
        payload = {'pointInfo': {**identity, 'depth2': '01114' if stage == 'receipt' else '01571', 'name': name, 'zero': 0, 'flag': False}, 'tables': {'normal': [{**identity, item: '01', 'price': '35608652.5'}], 'excel': [{**identity, item: '01', 'price': '35608652.5'}]}}
        bundle = {'format': 'pce-transfer', 'version': 1, 'captures': [{'captureId': event, 'origin': 'https://example.test', 'payload': payload}]}
        capture_id = self.ok('capture.import', {'bundle': bundle})['captureIds'][0]
        return capture_id, bundle

    def apply(self, capture_id, conflict_fields=()):
        preview = self.ok('collector.preview', {'captureId': capture_id})
        return self.ok('collector.apply', {'captureId': capture_id, 'previewToken': preview['previewToken'], 'decisions': [{'recordKey': r['recordKey'], 'storeVersion': r['storeVersion'], 'fields': [f for f in conflict_fields if any(c['field'] == f for c in r['changes'])]} for r in preview['records']]})

    def test_cross_runtime_filter_cases(self):
        cases = loads((ROOT / 'tests' / 'filter-cases.json').read_text(encoding='utf-8-sig'))
        for case in cases:
            with self.subTest(case['name']):
                validate_filter(case['filter'])
                columns = [{'field': k, 'values': v} for k, v in case.get('dictionaries', {}).items()]
                self.assertEqual(matches(case['row'], case['filter'], columns), case['expected'])
        for expression in ({'field': 'x', 'operator': 'garbage'}, {'field': 'x', 'operator': 'equals', 'values': []}, {'field': 'x', 'operator': 'equals', 'values': ['x'], 'path': ['__proto__']}):
            with self.assertRaises(Fault):
                validate_filter(expression)
        for value, needle, expected in [('1e2', '9', False), ('NaN', '9', True), ('-2.5', '-2.6', True)]:
            self.assertEqual(matches({'x': value}, {'field': 'x', 'operator': 'gt', 'values': [needle]}), expected)

    def test_atomic_grid_and_versions(self):
        source = self.dataset([{'code': '01', 'name': 'before', 'amount': '9007199254740993.5'}])
        row = self.ok('table.read', {'sourceId': source})['rows'][0]
        result = self.send('grid.commit', {'sourceId': source, 'changes': {'updated': [{'rowId': row['__rowId'], 'storeVersion': 1, 'values': {'name': 'after'}}], 'added': [{'code': '02', 'name': 42}]}})
        self.assertIn('error', result)
        persisted = self.ok('table.read', {'sourceId': source})['rows'][0]
        self.assertEqual(persisted['name'], 'before')
        self.ok('grid.commit', {'sourceId': source, 'changes': {'updated': [{'rowId': row['__rowId'], 'storeVersion': 1, 'values': {'name': 'after'}}]}})
        stale = self.send('grid.commit', {'sourceId': source, 'changes': {'updated': [{'rowId': row['__rowId'], 'storeVersion': 1, 'values': {'name': 'lost'}}]}})
        self.assertEqual(stale['error']['code'], 'STALE_VERSION')

    def test_grid_links_validate_final_graph_and_rollback(self):
        source = self.dataset([{'code': '01'}])
        target = self.ok('table.read', {'sourceId': source})['rows'][0]
        for linked in ({'sourceId': 'dataset.missing'}, {'sourceId': source, 'rowId': 'missing'}, {'rowId': target['__rowId']}, {'sourceId': 'contacts', 'rowId': target['__rowId']}):
            result = self.send('grid.commit', {'sourceId': 'memos', 'changes': {'added': [{'title': 'would be valid'}, {'title': 'bad', **linked}]}})
            self.assertEqual(result['error']['code'], 'REFERENCE_CONFLICT')
            self.assertEqual(self.ok('table.read', {'sourceId': 'memos'})['rowCount'], 0)
        linked_rows = self.ok('grid.commit', {'sourceId': 'memos', 'changes': {'added': [{'title': 'note', 'sourceId': source, 'rowId': target['__rowId']}]}})['rows']
        note = linked_rows[0]
        result = self.send('grid.commit', {'sourceId': source, 'changes': {'deleted': [{'rowId': target['__rowId'], 'storeVersion': target['__storeVersion']}], 'added': [{'code': '02'}]}})
        self.assertEqual(result['error']['code'], 'REFERENCE_CONFLICT')
        self.assertIn('Detach', result['error']['message'])
        self.assertEqual(self.ok('table.read', {'sourceId': source})['rows'], [target])
        self.assertEqual(self.ok('table.read', {'sourceId': 'memos'})['rows'], [note])
        self.ok('grid.commit', {'sourceId': 'memos', 'changes': {'updated': [{'rowId': note['__rowId'], 'storeVersion': note['__storeVersion'], 'values': {'sourceId': '', 'rowId': ''}}]}})
        self.ok('grid.commit', {'sourceId': source, 'changes': {'deleted': [{'rowId': target['__rowId'], 'storeVersion': target['__storeVersion']}]}})
        self.assertEqual(self.ok('table.read', {'sourceId': source})['rowCount'], 0)

    def test_grid_template_master_integrity_and_atomic_cycles(self):
        invalid = self.send('grid.commit', {'sourceId': 'templates', 'changes': {'added': [{'name': 'bad', 'masterId': 'missing'}]}})
        self.assertEqual(invalid['error']['code'], 'REFERENCE_CONFLICT')
        self.assertEqual(self.ok('table.read', {'sourceId': 'templates'})['rowCount'], 0)
        templates = self.ok('grid.commit', {'sourceId': 'templates', 'changes': {'added': [{'name': 'A'}, {'name': 'B'}]}})['rows']
        first, second = templates
        cycle = self.send('grid.commit', {'sourceId': 'templates', 'changes': {'updated': [{'rowId': first['__rowId'], 'storeVersion': 1, 'values': {'masterId': second['__rowId']}}, {'rowId': second['__rowId'], 'storeVersion': 1, 'values': {'masterId': first['__rowId']}}]}})
        self.assertEqual(cycle['error']['code'], 'REFERENCE_CONFLICT')
        self.assertEqual(self.ok('table.read', {'sourceId': 'templates'})['rows'], templates)
        self.ok('grid.commit', {'sourceId': 'templates', 'changes': {'updated': [{'rowId': second['__rowId'], 'storeVersion': 1, 'values': {'masterId': first['__rowId']}}]}})
        denied = self.send('grid.commit', {'sourceId': 'templates', 'changes': {'deleted': [{'rowId': first['__rowId'], 'storeVersion': 1}]}})
        self.assertEqual(denied['error']['code'], 'REFERENCE_CONFLICT')
        self.assertEqual(self.ok('table.read', {'sourceId': 'templates'})['rowCount'], 2)
        # Detaching the child and deleting the parent in one same-table batch is valid.
        self.ok('grid.commit', {'sourceId': 'templates', 'changes': {'updated': [{'rowId': second['__rowId'], 'storeVersion': 2, 'values': {'masterId': ''}}], 'deleted': [{'rowId': first['__rowId'], 'storeVersion': 1}]}})
        self.assertEqual(self.ok('table.read', {'sourceId': 'templates'})['rowCount'], 1)

    def test_import_columns_and_rows_are_one_atomic_commit(self):
        source = self.dataset([{'code': '01', 'name': 'keep'}])
        original = self.ok('table.read', {'sourceId': source})
        columns = original['columns'] + [{'field': 'quantity', 'kind': 'integer', 'label': '수량'}]
        changes = {'columns': columns, 'added': [{'code': '02', 'quantity': 'invalid'}], 'updated': [{'rowId': original['rows'][0]['__rowId'], 'storeVersion': 1, 'values': {'name': 'changed'}}]}
        result = self.send('grid.commit', {'sourceId': source, 'tableVersion': original['storeVersion'], 'changes': changes})
        self.assertEqual(result['error']['code'], 'VALIDATION')
        after_failure = self.ok('table.read', {'sourceId': source})
        self.assertEqual(after_failure['columns'], original['columns'])
        self.assertEqual(after_failure['storeVersion'], original['storeVersion'])
        self.assertEqual(after_failure['rows'], original['rows'])
        changes['added'][0]['quantity'] = 7
        saved = self.ok('grid.commit', {'sourceId': source, 'tableVersion': original['storeVersion'], 'changes': changes})
        persisted = self.ok('table.read', {'sourceId': source})
        self.assertEqual(saved['storeVersion'], original['storeVersion'] + 1)
        self.assertEqual(persisted['columns'], columns)
        self.assertEqual(persisted['rowCount'], 2)
        self.assertEqual(persisted['rows'][0]['name'], 'changed')
        self.assertEqual(persisted['rows'][1]['quantity'], 7)

    def test_import_columns_require_version_preserve_metadata_and_reject_edits(self):
        source = self.dataset([{'code': '01'}])
        original = self.ok('table.read', {'sourceId': source})
        self.ok('settings.save', {'key': 'dictionary.keys', 'storeVersion': self.gateway.store.configuration('dictionary.keys')['storeVersion'], 'value': {'code': '코드'}})
        displayed = self.ok('table.read', {'sourceId': source})
        columns = displayed['columns'] + [{'field': 'extra', 'kind': 'text'}]
        missing = self.send('grid.commit', {'sourceId': source, 'changes': {'columns': columns}})
        self.assertEqual(missing['error']['code'], 'STALE_VERSION')
        edited = loads(dumps(columns))
        edited[0]['kind'] = 'integer'
        rejected = self.send('grid.commit', {'sourceId': source, 'tableVersion': original['storeVersion'], 'changes': {'columns': edited}})
        self.assertEqual(rejected['error']['code'], 'VALIDATION')
        self.ok('grid.commit', {'sourceId': source, 'tableVersion': original['storeVersion'], 'changes': {'columns': columns, 'added': [{'code': '02', 'extra': 'imported'}]}})
        self.assertEqual(self.gateway.store.definition(source)['columns'][:-1], original['columns'])
        stale = self.send('grid.commit', {'sourceId': source, 'tableVersion': original['storeVersion'], 'changes': {'columns': columns}})
        self.assertEqual(stale['error']['code'], 'STALE_VERSION')

    def test_durable_idempotency_and_reused_id(self):
        payload = {'name': 'one', 'columns': []}
        first = self.ok('dataset.create', payload, 'same-request')
        self.gateway.store.db.close()
        self.gateway = Gateway(Path(self.directory.name) / '테스트 DB.sqlite3')
        self.assertEqual(first, self.ok('dataset.create', payload, 'same-request'))
        self.assertEqual(self.send('dataset.create', {**payload, 'name': 'two'}, 'same-request')['error']['code'], 'REQUEST_REUSED')

    def test_full_filter_before_paging(self):
        source = self.dataset([{'code': str(i), 'name': 'selected' if i >= 210 else 'other'} for i in range(220)])
        result = self.ok('table.read', {'sourceId': source, 'limit': 3, 'filter': {'field': 'name', 'operator': 'equals', 'values': ['selected']}})
        self.assertEqual(result['rowCount'], 10)
        self.assertEqual(result['rows'][0]['code'], '210')

    def test_relation_single_shared_definition_and_ambiguity(self):
        left = self.dataset([{'code': '01'}])
        right = self.dataset([{'code': '01'}, {'code': '01'}])
        relation = {'name': 'join', 'leftSourceId': left, 'rightSourceId': right, 'fieldPairs': [{'left': 'code', 'right': 'code'}], 'cardinality': 'one'}
        preview = self.ok('relation.preview', {'definition': relation})
        self.assertEqual(preview['ambiguous'], 1)
        saved = self.ok('relation.save', {'definition': relation})
        saved['cardinality'] = 'many'
        updated = self.ok('relation.save', {'definition': saved})
        self.assertEqual(self.ok('relation.list')[0], updated)
        self.assertEqual(self.ok('relation.query', {'id': saved['id']})['matched'], 1)
        self.assertEqual(len(self.ok('table.read', {'sourceId': right})['rows']), 2)

    def test_capture_dedup_conflict_partial_and_order(self):
        capture_id, bundle = self.capture()
        self.assertEqual(self.ok('capture.import', {'bundle': bundle})['captureIds'], [capture_id])
        self.apply(capture_id)
        self.assertEqual(self.ok('table.read', {'sourceId': 'procurement.receipt_item'})['rowCount'], 1)
        changed, _ = self.capture('changed')
        self.assertNotEqual(changed, capture_id)
        self.apply(changed)  # no approval: old conflict retained
        self.assertEqual(self.ok('table.read', {'sourceId': 'procurement.receipt'})['rows'][0]['name'], '원래 제목')
        self.apply(changed, ['name'])
        rows = self.ok('table.read', {'sourceId': 'procurement.receipt'})['rows']
        self.assertEqual(rows[0]['name'], 'changed')
        self.assertEqual(rows[0]['zero'], 0)
        self.assertIs(rows[0]['flag'], False)
        partial = {'pointInfo': {'ctrtDmndRcptNo': 'R26TEST', 'ctrtDmndRcptOrd': '000', 'name': ''}, 'tables': {}}
        pid = self.ok('capture.import', {'bundle': partial})['captureIds'][0]
        self.apply(pid)
        self.assertEqual(self.ok('table.read', {'sourceId': 'procurement.receipt'})['rows'][0]['name'], 'changed')
        other, _ = self.capture(order='001', event='other')
        self.apply(other)
        self.assertEqual(self.ok('table.read', {'sourceId': 'procurement.receipt'})['rowCount'], 2)

    def test_stale_rule_change_and_rule_exclusion(self):
        capture_id, _ = self.capture()
        proposal = self.ok('collector.preview', {'captureId': capture_id})
        self.ok('settings.save', {'key': 'collector.rules', 'value': []})
        response = self.send('collector.apply', {'captureId': capture_id, 'previewToken': proposal['previewToken'], 'decisions': []})
        self.assertEqual(response['error']['code'], 'STALE_VERSION')
        self.assertEqual(self.ok('collector.preview', {'captureId': capture_id})['status'], 'raw_only')

    def test_malformed_bundle_all_or_nothing(self):
        _, bundle = self.capture()
        before = len(self.ok('capture.list'))
        bundle['captures'][0]['captureId'] = 'new'
        bundle['captures'].append({'captureId': 'broken', 'payload': {'tables': []}})
        self.assertIn('error', self.send('capture.import', {'bundle': bundle}))
        self.assertEqual(len(self.ok('capture.list')), before)

    def test_backup_restore_and_atomic_validation(self):
        source = self.dataset([{'code': '01', 'details': {'codes': ['01', None], 'flag': False}}])
        self.ok('settings.save', {'key': 'json.display', 'value': {'code': 'tree'}})
        backup = self.ok('backup.export')
        with tempfile.TemporaryDirectory() as target:
            other = Gateway(Path(target) / 'fresh.sqlite3')
            try:
                restored = other.handle({'protocolVersion': 1, 'requestId': 'restore', 'command': 'backup.restore', 'payload': {'bundle': backup}})
                self.assertNotIn('error', restored, restored)
                self.assertEqual(other.store.rows(source), self.gateway.store.rows(source))
                self.assertEqual(other.store.configuration('json.display')['value'], {'code': 'tree'})
            finally:
                other.store.db.close()
        broken = loads(dumps(backup))
        next(t for t in broken['tables'] if t['definition']['sourceId'] == source)['rows'][0]['code'] = 5
        self.assertIn('error', self.send('backup.restore', {'bundle': broken}))
        self.assertEqual(self.gateway.store.rows(source)[0]['code'], '01')

    def test_sql_authorizer_cte_timeout_limits(self):
        self.dataset([{'code': '01'}])
        self.assertEqual(self.ok('query.execute', {'sql': 'WITH r AS (SELECT * FROM pce_records) SELECT count(*) AS n FROM r'})['rows'][0]['n'], 1)
        for sql in ('DELETE FROM records', 'ATTACH DATABASE ":memory:" AS extra', 'SELECT * FROM configurations', 'SELECT load_extension("x")', 'SELECT 1; SELECT 2', 'CREATE TABLE x(n)', 'PRAGMA journal_mode'):
            with self.subTest(sql):
                self.assertIn('error', self.send('query.execute', {'sql': sql}))
        result = self.ok('query.execute', {'sql': 'WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c WHERE n<1500) SELECT n FROM c'})
        self.assertEqual(len(result['rows']), 1000)
        self.assertTrue(result['metadata']['truncated'])
        self.assertIn('error', self.send('query.execute', {'sql': 'WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c) SELECT sum(n) FROM c'}))

    def test_native_framing_and_large_chunk_unicode(self):
        request = dumps({'protocolVersion': 1, 'requestId': 'native', 'command': 'gateway.health', 'payload': {}}).encode('utf-8')
        stream = io.BytesIO()
        native_loop(self.gateway, io.BytesIO(struct.pack('<I', len(request)) + request), stream)
        value = stream.getvalue()
        size = struct.unpack('<I', value[:4])[0]
        self.assertEqual(loads(value[4:4 + size])['requestId'], 'native')
        response = {'requestId': 'big', 'result': '한글' * 500000}
        chunks = response_frames(response)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(dumps(c).encode('utf-8')) < 1024 * 1024 for c in chunks))
        self.assertEqual(loads(''.join(c['chunk']['text'] for c in chunks)), response)

    def test_loopback_auth_and_origin(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.gateway, 'test-token', Path(self.directory.name)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:' + str(server.server_port) + '/api'
        request_body = dumps({'protocolVersion': 1, 'requestId': 'http', 'command': 'gateway.health', 'payload': {}}).encode()
        try:
            with self.assertRaises(HTTPError) as failure:
                urlopen(Request(url, data=request_body))
            self.assertEqual(failure.exception.code, 401)
            with self.assertRaises(HTTPError) as failure:
                urlopen(Request(url, data=request_body, headers={'Authorization': 'Bearer test-token', 'Origin': 'https://untrusted.example'}))
            self.assertEqual(failure.exception.code, 403)
            with urlopen(Request(url, data=request_body, headers={'Authorization': 'Bearer test-token'})) as response:
                self.assertEqual(loads(response.read())['result']['status'], 'ready')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_all_source_json_and_markdown(self):
        files = list((ROOT / '참고자료').glob('data_map*.txt'))
        if not files:
            self.skipTest('Local source evidence unavailable')
        self.assertGreaterEqual(len(files), 21)
        for file in files:
            with self.subTest(file.name):
                payload = loads(file.read_text(encoding='utf-8-sig'))
                capture_id = self.ok('capture.import', {'bundle': payload})['captureIds'][0]
                proposal = self.ok('collector.preview', {'captureId': capture_id})
                depth = payload['pointInfo'].get('depth2')
                expected = {'01114': 'receipt', '01117': 'receipt', '01174': 'bid', '01571': 'contract'}.get(depth)
                if expected:
                    if file.name.startswith('data_map_179006'):
                        self.assertEqual(proposal['status'], 'ready', proposal)
                    if proposal['status'] == 'ready':
                        self.assertTrue(any(r['sourceId'] == 'procurement.' + expected for r in proposal['records']))
                        self.apply(capture_id)
                    else:
                        self.assertEqual(proposal['status'], 'ambiguous')
                else:
                    self.assertEqual(proposal['status'], 'raw_only')
        script = ROOT / 'scripts' / 'audit_samples.py'
        if script.exists():
            spec = importlib.util.spec_from_file_location('audit_samples', script)
            audit = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(audit)
            for name, count in [('계약3.md', 3), ('국방3.md', 24)]:
                payload = audit.read_markdown(ROOT / '참고자료' / name)
                capture_id = self.ok('capture.import', {'bundle': payload})['captureIds'][0]
                proposal = self.ok('collector.preview', {'captureId': capture_id})
                self.assertEqual(proposal['status'], 'ready', proposal)
                self.assertEqual(len([r for r in proposal['records'] if r['sourceId'].endswith('_item')]), count)
                self.apply(capture_id)
                if name == '계약3.md':
                    self.assertTrue(any(r['identity'].get('ctrtChgOrd') == '01' for r in proposal['records']))
                    self.assertIn('35608652.5', dumps(payload))

    def test_schema_staleness_dictionary_and_dataset_group(self):
        source = self.dataset([{'code': '01'}])
        definition = self.ok('table.read', {'sourceId': source})
        self.assertEqual(definition['group'], 'dataset')
        self.ok('settings.save', {'key': 'dictionary.codes', 'storeVersion': self.gateway.store.configuration('dictionary.codes')['storeVersion'], 'value': {'code': {'01': '선택'}}})
        filtered = self.ok('table.read', {'sourceId': source, 'filter': {'field': 'code', 'operator': 'equals', 'values': ['선택'], 'compareAs': 'label'}})
        self.assertEqual(filtered['rowCount'], 1)
        self.ok('table.configure', {'sourceId': source, 'storeVersion': definition['storeVersion'], 'columns': definition['columns']})
        result = self.send('grid.commit', {'sourceId': source, 'tableVersion': definition['storeVersion'], 'changes': {'added': [{'code': '02'}]}})
        self.assertEqual(result['error']['code'], 'STALE_VERSION')
        self.assertEqual(self.ok('table.read', {'sourceId': source})['rowCount'], 1)

    def test_frame_validation_and_conflicting_identity(self):
        _, bundle = self.capture()
        bundle['captures'][0]['captureId'] = 'frame-bad'
        bundle['captures'][0]['payload']['frames'] = [{'tables': {'x': [42]}}]
        before = len(self.ok('capture.list'))
        self.assertIn('error', self.send('capture.import', {'bundle': bundle}))
        self.assertEqual(len(self.ok('capture.list')), before)
        bundle['captures'][0]['payload']['frames'] = [{'frameId': 'child', 'pointInfo': {'ctrtDmndRcptNo': 'other', 'ctrtDmndRcptOrd': '000'}, 'tables': {}}]
        capture = self.ok('capture.import', {'bundle': bundle})['captureIds'][0]
        self.assertEqual(self.ok('collector.preview', {'captureId': capture})['status'], 'ambiguous')
        self.assertEqual(self.ok('capture.read', {'captureId': capture})['payload']['frames'][0]['frameId'], 'child')
        shell = {'pointInfo': {'pageTitle': 'workspace'}, 'tables': {}, 'frames': [{'frameId': 'loaded', 'pointInfo': {'ctrtNo': 'C01', 'ctrtChgOrd': '01', 'areaCd': '14', 'depth1': '01570', 'depth2': '01571', 'depth3': '01579'}, 'tables': {}}]}
        capture = self.ok('capture.import', {'bundle': shell})['captureIds'][0]
        self.assertEqual(self.ok('collector.preview', {'captureId': capture})['status'], 'ready')
        shell['pointInfo'].update({'ctrtDmndRcptNo': 'R01', 'ctrtDmndRcptOrd': '00'})
        capture = self.ok('capture.import', {'bundle': shell})['captureIds'][0]
        self.assertEqual(self.ok('collector.preview', {'captureId': capture})['status'], 'ambiguous')

    def test_partial_backup_dependency_and_metadata(self):
        source = self.dataset([{'code': '01'}])
        backup = self.ok('backup.export', {'sourceIds': [source]})
        backup['settings'].append({'key': 'relation.invalid', 'storeVersion': 1, 'value': {'name': 'missing', 'leftSourceId': source, 'rightSourceId': 'dataset.absent', 'cardinality': 'one', 'fieldPairs': [{'left': 'code', 'right': 'code'}]}})
        self.assertIn('error', self.send('backup.preview', {'bundle': backup}))
        self.assertIn('error', self.send('backup.restore', {'bundle': backup}))
        self.assertEqual(self.ok('table.read', {'sourceId': source})['rowCount'], 1)
        capture_id, _ = self.capture()
        full = self.ok('backup.export')
        full['captures'][0]['templateId'] = 'source-template'
        full['captures'][0]['settingsReferences'] = ['dictionary.keys@1']
        self.ok('backup.restore', {'bundle': full})
        self.assertEqual(self.ok('capture.read', {'captureId': capture_id})['payload'], full['captures'][0]['payload'])

    def test_viewer_uses_injected_desktop_window(self):
        opened = []
        self.gateway.set_viewer_opener(lambda title, path: opened.append((title, path)))
        result = self.ok('viewer.open', {'title': '검토', 'text': '<script>unsafe</script>'})
        self.assertEqual(len(opened), 1)
        self.assertTrue(result['opened'])
        self.assertIn('&lt;script&gt;', Path(result['path']).read_text(encoding='utf-8'))

    def test_backup_capture_exact_identity_metadata_and_validation(self):
        capture_id, _ = self.capture()
        backup = self.ok('backup.export')
        backup['captures'][0].update({'templateId': 'original-template', 'settingsReferences': ['rules@7'], 'extraMetadata': {'frame': 2}})
        with tempfile.TemporaryDirectory() as target:
            other = Gateway(Path(target) / 'copy.sqlite3')
            try:
                result = other.handle({'protocolVersion': 1, 'requestId': 'restore', 'command': 'backup.restore', 'payload': {'bundle': backup}})
                self.assertNotIn('error', result, result)
                self.assertEqual(other.collector.read(capture_id), backup['captures'][0])
            finally:
                other.store.db.close()
        broken = loads(dumps(backup))
        broken['captures'][0]['payload']['frames'] = [{'tables': {'bad': [1]}}]
        self.assertIn('error', self.send('backup.preview', {'bundle': broken}))
        before = self.gateway.store.state_token()
        self.assertIn('error', self.send('backup.restore', {'bundle': broken}))
        self.assertEqual(before, self.gateway.store.state_token())

    def test_review_tokens_reject_changed_relations_and_restore_target(self):
        source = self.dataset([{'code': '01'}])
        relation = {'name': 'self', 'leftSourceId': source, 'rightSourceId': source, 'fieldPairs': [{'left': 'code', 'right': 'code'}], 'cardinality': 'one'}
        preview = self.ok('relation.preview', {'definition': relation})
        backup = self.ok('backup.export')
        restoration = self.ok('backup.preview', {'bundle': backup})
        self.ok('grid.commit', {'sourceId': source, 'changes': {'added': [{'code': '02'}]}})
        self.assertEqual(self.send('relation.save', {'definition': relation, 'previewToken': preview['previewToken']})['error']['code'], 'STALE_VERSION')
        self.assertEqual(self.send('backup.restore', {'bundle': backup, 'previewToken': restoration['previewToken']})['error']['code'], 'STALE_VERSION')
        self.assertEqual(self.ok('table.read', {'sourceId': source})['rowCount'], 2)

    def test_rule_identity_separate_from_storage_duplicates_and_reset(self):
        source = self.dataset([{'code': 'old', 'name': 'shared'}])
        definition = self.ok('table.read', {'sourceId': source})
        self.ok('table.configure', {'sourceId': source, 'storeVersion': definition['storeVersion'], 'duplicatePolicy': {'mode': 'compare', 'keys': ['name']}})
        rule = {'sourceId': source, 'dataset': 'values', 'identityFields': ['code']}
        saved = self.ok('settings.save', {'key': 'collector.rules', 'value': [rule]})
        payload = {'pointInfo': {}, 'tables': {'values': [{'code': 'new', 'name': 'shared'}]}}
        capture_id = self.ok('capture.import', {'bundle': payload})['captureIds'][0]
        self.assertEqual(self.ok('collector.preview', {'captureId': capture_id})['status'], 'ambiguous')
        self.assertEqual(self.ok('table.read', {'sourceId': source})['rows'][0]['code'], 'old')
        self.ok('settings.save', {'key': 'collector.rules', 'storeVersion': saved['storeVersion'], 'value': None})
        built_in, _ = self.capture()
        self.assertEqual(self.ok('collector.preview', {'captureId': built_in})['status'], 'ready')

    def test_backup_existing_dependency_and_template_cycle_preview(self):
        source = self.dataset([{'code': '01'}])
        definition = self.ok('table.read', {'sourceId': source})
        self.ok('grid.commit', {'sourceId': 'memos', 'changes': {'added': [{'title': 'linked', 'sourceId': source, 'rowId': definition['rows'][0]['__rowId']}]}})
        archive = self.ok('backup.export', {'sourceIds': [source]})
        archive['tables'][0]['rows'] = []
        self.assertIn('error', self.send('backup.preview', {'bundle': archive}))
        templates = self.ok('table.read', {'sourceId': 'templates'})
        archive = {'format': 'pce-backup', 'version': 1, 'tables': [{'definition': {k: v for k, v in templates.items() if k not in ('rows', 'rowCount', 'offset', 'hasMore')}, 'rows': [{'__rowId': 't1', '__storeVersion': 1, 'name': 'one', 'masterId': 't2'}, {'__rowId': 't2', '__storeVersion': 1, 'name': 'two', 'masterId': 't1'}]}], 'settings': []}
        self.assertIn('error', self.send('backup.preview', {'bundle': archive}))


if __name__ == '__main__':
    unittest.main()

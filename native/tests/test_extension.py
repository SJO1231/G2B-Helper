import copy
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'native'))
from pce.gateway import Gateway
from pce.model import Fault


class ExtensionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='pce-extension-')
        self.gateway = Gateway(Path(self.directory.name) / 'extension.sqlite3')

    def tearDown(self):
        self.gateway.store.db.close()
        self.directory.cleanup()

    def send(self, command, payload=None, request_id=None):
        return self.gateway.handle({'protocolVersion': 1, 'requestId': request_id or str(uuid.uuid4()), 'command': command, 'payload': payload or {}})

    def ok(self, command, payload=None, request_id=None):
        response = self.send(command, payload, request_id)
        self.assertNotIn('error', response, response)
        return response['result']

    def put(self, document_id, value, namespace='hwpx-templates', version=None, **extra):
        return self.ok('extension.document.put', {'namespace': namespace, 'documentId': document_id, 'storeVersion': version, 'value': value, **extra})

    def test_document_cas_tombstone_retry_and_backup(self):
        payload = {'namespace': 'templates', 'documentId': 'first', 'value': {'name': '이름', 'body': '0001 {{금액}}'}}
        created = self.ok('extension.document.put', payload, 'create-once')
        self.assertEqual(self.ok('extension.document.put', payload, 'create-once'), created)
        updated = self.put('first', {'name': 'changed', 'body': '0 false'}, 'templates', created['storeVersion'])
        self.assertEqual(self.send('extension.document.put', {**payload, 'storeVersion': created['storeVersion']})['error']['code'], 'STALE_VERSION')
        self.ok('extension.document.remove', {'namespace': 'templates', 'documentId': 'first', 'storeVersion': updated['storeVersion']})
        recreated = self.put('first', {'name': 'again'}, 'templates')
        self.assertGreater(recreated['storeVersion'], updated['storeVersion'])
        self.assertEqual(self.ok('extension.document.list', {'namespace': 'templates'}), [recreated])
        snapshot = self.ok('backup.export')
        self.assertIn('extension.document.templates.first', str(snapshot))
        self.assertIn('error', self.send('extension.document.put', {**payload, 'namespace': 'not-a-namespace'}))

    def test_hwpx_reference_cas_cycle_and_master_delete_are_atomic(self):
        master = self.put('master', {'name': 'master', 'masterZip': 'UEs='})
        child = self.put('child', {'name': 'child', 'baseTemplateId': 'master'}, expectedReferences=[{'documentId': 'master', 'storeVersion': master['storeVersion']}])
        self.put('grandchild', {'name': 'grandchild', 'baseTemplateId': 'child'})
        error = self.send('extension.document.remove', {'namespace': 'hwpx-templates', 'documentId': 'master', 'storeVersion': master['storeVersion']})
        self.assertEqual(error['error']['code'], 'REFERENCE_CONFLICT')
        cyclic = self.send('extension.document.put', {'namespace': 'hwpx-templates', 'documentId': 'master', 'storeVersion': master['storeVersion'], 'value': {'baseTemplateId': 'grandchild'}})
        self.assertEqual(cyclic['error']['code'], 'REFERENCE_CONFLICT')
        self.assertEqual(self.ok('extension.document.list', {'namespace': 'hwpx-templates'})[0], master)
        self.put('master', {'name': 'new', 'masterZip': 'UEs='}, version=master['storeVersion'])
        stale = self.send('extension.document.put', {'namespace': 'hwpx-templates', 'documentId': 'child', 'storeVersion': child['storeVersion'], 'value': child['value'], 'expectedReferences': [{'documentId': 'master', 'storeVersion': master['storeVersion']}]})
        self.assertEqual(stale['error']['code'], 'STALE_VERSION')
        phantom = self.send('extension.document.put', {'namespace': 'hwpx-templates', 'documentId': 'child', 'storeVersion': child['storeVersion'], 'value': child['value'], 'expectedDocumentIds': ['master', 'child']})
        self.assertEqual(phantom['error']['code'], 'STALE_VERSION')

    def registration(self):
        frame = {'framePath': 'top/detail', 'url': 'https://example.test/detail', 'pointInfo': {'screen': 'custom'}, 'tables': {'lines': [{'code': '0001', 'amount': '35608652.5', 'zero': 0, 'enabled': False}]}}
        capture = {'pointInfo': {}, 'tables': {}, 'frames': [frame], 'warnings': []}
        return {'payload': capture, 'dataset': 'lines', 'label': '수집 업무', 'identityFields': ['code'], 'policyVersion': 0,
                'framePath': 'top/detail', 'screenFilter': {'field': 'screen', 'operator': 'equals', 'values': ['custom']},
                'urlFilter': {'join': 'and', 'conditions': [{'field': 'url', 'operator': 'equals', 'values': [frame['url']]}]}}

    def bundle(self, payload):
        return {'format': 'pce-transfer', 'version': 1, 'captures': [{'captureId': str(uuid.uuid4()), 'payload': payload}]}

    def test_register_policy_atomicity_defaults_and_conditional_capture(self):
        registration = self.registration()
        registered = self.ok('collector.register', registration, 'register-once')
        self.assertTrue(registered['policy']['includeDefaults'])
        self.assertEqual(self.ok('collector.register', registration, 'register-once'), registered)
        source = registered['source']['sourceId']
        self.assertEqual(registered['source']['group'], 'collection')
        self.assertEqual(self.ok('table.read', {'sourceId': source})['rowCount'], 0)
        captured = self.ok('capture.collect', {'bundle': self.bundle(registration['payload']), 'policyVersion': registered['policy']['storeVersion']})['captureIds'][0]
        preview = self.ok('collector.preview', {'captureId': captured})
        self.assertEqual(preview['status'], 'ready')
        self.ok('collector.apply', {'captureId': captured, 'previewToken': preview['previewToken'], 'decisions': []})
        rows = self.ok('table.read', {'sourceId': source})['rows']
        self.assertEqual([(r['code'], r['amount'], r['zero'], r['enabled']) for r in rows], [('0001', '35608652.5', 0, False)])
        # Existing built-in receipt profile remains active after explicit registration.
        receipt = {'pointInfo': {'areaCd': '14', 'depth1': '01001', 'depth2': '01114', 'ctrtDmndRcptNo': 'R01', 'ctrtDmndRcptOrd': '000'}, 'tables': {}}
        capture_id = self.ok('capture.collect', {'bundle': self.bundle(receipt), 'policyVersion': registered['policy']['storeVersion']})['captureIds'][0]
        self.assertEqual(self.ok('collector.preview', {'captureId': capture_id})['status'], 'ready')
        before = len(self.ok('table.list'))
        self.assertEqual(self.send('collector.register', registration)['error']['code'], 'STALE_VERSION')
        bad = {**registration, 'policyVersion': registered['policy']['storeVersion'], 'duplicatePolicy': {'mode': 'compare', 'keys': ['missing']}}
        self.assertIn('error', self.send('collector.register', bad))
        self.assertEqual(len(self.ok('table.list')), before)
        self.assertEqual(self.ok('collector.policy'), registered['policy'])
        backup = self.ok('backup.export')
        preview = self.ok('backup.preview', {'bundle': backup})
        self.ok('backup.restore', {'bundle': backup, 'previewToken': preview['previewToken']})
        self.assertEqual(self.ok('collector.policy'), registered['policy'])

    def test_document_backup_references_and_restore_invalidate_stale_editor(self):
        master = self.put('master', {'masterZip': 'UEs='})
        child = self.put('child', {'baseTemplateId': 'master'})
        backup = self.ok('backup.export')
        corrupted = copy.deepcopy(backup)
        for setting in corrupted['settings']:
            if setting['key'] == 'extension.document.hwpx-templates.master':
                setting['value'] = None
        self.assertEqual(self.send('backup.preview', {'bundle': corrupted})['error']['code'], 'REFERENCE_CONFLICT')
        preview = self.ok('backup.preview', {'bundle': backup})
        self.ok('backup.restore', {'bundle': backup, 'previewToken': preview['previewToken']})
        documents = self.ok('extension.document.list', {'namespace': 'hwpx-templates'})
        self.assertTrue(all(document['storeVersion'] > 1 for document in documents))
        stale = self.send('extension.document.put', {'namespace': 'hwpx-templates', 'documentId': 'child', 'value': child['value'], 'storeVersion': child['storeVersion']})
        self.assertEqual(stale['error']['code'], 'STALE_VERSION')

    def test_url_and_screen_must_match_same_frame_before_raw_and_preview(self):
        registration = self.registration()
        registered = self.ok('collector.register', registration)
        wrong = copy.deepcopy(registration['payload'])
        wrong['frames'][0]['url'] = 'https://other.test/detail'
        second = copy.deepcopy(wrong['frames'][0])
        second['url'] = 'https://example.test/detail'
        second['pointInfo']['screen'] = 'other'
        wrong['frames'].append(second)
        denied = self.send('capture.collect', {'bundle': self.bundle(wrong), 'policyVersion': registered['policy']['storeVersion']})
        self.assertEqual(denied['error']['code'], 'COLLECTION_SCOPE')
        self.assertEqual(self.ok('capture.list'), [])
        capture_id = self.ok('capture.import', {'bundle': self.bundle(wrong)})['captureIds'][0]
        self.assertEqual(self.ok('collector.preview', {'captureId': capture_id})['records'], [])

    def test_default_and_custom_same_frame_preserve_all_raw_rows(self):
        point = {'areaCd': '14', 'depth1': '01001', 'depth2': '01114', 'ctrtDmndRcptNo': 'R01', 'ctrtDmndRcptOrd': '000'}
        rows = [{'code': '0001', 'enabled': False, 'zero': 0}, {'code': '0001', 'enabled': False, 'zero': 0}, {'description': 'no custom identity'}]
        payload = {'pointInfo': {}, 'tables': {}, 'frames': [{'framePath': 'top/detail', 'url': 'https://fixture.g2b.go.kr/detail', 'pointInfo': point, 'tables': {'lines': rows}}]}
        original = copy.deepcopy(payload)
        rules = [{'sourceId': 'dataset.custom', 'dataset': 'lines', 'identityFields': ['code']}]
        scoped = self.gateway.collector.scope_payload(payload, rules, True)
        self.assertEqual(len(scoped['frames']), 1)
        self.assertEqual(scoped['frames'][0]['tables']['lines'], rows)
        self.assertEqual(payload, original)

    def test_default_custom_cross_branch_parent_conflict_never_stores_raw(self):
        point = {'areaCd': '14', 'depth1': '01001', 'depth2': '01114', 'ctrtDmndRcptNo': '0001', 'ctrtDmndRcptOrd': '000'}
        other = {'screen': 'custom', 'ctrtDmndRcptNo': '0002', 'ctrtDmndRcptOrd': '000'}
        payload = {'pointInfo': {}, 'tables': {}, 'frames': [
            {'framePath': 'top/default', 'url': 'https://www.g2b.go.kr/default', 'pointInfo': point, 'tables': {}},
            {'framePath': 'top/custom', 'url': 'https://custom.test/detail', 'pointInfo': other, 'tables': {}}]}
        rules = [{'sourceId': 'procurement.receipt', 'dataset': '$pointInfo', 'identityFields': ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd'], 'screenFilter': {'field': 'screen', 'operator': 'equals', 'values': ['custom']}}]
        saved = self.ok('settings.save', {'key': 'collector.rules', 'value': {'rules': rules, 'includeDefaults': True}})
        result = self.send('capture.collect', {'policyVersion': saved['storeVersion'], 'bundle': self.bundle(payload)})
        self.assertEqual(result['error']['code'], 'AMBIGUOUS')
        self.assertEqual(self.ok('capture.list'), [])
        # A generic custom dataset is independent of procurement parent identity.
        scoped = self.gateway.collector.scope_payload(payload, [{**rules[0], 'sourceId': 'dataset.generic'}], True)
        self.assertEqual(len(scoped['frames']), 2)

    def test_multiple_custom_rules_preserve_original_order_and_multiplicity(self):
        rows = [{'a': '01'}, {'b': '02'}, {'a': '01'}, {'blank': ''}]
        payload = {'pointInfo': {}, 'tables': {'rows': rows}}
        rules = [{'sourceId': 'dataset.a', 'dataset': 'rows', 'identityFields': ['a']},
                 {'sourceId': 'dataset.b', 'dataset': 'rows', 'identityFields': ['b']},
                 {'sourceId': 'dataset.a', 'dataset': 'rows', 'identityFields': ['a']}]
        result = self.gateway.collector.scope_payload(payload, rules)
        self.assertEqual(result['tables']['rows'], rows[:3])
        self.assertEqual(payload['tables']['rows'], rows)

    def test_default_g2b_url_restriction_and_explicit_custom_external_url(self):
        point = {'areaCd': '14', 'depth1': '01001', 'depth2': '01114', 'ctrtDmndRcptNo': '0001', 'ctrtDmndRcptOrd': '000'}
        def payload(url):
            return {'pointInfo': {}, 'tables': {}, 'frames': [{'framePath': 'top', 'url': url, 'pointInfo': point, 'tables': {}}]}
        for url in ('https://g2b.go.kr/path', 'http://www.g2b.go.kr/path', 'https://sub.www.g2b.go.kr:443/path', ''):
            with self.subTest(allowed=url):
                self.assertTrue(self.gateway.collector.scope_payload(payload(url))['frames'])
        for url in ('https://other.test', 'https://g2b.go.kr.evil.test', 'https://evilg2b.go.kr', 'file://g2b.go.kr/path', 'javascript:alert(1)', 'not-a-url'):
            with self.subTest(blocked=url):
                with self.assertRaises(Fault) as error:
                    self.gateway.collector.scope_payload(payload(url))
                self.assertEqual(error.exception.code, 'COLLECTION_SCOPE')
        rules = [{'sourceId': 'dataset.custom', 'dataset': '$pointInfo', 'identityFields': ['ctrtDmndRcptNo'], 'urlFilter': {'field': 'url', 'operator': 'equals', 'values': ['https://other.test']}}]
        self.assertTrue(self.gateway.collector.scope_payload(payload('https://other.test'), rules)['frames'])

    def test_explorer_requires_root_preserves_record_context_and_no_traversal(self):
        source = self.ok('dataset.create', {'name': '../한글 : 업무', 'columns': [{'field': 'name', 'kind': 'text', 'label': '이름'}], 'rows': [{'name': 'first'}, {'name': 'second'}]})['sourceId']
        rows = self.ok('table.read', {'sourceId': source})['rows']
        context = {'sourceId': source, 'rowId': rows[0]['__rowId']}
        from unittest.mock import patch
        with patch('pce.extension.downloads_folder', return_value=Path(self.directory.name)):
            fallback = self.ok('explorer.context', {})
            self.assertEqual(Path(fallback['path']), Path(self.directory.name))
            self.assertTrue(fallback['exists'])
        base = Path(self.directory.name) / '업무 폴더'
        base.mkdir()
        self.ok('settings.save', {'key': 'explorer.root', 'value': {'basePath': str(base)}})
        listed = self.ok('explorer.context', context)
        self.assertFalse(listed['exists'])
        created = self.ok('explorer.context', {**context, 'action': 'ensure'})
        self.assertEqual(Path(created['path']).parent, base)
        (Path(created['path']) / '문서.txt').write_text('kept', encoding='utf-8')
        listed = self.ok('explorer.context', context)
        self.assertEqual(listed['entries'][0]['name'], '문서.txt')
        other = self.ok('explorer.context', {**context, 'rowId': rows[1]['__rowId'], 'action': 'ensure'})
        self.assertNotEqual(other['path'], created['path'])
        with patch.object(self.gateway.reuse, 'open_file', return_value={'opened': created['path']}) as opened:
            self.assertTrue(self.ok('explorer.context', {**context, 'action': 'open'})['opened'])
            opened.assert_called_once_with({'path': created['path']})
        self.assertEqual(self.send('explorer.context', {**context, 'rowId': '../../bad', 'action': 'ensure'})['error']['code'], 'NOT_FOUND')


if __name__ == '__main__':
    unittest.main()

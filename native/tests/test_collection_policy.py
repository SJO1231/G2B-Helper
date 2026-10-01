import copy
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'native'))
from pce.gateway import Gateway
from pce.model import loads, Fault


class CollectionPolicyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='pce-scope-')
        self.gateway = Gateway(Path(self.directory.name) / 'scope.sqlite3')

    def tearDown(self):
        self.gateway.store.db.close()
        self.directory.cleanup()

    def send(self, command, payload=None, request_id=None):
        return self.gateway.handle({'protocolVersion': 1, 'requestId': request_id or str(uuid.uuid4()),
                                    'command': command, 'payload': payload or {}})

    def ok(self, command, payload=None, request_id=None):
        response = self.send(command, payload, request_id)
        self.assertNotIn('error', response)
        return response['result']

    def payload(self, number='R01'):
        point = {'areaCd': '14', 'depth1': '01001', 'depth2': '01114', 'ctrtDmndRcptNo': number,
                 'ctrtDmndRcptOrd': '000', 'quantity': 0, 'enabled': False}
        return {'pointInfo': point, 'tables': {'items': [{**point, 'ctrtDmndRcptItemSqno': '01'}]}}

    def bundle(self, *payloads):
        return {'format': 'pce-transfer', 'version': 1,
                'captures': [{'captureId': str(uuid.uuid4()), 'payload': p, 'origin': 'https://example.test'} for p in payloads]}

    def test_default_area_required_without_overriding_explicit_custom_rules(self):
        for area in (None, '13'):
            payload = self.payload()
            payload['pointInfo'].pop('areaCd')
            if area is not None:
                payload['pointInfo']['areaCd'] = area
            before = self.ok('capture.list')
            result = self.send('capture.collect', {'bundle': self.bundle(payload), 'policyVersion': 0})
            self.assertIn('error', result)
            self.assertEqual(self.ok('capture.list'), before)
        payload = self.payload()
        payload['pointInfo']['areaCd'] = '13'
        payload['tables'] = {'rows': [{'id': 'x'}]}
        rules = [{'sourceId': 'dataset.custom', 'dataset': 'rows', 'identityFields': ['id'],
                  'screenFilter': {'field': 'areaCd', 'operator': 'equals', 'values': ['13']}}]
        self.assertEqual(self.gateway.collector.scope_payload(payload, rules, True)['frames'][0]['tables'], payload['tables'])

    def test_shared_cross_runtime_collection_scope_cases(self):
        cases = loads((ROOT / 'tests' / 'collection-scope-cases.json').read_text(encoding='utf-8-sig'))
        for case in cases:
            with self.subTest(case['name']):
                original = copy.deepcopy(case['payload'])
                rules = case.get('policy', {}).get('rules')
                if case['allowed']:
                    result = self.gateway.collector.scope_payload(case['payload'], rules)
                    if 'framePaths' in case:
                        self.assertEqual([frame['framePath'] for frame in result['frames']], case['framePaths'])
                    self.assertNotIn('secret', str(result))
                else:
                    with self.assertRaises(Fault) as error:
                        self.gateway.collector.scope_payload(case['payload'], rules)
                    self.assertEqual(error.exception.code, 'AMBIGUOUS' if case['status'] == 'ambiguous' else 'COLLECTION_SCOPE')
                self.assertEqual(case['payload'], original)

    def test_policy_version_and_atomic_retry(self):
        policy = self.ok('collector.policy')
        self.assertEqual(policy, {'version': 1, 'storeVersion': 0, 'rules': None})
        bundle = self.bundle(self.payload())
        params = {'bundle': bundle, 'policyVersion': 0}
        result = self.ok('capture.collect', params, 'retry')
        self.assertEqual(self.ok('capture.collect', params, 'retry'), result)
        self.assertEqual(self.ok('capture.collect', params), result)
        self.assertEqual(len(self.ok('capture.list')), 1)
        self.ok('settings.save', {'key': 'collector.rules', 'value': []})
        self.assertEqual(self.ok('capture.collect', params, 'retry'), result)
        stale = self.send('capture.collect', params)
        self.assertEqual(stale['error']['code'], 'STALE_VERSION')
        for version in (None, True, '1'):
            self.assertIn('error', self.send('capture.collect', {'bundle': bundle, 'policyVersion': version}))
        self.assertIn('error', self.send('capture.collect', {'bundle': self.bundle(self.payload()), 'policyVersion': 1}))
        self.assertEqual(len(self.ok('capture.list')), 1)

    def test_capture_purpose_and_partial_read_warnings(self):
        bundle = self.bundle(self.payload())
        bundle['captures'][0]['purpose'] = 'extraction-save'
        self.assertIn('error', self.send('capture.collect', {'bundle': bundle, 'policyVersion': 0}))
        self.assertEqual(len(self.ok('capture.list')), 0)
        self.ok('capture.import', {'bundle': bundle})
        frame = {**self.payload(), 'framePath': 'top/selected', 'warnings': ['partial table']}
        payload = {'pointInfo': {}, 'tables': {}, 'frames': [frame], 'warnings': ['permission denied', 'permission denied']}
        capture_id = self.ok('capture.collect', {'bundle': self.bundle(payload), 'policyVersion': 0})['captureIds'][0]
        warnings = self.ok('capture.read', {'captureId': capture_id})['payload']['warnings']
        self.assertEqual(warnings, ['permission denied', '[top/selected] partial table'])

    def test_unknown_ambiguous_and_partial_identity_never_saved(self):
        variants = []
        for key, value in [('depth1', 'wrong'), ('depth2', '99999'), ('depth2', None), ('depth2', '01108'), ('depth2', '01118')]:
            payload = self.payload()
            payload['pointInfo'][key] = value
            variants.append(payload)
        multiple = self.payload()
        multiple['tables']['items'].append(self.payload('other')['tables']['items'][0])
        variants.append(multiple)
        partial = self.payload()
        partial['tables']['items'].append({'ctrtDmndRcptNo': 'other'})
        variants.append(partial)
        for payload in variants:
            # A valid first event must also roll back when a later event is disallowed.
            self.assertIn('error', self.send('capture.collect', {'bundle': self.bundle(self.payload(), payload), 'policyVersion': 0}))
            self.assertEqual(len(self.ok('capture.list')), 0)
        self.ok('capture.import', {'bundle': self.bundle(variants[0])})
        self.assertEqual(len(self.ok('capture.list')), 1)

    def test_frame_scope_excludes_unrelated_and_preserves_values_provenance(self):
        allowed = {**self.payload(), 'framePath': 'top/selected', 'url': 'https://fixture.g2b.go.kr/detail'}
        other = {'framePath': 'top/unrelated', 'url': 'https://example.test/other',
                 'pointInfo': {'secret': 'unrelated'}, 'tables': {'private': [{'secret': 'unrelated'}]}}
        mixed = {'pointInfo': {'secret': 'pooled-root'}, 'tables': {'pooled': [{'secret': 'pooled'}]}, 'frames': [other, allowed]}
        capture_id = self.ok('capture.collect', {'bundle': self.bundle(mixed), 'policyVersion': 0})['captureIds'][0]
        stored = self.ok('capture.read', {'captureId': capture_id})['payload']
        self.assertEqual(len(stored['frames']), 1)
        self.assertEqual(stored['frames'][0]['framePath'], allowed['framePath'])
        self.assertEqual(stored['frames'][0]['url'], allowed['url'])
        self.assertNotIn('secret', stored['pointInfo'])
        self.assertNotIn('pooled', stored['tables'])
        self.assertEqual(stored['frames'][0]['pointInfo']['quantity'], 0)
        self.assertIs(stored['frames'][0]['pointInfo']['enabled'], False)
        mixed['frames'].append({**self.payload('other'), 'framePath': 'top/conflict'})
        self.assertIn('error', self.send('capture.collect', {'bundle': self.bundle(mixed), 'policyVersion': 0}))
        self.assertEqual(len(self.ok('capture.list')), 1)

    def test_custom_rule_screen_and_dataset_must_share_frame(self):
        rule = {'sourceId': 'procurement.receipt', 'dataset': 'chosen', 'identityFields': ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd'],
                'screenFilter': {'field': 'screen', 'operator': 'equals', 'values': ['chosen']}}
        self.ok('settings.save', {'key': 'collector.rules', 'value': [rule]})
        identity = {'ctrtDmndRcptNo': 'R01', 'ctrtDmndRcptOrd': '000', 'zero': 0, 'flag': False}
        payload = {'pointInfo': {'screen': 'chosen'}, 'tables': {'chosen': [identity]}, 'frames': [
            {'framePath': 'screen', 'pointInfo': {'screen': 'chosen'}, 'tables': {}},
            {'framePath': 'rows', 'pointInfo': {}, 'tables': {'chosen': [identity]}}]}
        self.assertIn('error', self.send('capture.collect', {'bundle': self.bundle(payload), 'policyVersion': 1}))
        payload['frames'][0]['tables'] = {'chosen': [identity, {'missingIdentity': True}], 'unrelated': [{'secret': True}]}
        capture_id = self.ok('capture.collect', {'bundle': self.bundle(payload), 'policyVersion': 1})['captureIds'][0]
        stored = self.ok('capture.read', {'captureId': capture_id})['payload']
        self.assertEqual(stored['frames'][0]['tables'], {'chosen': [identity]})
        self.assertEqual(len(stored['frames']), 1)

    def test_conflicting_items_across_frames_and_empty_observations(self):
        first, blank, conflict = self.payload(), self.payload(), self.payload()
        first['tables']['items'][0]['price'] = '100'
        blank['tables']['items'][0]['price'] = ''
        conflict['tables']['items'][0]['price'] = '200'
        frames = [{**value, 'framePath': str(index), 'warnings': []} for index, value in enumerate([first, blank, conflict])]
        self.assertIn('error', self.send('capture.collect', {'bundle': self.bundle({'pointInfo': {}, 'tables': {}, 'frames': frames}), 'policyVersion': 0}))
        self.assertEqual(len(self.ok('capture.list')), 0)

    def test_rules_export_compatible_validation(self):
        valid = {'sourceId': 'procurement.receipt', 'dataset': '$pointInfo', 'identityFields': ['ctrtDmndRcptNo'], 'enabled': False}
        for changes in ({'enabled': 'false'}, {'dataset': '  '}, {'identityFields': ['  ']}):
            self.assertIn('error', self.send('settings.save', {'key': 'collector.rules', 'value': [{**valid, **changes}]}))
        self.ok('settings.save', {'key': 'collector.rules', 'value': [valid]})
        self.assertEqual(self.ok('collector.policy')['rules'], [valid])
        self.assertIn('error', self.send('capture.collect', {'bundle': self.bundle(self.payload()), 'policyVersion': 1}))

    def test_custom_item_and_generic_rules_allow_distinct_row_identities(self):
        keys = ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd', 'ctrtDmndRcptItemSqno']
        rule = {'sourceId': 'procurement.receipt_item', 'dataset': 'items', 'identityFields': keys}
        saved = self.ok('settings.save', {'key': 'collector.rules', 'value': [rule]})
        for count in (2, 24):
            payload = self.payload()
            payload['tables']['items'] = [{**payload['pointInfo'], 'ctrtDmndRcptItemSqno': str(index).zfill(2)} for index in range(count)]
            capture_id = self.ok('capture.collect', {'bundle': self.bundle(payload), 'policyVersion': saved['storeVersion']})['captureIds'][0]
            stored = self.ok('capture.read', {'captureId': capture_id})['payload']
            self.assertEqual(len(stored['tables']['items']), count)
        bad = self.payload()
        bad['tables']['items'].append({**bad['tables']['items'][0], 'ctrtDmndRcptNo': 'different', 'ctrtDmndRcptItemSqno': '02'})
        self.assertIn('error', self.send('capture.collect', {'bundle': self.bundle(bad), 'policyVersion': saved['storeVersion']}))
        source = self.ok('dataset.create', {'name': 'scope-generic', 'columns': [{'field': 'code', 'kind': 'text'}]})['sourceId']
        saved = self.ok('settings.save', {'key': 'collector.rules', 'storeVersion': saved['storeVersion'], 'value': [
            {'sourceId': source, 'dataset': 'rows', 'identityFields': ['code']}]})
        rows = [{'code': '001', 'zero': 0}, {'code': '002', 'flag': False}]
        capture_id = self.ok('capture.collect', {'bundle': self.bundle({'pointInfo': {}, 'tables': {'rows': rows}}), 'policyVersion': saved['storeVersion']})['captureIds'][0]
        self.assertEqual(self.ok('capture.read', {'captureId': capture_id})['payload']['tables']['rows'], rows)
        self.assertIn('error', self.send('capture.collect', {'bundle': self.bundle({'pointInfo': {}, 'tables': {'rows': rows + [{'code': '001', 'zero': 1}]}}), 'policyVersion': saved['storeVersion']}))

    def test_actual_source_scope_without_business_value_output(self):
        files = list((ROOT / '참고자료').glob('data_map*.txt'))
        if not files:
            self.skipTest('Local source evidence unavailable')
        self.assertGreaterEqual(len(files), 31)
        accepted_depths, blocked_depths = set(), set()
        for file in files:
            payload = loads(file.read_text(encoding='utf-8-sig'))
            depth = payload['pointInfo'].get('depth2')
            response = self.send('capture.collect', {'bundle': self.bundle(payload), 'policyVersion': 0})
            if 'error' in response:
                blocked_depths.add(depth)
            else:
                accepted_depths.add(depth)
                self.assertTrue(depth in ('01114', '01117', '01174', '01571'))
        self.assertTrue({'01114', '01117', '01174', '01571'} <= accepted_depths)
        self.assertTrue({'01009', '01108', '01118'} <= blocked_depths)


if __name__ == '__main__':
    unittest.main()

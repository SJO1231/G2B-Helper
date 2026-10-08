import copy
import io
import json
import struct
import shutil
import subprocess
import sys
import tempfile
import sqlite3
from contextlib import closing
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pce.mvp import MvpGateway, record_id, IDENTITIES
from host import native_loop, response_frames

def observation(stage='receipt', number='TEST-001', order='01'):
    screens = {'receipt': ('01001', '01117'), 'bid': ('01173', '01174'), 'contract': ('01570', '01571')}
    first, second = screens[stage]
    fields = {**dict(zip(IDENTITIES[stage], [number, order])), 'quantity': 0, 'checked': False, 'unitPrice': '35608652.5', 'blank': '', '': '다운로드'}
    point = {'areaCd': '14', 'depth1': first, 'depth2': second, **fields}
    return {'stage': stage, 'identity': [number, order], 'fields': fields, 'children': [], 'rawJson': json.dumps({'pointInfo': point, 'tables': {}}, ensure_ascii=False), 'source': {'url': 'https://www.g2b.go.kr/', 'areaCd': '14', 'depth1': first, 'depth2': second, 'framePath': 'top'}, 'capturedAt': '2026-10-01T00:00:00Z'}

def source_capture(value):
    """Make a changed synthetic source, instead of claiming edits came from old raw."""
    result = copy.deepcopy(value)
    raw = json.loads(result['rawJson'])
    raw['pointInfo'] = {k: v for k, v in raw['pointInfo'].items() if k in ('areaCd', 'depth1', 'depth2', 'depth3')}
    raw['pointInfo'].update(result['fields'])
    raw['tables'] = {child['key']: copy.deepcopy(child['rows']) for child in result['children']}
    result['rawJson'] = json.dumps(raw, ensure_ascii=False)
    return result

class MvpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='G2B 한글 공백 ')
        self.path = Path(self.directory.name) / '테스트 DB.sqlite3'
        self.gateway = MvpGateway(self.path)
        self.sequence = 0

    def tearDown(self):
        self.gateway.close(); self.directory.cleanup()

    def call(self, command, payload=None, request_id=None):
        self.sequence += 1
        return self.gateway.handle({'protocolVersion': 1, 'requestId': request_id or str(self.sequence), 'command': command, 'payload': payload or {}})

    def save(self, observations, decisions=None, request_id=None):
        observations = [source_capture(value) for value in observations]
        preview = self.call('mvp.preview', {'observations': observations})['result']
        result = self.call('mvp.apply', {'observations': observations, 'token': preview['token'], 'decisions': decisions or []}, request_id)
        return result

    def records(self, stage='receipt'):
        return self.call('mvp.records', {'stage': stage})['result']

    def update_settings(self, **changes):
        current = self.call('mvp.settings.read')['result']
        current['settings'].update(changes)
        return self.call('mvp.settings.save', current)

    def test_trash_restore_preserves_raw_user_values_and_restart(self):
        self.save([observation('contract')])
        record = self.records('contract')[0]
        record['userValues'].update({'종결': False, '종결금액': '0.00', '메모': '보존'})
        record = self.call('mvp.edit', {'records': [record]})['result'][0]
        self.assertNotIn('error', self.update_settings(columnLocks={'종결': True, 'quantity': True}))
        payload = {'records': [{'recordId': record['recordId'], 'storeVersion': record['storeVersion']}]}
        response = self.call('mvp.trash', payload, 'trash-once')
        self.assertEqual(response['result'], {'count': 1})
        self.assertEqual(response, self.call('mvp.trash', payload, 'trash-once'))
        self.assertEqual(self.records('contract'), [])
        trashed = self.call('mvp.records', {'stage': 'contract', 'trashed': True})['result'][0]
        self.assertEqual(trashed['storeVersion'], record['storeVersion'] + 1)
        self.assertTrue(trashed['deletedAt'])
        self.assertEqual(trashed['rawJson'], record['rawJson'])
        self.assertEqual(trashed['userValues'], record['userValues'])
        self.assertEqual(self.call('mvp.edit', {'records': [trashed]})['error']['code'], 'TRASHED')
        self.assertEqual(self.call('mvp.preview', {'observations': [observation('contract')]})['error']['code'], 'TRASHED')
        self.assertEqual(self.call('mvp.apply', {'observations': [observation('contract')], 'token': '', 'decisions': []})['error']['code'], 'TRASHED')
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.call('mvp.records', {'stage': 'contract', 'trashed': True})['result'], [trashed])
        restore = {'records': [{'recordId': trashed['recordId'], 'storeVersion': trashed['storeVersion']}]}
        restored_response = self.call('mvp.restore', restore, 'restore-once')
        self.assertEqual(restored_response['result'], {'count': 1})
        self.assertEqual(restored_response, self.call('mvp.restore', restore, 'restore-once'))
        restored = self.records('contract')[0]
        self.assertNotIn('deletedAt', restored)
        self.assertEqual(restored['storeVersion'], trashed['storeVersion'] + 1)
        for key in ('rawJson', 'fields', 'children', 'source', 'userValues'):
            self.assertEqual(restored[key], record[key])
        self.assertEqual(self.call('mvp.records', {'stage': 'contract', 'trashed': True})['result'], [])
        self.assertNotIn('error', self.save([observation('contract')]))

    def test_lifecycle_atomic_cas_and_validation(self):
        self.save([observation(number='A'), observation(number='B')])
        records = self.records()
        refs = [{'recordId': row['recordId'], 'storeVersion': row['storeVersion']} for row in records]
        stale = copy.deepcopy(refs); stale[1]['storeVersion'] = 0
        self.assertEqual(self.call('mvp.trash', {'records': stale})['error']['code'], 'STALE')
        self.assertEqual(self.records(), records)
        for invalid in [[], [refs[0], refs[0]], [{**refs[0], 'storeVersion': True}], [{**refs[0], 'recordId': 'missing'}]]:
            self.assertIn('error', self.call('mvp.trash', {'records': invalid}))
            self.assertEqual(self.records(), records)
        self.assertEqual(self.call('mvp.restore', {'records': refs})['error']['code'], 'STALE')
        self.assertEqual(self.call('mvp.trash', {'records': refs}, 'trash-batch')['result']['count'], 2)
        self.assertEqual(self.call('mvp.trash', {'records': refs})['error']['code'], 'STALE')
        self.assertEqual(self.call('mvp.restore', {'records': refs})['error']['code'], 'STALE')
        trashed = self.call('mvp.records', {'stage': 'receipt', 'trashed': True})['result']
        restore = [{'recordId': row['recordId'], 'storeVersion': row['storeVersion']} for row in trashed]
        restore[1]['storeVersion'] -= 1
        self.assertEqual(self.call('mvp.restore', {'records': restore})['error']['code'], 'STALE')
        self.assertEqual(self.call('mvp.records', {'stage': 'receipt', 'trashed': True})['result'], trashed)
        self.assertEqual(self.call('mvp.trash', {'records': refs}, 'trash-batch')['result']['count'], 2)
        self.assertEqual(self.call('mvp.restore', {'records': refs}, 'trash-batch')['error']['code'], 'REQUEST_ID')
        self.assertIn('error', self.call('mvp.records', {'stage': 'receipt', 'trashed': 1}))

    def test_old_database_migration_keeps_active_payload_and_settings(self):
        self.gateway.close()
        legacy = Path(self.directory.name) / 'legacy.sqlite3'
        source = observation(); record = {**source, 'recordId': record_id(source), 'storeVersion': 7, 'userValues': {'메모': False}}
        with closing(sqlite3.connect(legacy)) as db:
            db.execute('CREATE TABLE mvp_records(record_id TEXT PRIMARY KEY,stage TEXT NOT NULL,store_version INTEGER NOT NULL,payload TEXT NOT NULL)')
            db.execute('INSERT INTO mvp_records VALUES(?,?,?,?)', (record['recordId'], record['stage'], 7, json.dumps(record)))
            db.commit()
        self.gateway = MvpGateway(legacy)
        self.assertEqual(self.records(), [record])
        self.assertIn('deleted_at', {row[1] for row in self.gateway.db.execute('PRAGMA table_info(mvp_records)')})
        self.assertEqual(self.call('mvp.trash', {'records': [{'recordId': record['recordId'], 'storeVersion': 7}]})['result']['count'], 1)

    def test_settings_types_and_screen_rules_are_validated_and_persisted(self):
        rule = {'id': 'custom', 'stage': 'receipt', 'urlPattern': 'https://*.g2b.go.kr/custom*', 'areaCd': '22', 'depth1': 'C1', 'depth2': 'C2', 'depth3': ''}
        for settings in [{'hideEmptyTables': 1}, {'columnLocks': {'quantity': 1}}, {'columnLocks': []}, {'screenRules': None}, {'screenRules': [rule, rule]}, {'screenRules': [{**rule, 'stage': 'bad'}]}, {'screenRules': [{**rule, 'depth3': False}]}, {'screenRules': [{**rule, 'urlPattern': ''}]}]:
            self.assertIn('error', self.update_settings(**settings))
        saved = self.update_settings(hideEmptyTables=True, columnTypes={'quantity': 'money'}, columnLocks={'quantity': True, 'checked': False}, screenRules=[rule])['result']
        self.assertTrue(saved['settings']['hideEmptyTables'])
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.call('mvp.settings.read')['result'], saved)

    def test_column_formats_and_seven_types_persist_and_invalid_settings_are_atomic(self):
        types = {kind: kind for kind in ('text', 'number', 'money', 'percent', 'date', 'datetime', 'boolean')}
        formats = {'money': {'decimals': 2, 'grouping': True}, 'date': {'dateFormat': 'dash'}, '__proto__': {'decimals': 0}}
        saved = self.update_settings(columnTypes=types, columnFormats=formats)['result']
        for invalid in [None, [], {'x': {'decimals': True}}, {'x': {'decimals': -1}}, {'x': {'decimals': 21}}, {'x': {'grouping': 1}}, {'x': {'dateFormat': 'other'}}, {'x': {'unknown': True}}]:
            self.assertIn('error', self.update_settings(columnFormats=invalid))
            self.assertEqual(self.call('mvp.settings.read')['result'], saved)
        self.assertIn('error', self.update_settings(columnTypes={'bad': []}))
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.call('mvp.settings.read')['result'], saved)

    def test_default_gate_excludes_management_list_screens_until_a_rule_adds_them(self):
        # #17: notice (01175) and contract (01572) management lists are not collected by default.
        cases = [('bid', '01179', '01175'), ('contract', '01579', '01572')]
        def screen(stage, depth3):
            source = observation(stage); source['source']['depth3'] = depth3
            raw = json.loads(source['rawJson']); raw['pointInfo']['depth3'] = depth3; source['rawJson'] = json.dumps(raw, ensure_ascii=False)
            return source
        for stage, kept, excluded in cases:
            self.assertNotIn('error', self.call('mvp.preview', {'observations': [screen(stage, kept)]}))
            self.assertEqual(self.call('mvp.preview', {'observations': [screen(stage, excluded)]})['error']['code'], 'SCREEN')
        rules = [{'id': 'list-' + stage, 'stage': stage, 'urlPattern': '*', 'areaCd': '14', 'depth1': screen(stage, excluded)['source']['depth1'], 'depth2': screen(stage, excluded)['source']['depth2'], 'depth3': excluded} for stage, _, excluded in cases]
        self.assertNotIn('error', self.update_settings(screenRules=rules))
        for stage, _, excluded in cases:
            self.assertNotIn('error', self.call('mvp.preview', {'observations': [screen(stage, excluded)]}))

    def test_persisted_custom_rules_gate_source_and_keep_origin_allowlist(self):
        source = observation(); source['source'].update(url='https://www.g2b.go.kr/custom-page', areaCd='22', depth1='C1', depth2='C2', depth3='tab')
        raw = json.loads(source['rawJson']); raw['pointInfo'].update({key: source['source'][key] for key in ('areaCd', 'depth1', 'depth2', 'depth3')}); source['rawJson'] = json.dumps(raw)
        rule = {'id': 'custom', 'stage': 'receipt', 'urlPattern': 'https://*.g2b.go.kr/custom*', 'areaCd': '22', 'depth1': 'C1', 'depth2': 'C2', 'depth3': 'tab'}
        self.assertEqual(self.call('mvp.preview', {'observations': [source]})['error']['code'], 'SCREEN')
        self.assertNotIn('error', self.update_settings(screenRules=[rule]))
        self.assertNotIn('error', self.save([source]))
        self.assertEqual(self.records()[0]['source'], source['source'])
        for override in [{'stage': 'bid'}, {'areaCd': 'other'}, {'depth1': 'other'}, {'depth2': 'other'}, {'depth3': 'other'}, {'urlPattern': 'https://www.g2b.go.kr/other'}]:
            self.update_settings(screenRules=[{**rule, **override}])
            self.assertEqual(self.call('mvp.preview', {'observations': [source]})['error']['code'], 'SCREEN')
        self.update_settings(screenRules=[{**rule, 'depth3': '', 'urlPattern': 'https://www.g2b.go.kr/custom'}])
        self.assertNotIn('error', self.call('mvp.preview', {'observations': [source]}))
        self.update_settings(screenRules=[])
        self.assertEqual(self.call('mvp.preview', {'observations': [source]})['error']['code'], 'SCREEN')
        self.update_settings(screenRules=[{**rule, 'urlPattern': '*'}])
        for url in ['https://g2b.go.kr.evil.test/custom', 'https://foreign.test/custom', 'file:///g2b.go.kr/custom']:
            denied = copy.deepcopy(source); denied['source']['url'] = url
            self.assertEqual(self.call('mvp.preview', {'observations': [denied]})['error']['code'], 'SCREEN')
        self.update_settings(screenRules=[rule, {**rule, 'id': 'ambiguous', 'stage': 'bid'}])
        self.assertEqual(self.call('mvp.preview', {'observations': [source]})['error']['code'], 'SCREEN')

    def test_locked_zero_false_user_values_and_source_fields_are_atomic(self):
        self.save([observation(number='A'), observation(number='B')])
        records = self.records()
        records[0]['userValues'] = {'zero': 0, 'flag': False}
        records[1]['userValues'] = {'zero': 0, 'flag': False}
        records = self.call('mvp.edit', {'records': records})['result']
        self.update_settings(columnLocks={'quantity': True, 'checked': True, 'zero': True, 'flag': True, 'unlocked': False})
        for field, value, location in [('quantity', False, 'fields'), ('checked', 0, 'fields'), ('zero', False, 'userValues'), ('flag', 0, 'userValues')]:
            changes = copy.deepcopy(records)
            changes[0]['fields']['blank'] = 'first change'
            changes[1][location][field] = value
            self.assertEqual(self.call('mvp.edit', {'records': changes})['error']['code'], 'LOCKED')
            self.assertEqual(self.records(), records)
        removed = copy.deepcopy(records[0]); del removed['userValues']['zero']
        self.assertEqual(self.call('mvp.edit', {'records': [removed]})['error']['code'], 'LOCKED')
        allowed = copy.deepcopy(records[0]); allowed['userValues']['unlocked'] = False
        self.assertNotIn('error', self.call('mvp.edit', {'records': [allowed]}))

    def test_new_all_values_and_raw_preserved(self):
        source = observation()
        self.assertNotIn('error', self.save([source]))
        record = self.records()[0]
        self.assertEqual(record['fields'], source['fields'])
        self.assertEqual(record['identity'][1], '01')
        self.assertEqual(record['rawJson'], source['rawJson'])

    def test_preview_never_stores(self):
        self.call('mvp.preview', {'observations': [observation()]})
        self.assertEqual(self.records(), [])

    def test_identical_does_not_increment_version(self):
        self.save([observation()]); self.save([observation()])
        self.assertEqual(self.records()[0]['storeVersion'], 1)

    def test_missing_blank_false_and_zero(self):
        source = observation(); self.save([source])
        updated = observation(); updated['fields']['quantity'] = ''; del updated['fields']['checked']; updated['fields']['unitPrice'] = None
        self.save([updated])
        self.assertEqual(self.records()[0]['fields'], source['fields'])

    def test_existing_blank_supplemented(self):
        self.save([observation()])
        updated = observation(); updated['fields']['blank'] = '보완'
        self.assertEqual(self.save([updated])['result']['counts']['supplemented'], 1)

    def test_conflict_only_approved_fields(self):
        self.save([observation()]); updated = observation(); updated['fields'].update(quantity=3, unitPrice='400.01')
        preview = self.call('mvp.preview', {'observations': [source_capture(updated)]})['result']
        choices = [{**c, 'useIncoming': c['field'] == 'quantity'} for c in preview['conflicts']]
        self.assertNotIn('error', self.save([updated], choices))
        fields = self.records()[0]['fields']; self.assertEqual(fields['quantity'], 3); self.assertEqual(fields['unitPrice'], '35608652.5')

    def test_preview_reports_each_item_status(self):
        self.save([observation(number='A'), observation(number='B'), observation(number='C')])
        supplemented = observation(number='B'); supplemented['fields']['blank'] = '보완'
        changed = observation(number='C'); changed['fields']['quantity'] = 7
        sources = [source_capture(value) for value in (observation(number='A'), supplemented, changed, observation(number='D'))]
        items = self.call('mvp.preview', {'observations': sources})['result']['items']
        self.assertEqual([item['status'] for item in items], ['identical', 'supplemented', 'changed', 'inserted'])
        self.assertEqual([item['recordId'] for item in items], [record_id(value) for value in sources])

    def test_extraction_edits_are_compared_and_saved_as_record_values(self):
        source = source_capture(observation())
        edits = [{'quantity': 5}]
        preview = self.call('mvp.preview', {'observations': [source], 'edits': edits})['result']
        self.assertEqual(preview['items'][0]['status'], 'inserted')
        self.assertEqual(self.call('mvp.apply', {'observations': [source], 'edits': [{'quantity': 6}], 'token': preview['token'], 'decisions': []})['error']['code'], 'STALE')
        self.assertNotIn('error', self.call('mvp.apply', {'observations': [source], 'edits': edits, 'token': preview['token'], 'decisions': []}))
        record = self.records()[0]
        self.assertEqual(record['fields']['quantity'], 5); self.assertEqual(record['rawJson'], source['rawJson'])
        # The edited value now differs from the same screen value, and an edit back to the screen value conflicts with the DB.
        self.assertEqual(self.call('mvp.preview', {'observations': [source]})['result']['items'][0]['status'], 'changed')
        preview = self.call('mvp.preview', {'observations': [source], 'edits': [{'quantity': 5}]})['result']
        self.assertEqual(preview['items'][0]['status'], 'identical')
        preview = self.call('mvp.preview', {'observations': [source], 'edits': [{'quantity': 8}]})['result']
        self.assertEqual([(c['field'], c['previous'], c['incoming']) for c in preview['conflicts']], [('quantity', 5, 8)])
        self.assertNotIn('error', self.call('mvp.apply', {'observations': [source], 'edits': [{'quantity': 8}], 'token': preview['token'], 'decisions': [{**preview['conflicts'][0], 'useIncoming': True}]}))
        self.assertEqual(self.records()[0]['fields']['quantity'], 8)

    def test_extraction_edits_keep_identity_locks_and_shape(self):
        source = source_capture(observation())
        self.update_settings(columnLocks={'unitPrice': True})
        for edits in ([{'ctrtDmndRcptNo': 'OTHER'}], [{'notInRecord': 1}], [{}], [[1]], [], [{'quantity': 1}, None]):
            self.assertIn('error', self.call('mvp.preview', {'observations': [source], 'edits': edits}), edits)
        self.assertEqual(self.call('mvp.preview', {'observations': [source], 'edits': [{'unitPrice': '1'}]})['error']['code'], 'LOCKED')
        self.assertEqual(self.call('mvp.preview', {'observations': [source], 'edits': [None]})['result']['items'][0]['status'], 'inserted')
        self.assertEqual(self.records(), [])

    def test_false_is_not_zero(self):
        self.save([observation()]); changed = observation(); changed['fields']['quantity'] = False
        self.assertEqual(len(self.call('mvp.preview', {'observations': [source_capture(changed)]})['result']['conflicts']), 1)

    def test_stale_comparison_rejected(self):
        source = observation(); self.save([source]); updated = observation(); updated['fields']['blank'] = '보완'
        updated = source_capture(updated)
        preview = self.call('mvp.preview', {'observations': [updated]})['result']
        record = self.records()[0]; record['fields']['blank'] = '다른 창'
        self.call('mvp.edit', {'records': [record]})
        result = self.call('mvp.apply', {'observations': [updated], 'token': preview['token'], 'decisions': []})
        self.assertEqual(result['error']['code'], 'STALE')

    def test_different_orders_and_stages(self):
        self.save([observation(order='00'), observation(order='01'), observation('contract')])
        self.assertEqual(len(self.records()), 2); self.assertEqual(len(self.records('contract')), 1)

    def test_validation_rolls_back_entire_batch(self):
        invalid = observation(number='INVALID'); invalid['source']['url'] = 'https://g2b.go.kr.evil.example/'
        self.assertIn('error', self.save([observation(), invalid]) if False else self.call('mvp.apply', {'observations': [observation(), invalid], 'token': '', 'decisions': []}))
        self.assertEqual(self.records(), [])

    def test_edit_failure_rolls_back_first_row(self):
        self.save([observation(number='A'), observation(number='B')]); rows = self.records()
        rows[0]['fields']['blank'] = '첫 행'; rows[1]['storeVersion'] = -1
        self.assertEqual(self.call('mvp.edit', {'records': rows})['error']['code'], 'STALE')
        self.assertEqual(self.records()[0]['fields']['blank'], '')

    def test_request_replay_once_and_changed_id_rejected(self):
        source = observation(); preview = self.call('mvp.preview', {'observations': [source]})['result']
        payload = {'observations': [source], 'token': preview['token'], 'decisions': []}
        first = self.call('mvp.apply', payload, 'retry'); second = self.call('mvp.apply', payload, 'retry')
        self.assertEqual(first, second); self.assertEqual(self.records()[0]['storeVersion'], 1)
        payload['token'] = 'changed'; self.assertEqual(self.call('mvp.apply', payload, 'retry')['error']['code'], 'REQUEST_ID')

    def test_restart_requery_unicode_path(self):
        self.save([observation()]); self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.records()[0]['identity'], ['TEST-001', '01'])

    def test_children_partial_merge_no_delete(self):
        source = observation('contract'); source['children'] = [{'key': 'items', 'label': '물품', 'kind': 'items', 'rows': [{'ctrtItemSqno': '01', 'price': '35608652.5'}, {'ctrtItemSqno': '02', 'price': '0'}, {'ctrtItemSqno': '03', 'price': '2.5'}]}]
        self.save([source]); update = copy.deepcopy(source); update['children'][0]['rows'] = [{'ctrtItemSqno': '01', 'extra': False}]
        self.save([update]); child = self.records('contract')[0]['children'][0]
        self.assertEqual(len(child['rows']), 3); self.assertEqual(child['rows'][0]['price'], '35608652.5'); self.assertIs(child['rows'][0]['extra'], False)
        update['children'][0]['rows'] = []; self.save([update]); self.assertEqual(len(self.records('contract')[0]['children'][0]['rows']), 3)

    def test_nested_conflict_review(self):
        source = observation('receipt'); source['children'] = [{'key': 'items', 'label': '물품', 'kind': 'items', 'rows': [{'ctrtDmndRcptItemSqno': '001', 'qty': 1}]}]
        self.save([source]); updated = copy.deepcopy(source); updated['children'][0]['rows'][0]['qty'] = 2
        preview = self.call('mvp.preview', {'observations': [source_capture(updated)]})['result']
        self.save([updated], [{**c, 'useIncoming': True} for c in preview['conflicts']])
        self.assertEqual(self.records()[0]['children'][0]['rows'][0]['qty'], 2)

    def test_user_completion_survives_collection(self):
        source = observation('contract'); self.save([source]); record = self.records('contract')[0]
        self.assertIs(record['userValues']['종결'], False)
        record['userValues']['종결'] = True; self.call('mvp.edit', {'records': [record]})
        source['fields']['blank'] = '보완'; self.save([source])
        self.assertIs(self.records('contract')[0]['userValues']['종결'], True)

    def test_user_fields_separate_from_raw(self):
        source = observation(); self.save([source]); record = self.records()[0]
        record['userValues']['사용자 돈'] = '1234567890123456789.123'
        self.call('mvp.edit', {'records': [record]}); saved = self.records()[0]
        self.assertEqual(saved['rawJson'], source['rawJson']); self.assertNotIn('사용자 돈', saved['fields'])

    def test_settings_compare_and_swap(self):
        config = self.call('mvp.settings.read')['result']; self.assertEqual(config['settings']['extractionMode'], 'tables')
        config['settings']['theme'] = 'dark'; self.assertNotIn('error', self.call('mvp.settings.save', config))
        self.assertEqual(self.call('mvp.settings.save', config)['error']['code'], 'STALE')

    def test_screen_and_raw_mismatch_rejected(self):
        source = observation(); source['source']['depth2'] = '01114'
        self.assertEqual(self.call('mvp.preview', {'observations': [source]})['error']['code'], 'SCREEN')

    def test_native_framed_round_trip(self):
        request = json.dumps({'protocolVersion': 1, 'requestId': 'native', 'command': 'mvp.health', 'payload': {}}).encode()
        output = io.BytesIO(); native_loop(self.gateway, io.BytesIO(struct.pack('<I', len(request)) + request), output)
        output.seek(0); size = struct.unpack('<I', output.read(4))[0]; response = json.loads(output.read(size)); self.assertTrue(response['result']['connected'])

    def test_large_unicode_chunks_reassemble(self):
        response = {'protocolVersion': 1, 'requestId': 'large', 'result': '한글' * 300000}
        frames = response_frames(response); self.assertGreater(len(frames), 1)
        self.assertTrue(all(len(json.dumps(frame, ensure_ascii=False).encode()) < 1000000 for frame in frames))
        self.assertEqual(json.loads(''.join(f['chunk']['text'] for f in frames)), response)

    def test_raw_provenance_rejects_fabricated_field_and_json_type(self):
        for field, value in [('invented', 'not from raw'), ('quantity', False), ('checked', 0)]:
            forged = observation(); forged['fields'][field] = value
            self.assertEqual(self.call('mvp.preview', {'observations': [forged]})['error']['code'], 'VALIDATION')

    def test_raw_child_provenance_rejects_fabrication_and_wrong_parent(self):
        source = observation('contract'); source['children'] = [{'key': 'items', 'label': '물품', 'kind': 'items', 'rows': [{'ctrtItemSqno': '01', 'qty': 0}]}]
        source = source_capture(source)
        for mutation in ('value', 'key', 'parent'):
            changed = copy.deepcopy(source)
            if mutation == 'value': changed['children'][0]['rows'][0]['qty'] = False
            if mutation == 'key': changed['children'][0]['key'] = 'invented'
            if mutation == 'parent':
                changed['children'][0]['rows'][0]['ctrtNo'] = 'OTHER'
                raw = json.loads(changed['rawJson']); raw['tables']['items'] = changed['children'][0]['rows']; changed['rawJson'] = json.dumps(raw)
            self.assertEqual(self.call('mvp.preview', {'observations': [changed]})['error']['code'], 'VALIDATION')

    def test_raw_frame_url_path_and_non_http_rejected(self):
        for field, value in [('url', 'https://evil.example'), ('framePath', 'different')]:
            changed = observation(); raw = json.loads(changed['rawJson']); raw[field] = value; changed['rawJson'] = json.dumps(raw)
            self.assertEqual(self.call('mvp.preview', {'observations': [changed]})['error']['code'], 'SCREEN')
        changed = observation(); changed['source']['url'] = 'ftp://g2b.go.kr/'
        self.assertEqual(self.call('mvp.preview', {'observations': [changed]})['error']['code'], 'SCREEN')

    def test_contract_defaults_and_user_values_persist_restart_and_collection(self):
        source = observation('contract'); self.save([source]); record = self.records('contract')[0]
        self.assertEqual(record['userValues'], {'종결': False, '지정일': '', '종결금액': '', '선금보증기한': '', '선금보증금액': ''})
        user = {'종결': True, '지정일': '2026.10.28', '종결금액': '12345678901234567890.01', '선금보증기한': '20261101', '선금보증금액': 0}
        record['userValues'] = copy.deepcopy(user); self.assertNotIn('error', self.call('mvp.edit', {'records': [record]}))
        source['fields']['blank'] = '보완'; self.save([source]); self.gateway.close(); self.gateway = MvpGateway(self.path)
        saved = self.records('contract')[0]
        self.assertEqual(saved['userValues'], user); self.assertNotIn('지체일수', saved['userValues']); self.assertNotIn('미종결금액', saved['userValues'])
        self.assertNotIn('종결금액', json.loads(saved['rawJson'])['pointInfo'])

    def test_derived_or_noncontract_completion_values_not_stored(self):
        self.save([observation(), observation('contract')])
        for field, value in [('지체일수', 1), ('미종결금액', '10')]:
            record = self.records('contract')[0]; record['userValues'][field] = value
            self.assertEqual(self.call('mvp.edit', {'records': [record]})['error']['code'], 'VALIDATION')
        record = self.records()[0]; record['userValues']['종결'] = False
        self.assertEqual(self.call('mvp.edit', {'records': [record]})['error']['code'], 'VALIDATION')

    def test_parent_with_24_item_rows_is_one_record(self):
        source = observation('contract'); source['children'] = [{'key': 'items', 'label': '물품', 'kind': 'items', 'rows': [{'ctrtNo': 'TEST-001', 'ctrtChgOrd': '01', 'ctrtItemSqno': str(i).zfill(2), 'qty': i} for i in range(24)]}]
        self.assertNotIn('error', self.save([source])); records = self.records('contract')
        self.assertEqual(len(records), 1); self.assertEqual(len(records[0]['children'][0]['rows']), 24)

    def test_zero_false_identity_preserved_and_type_cannot_change_on_edit(self):
        source = observation('contract', '0', 'false'); source['fields']['ctrtNo'] = 0; source['fields']['ctrtChgOrd'] = False
        self.assertNotIn('error', self.save([source])); record = self.records('contract')[0]
        self.assertEqual(record['identity'], ['0', 'false']); self.assertIs(record['fields']['ctrtChgOrd'], False)
        record['fields']['ctrtNo'] = '0'; self.assertEqual(self.call('mvp.edit', {'records': [record]})['error']['code'], 'VALIDATION')

    def test_native_loop_large_unicode_database_round_trip(self):
        source = observation(); source['fields']['large'] = '한글🙂' * 100000; self.save([source])
        request = json.dumps({'protocolVersion': 1, 'requestId': 'large-native', 'command': 'mvp.records', 'payload': {'stage': 'receipt'}}).encode('utf-8')
        output = io.BytesIO(); native_loop(self.gateway, io.BytesIO(struct.pack('<I', len(request)) + request), output)
        output.seek(0); frames = []
        while header := output.read(4):
            size = struct.unpack('<I', header)[0]; self.assertLess(size, 1000000); frames.append(json.loads(output.read(size)))
        self.assertGreater(len(frames), 1)
        reply = json.loads(''.join(frame['chunk']['text'] for frame in frames))
        self.assertEqual(reply['result'][0]['fields']['large'], source['fields']['large'])

    def test_malformed_structures_and_boolean_versions_rejected(self):
        source = observation(); source['source'] = []
        self.assertEqual(self.call('mvp.preview', {'observations': [source]})['error']['code'], 'SCREEN')
        self.assertEqual(self.call('mvp.edit', {'records': [None]})['error']['code'], 'VALIDATION')
        config = self.call('mvp.settings.read')['result']; config['settings']['dictionary'] = []
        self.assertEqual(self.call('mvp.settings.save', config)['error']['code'], 'VALIDATION')
        self.save([observation()]); record = self.records()[0]; record['storeVersion'] = True
        self.assertEqual(self.call('mvp.edit', {'records': [record]})['error']['code'], 'STALE')
        self.assertEqual(self.gateway.handle({'protocolVersion': True, 'requestId': 'bool', 'command': 'mvp.health', 'payload': {}})['error']['code'], 'VALIDATION')

    def test_empty_user_column_definition_and_rows_save_atomically(self):
        self.save([observation()]); record = self.records()[0]; before = self.call('mvp.settings.read')['result']
        record['fields']['blank'] = '변경'; record['userValues']['빈 사용자 열'] = ''
        result = self.call('mvp.edit', {'records': [record], 'userColumns': {'stage': 'receipt', 'keys': ['빈 사용자 열'], 'settingsStoreVersion': before['storeVersion']}})
        self.assertNotIn('error', result); self.assertIsInstance(result['result'], list); self.assertEqual(result['result'][0]['storeVersion'], 2)
        settings = self.call('mvp.settings.read')['result']
        self.assertEqual(settings['storeVersion'], before['storeVersion'] + 1); self.assertEqual(settings['settings']['userColumns']['receipt'], ['빈 사용자 열'])
        expected = copy.deepcopy(before['settings']); expected['userColumns']['receipt'] = ['빈 사용자 열']; self.assertEqual(settings['settings'], expected)
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.call('mvp.settings.read')['result']['settings']['userColumns']['receipt'], ['빈 사용자 열'])
        self.assertEqual(self.records()[0]['fields']['blank'], '변경'); self.assertEqual(self.records()[0]['userValues']['빈 사용자 열'], '')

    def test_zero_rows_column_definition_saves_and_can_clear_keys(self):
        self.assertEqual(self.call('mvp.edit', {'records': []})['error']['code'], 'VALIDATION')
        before = self.call('mvp.settings.read')['result']
        result = self.call('mvp.edit', {'records': [], 'userColumns': {'stage': 'bid', 'keys': ['빈 열'], 'settingsStoreVersion': before['storeVersion']}})
        self.assertEqual(result['result'], []); self.assertEqual(self.records('bid'), [])
        settings = self.call('mvp.settings.read')['result']; self.assertEqual(settings['settings']['userColumns']['bid'], ['빈 열'])
        result = self.call('mvp.edit', {'records': [], 'userColumns': {'stage': 'bid', 'keys': [], 'settingsStoreVersion': settings['storeVersion']}})
        self.assertEqual(result['result'], []); self.assertEqual(self.call('mvp.settings.read')['result']['settings']['userColumns']['bid'], [])

    def test_stale_column_metadata_rolls_back_row_changes(self):
        self.save([observation()]); record = self.records()[0]; before = self.call('mvp.settings.read')['result']
        changed = copy.deepcopy(record); changed['fields']['blank'] = '되돌려야 함'
        result = self.call('mvp.edit', {'records': [changed], 'userColumns': {'stage': 'receipt', 'keys': ['실패 열'], 'settingsStoreVersion': before['storeVersion'] - 1}})
        self.assertEqual(result['error']['code'], 'STALE'); self.assertEqual(self.records()[0], record); self.assertEqual(self.call('mvp.settings.read')['result'], before)

    def test_stale_row_rolls_back_metadata_and_prior_row(self):
        self.save([observation(number='A'), observation(number='B')]); before_rows = self.records(); before = self.call('mvp.settings.read')['result']
        changed = copy.deepcopy(before_rows); changed[0]['fields']['blank'] = '첫 행'; changed[1]['storeVersion'] = -1
        result = self.call('mvp.edit', {'records': changed, 'userColumns': {'stage': 'receipt', 'keys': ['실패 열'], 'settingsStoreVersion': before['storeVersion']}})
        self.assertEqual(result['error']['code'], 'STALE'); self.assertEqual(self.records(), before_rows); self.assertEqual(self.call('mvp.settings.read')['result'], before)

    def test_column_metadata_rejects_mixed_stage_and_invalid_types(self):
        self.save([observation(), observation('contract')]); before = self.call('mvp.settings.read')['result']; receipt = self.records()[0]; contract = self.records('contract')[0]
        changed = copy.deepcopy(receipt); changed['fields']['blank'] = '첫 행'
        metadata = {'stage': 'receipt', 'keys': ['사용자 열'], 'settingsStoreVersion': before['storeVersion']}
        result = self.call('mvp.edit', {'records': [changed, contract], 'userColumns': metadata})
        self.assertEqual(result['error']['code'], 'VALIDATION'); self.assertEqual(self.records()[0], receipt); self.assertEqual(self.call('mvp.settings.read')['result'], before)
        for field, invalid in [('stage', 'unknown'), ('keys', ['중복', '중복']), ('keys', [False]), ('keys', [str(index) for index in range(501)]), ('settingsStoreVersion', True), ('settingsStoreVersion', '1')]:
            candidate = {**metadata, field: invalid}
            self.assertEqual(self.call('mvp.edit', {'records': [], 'userColumns': candidate})['error']['code'], 'VALIDATION')
        self.assertEqual(self.call('mvp.edit', {'records': [], 'userColumns': None})['error']['code'], 'VALIDATION')

    def test_settings_column_definitions_optional_validation_and_version_types(self):
        before = self.call('mvp.settings.read')['result']
        for columns in [{'receipt': ['duplicate', 'duplicate']}, {'contract': [0]}, {'unknown': []}, {'bid': [str(index) for index in range(501)]}, []]:
            changed = copy.deepcopy(before); changed['settings']['userColumns'] = columns
            self.assertEqual(self.call('mvp.settings.save', changed)['error']['code'], 'VALIDATION')
        changed = copy.deepcopy(before); changed['storeVersion'] = True
        self.assertEqual(self.call('mvp.settings.save', changed)['error']['code'], 'VALIDATION')
        changed = copy.deepcopy(before); del changed['settings']['userColumns']; changed['settings']['dictionary'] = {'keys': {}, 'values': {}}
        self.assertNotIn('error', self.call('mvp.settings.save', changed))

    def test_atomic_column_save_retry_does_not_increment_versions_twice(self):
        self.save([observation()]); record = self.records()[0]; before = self.call('mvp.settings.read')['result']
        payload = {'records': [record], 'userColumns': {'stage': 'receipt', 'keys': ['빈 열'], 'settingsStoreVersion': before['storeVersion']}}
        first = self.call('mvp.edit', payload, 'column-retry'); second = self.call('mvp.edit', payload, 'column-retry')
        self.assertEqual(first, second); self.assertEqual(self.records()[0]['storeVersion'], 2); self.assertEqual(self.call('mvp.settings.read')['result']['storeVersion'], before['storeVersion'] + 1)

    def test_source_and_user_same_names_remain_separate_owners(self):
        source = observation('contract'); source['fields']['종결'] = 'source-value'; source['fields']['종결금액'] = 'source amount'; source = source_capture(source)
        self.save([source]); record = self.records('contract')[0]
        record['userValues']['종결'] = False; record['userValues']['종결금액'] = '0'; record['userValues']['quantity'] = False
        self.assertNotIn('error', self.call('mvp.edit', {'records': [record]})); self.save([source])
        saved = self.records('contract')[0]
        self.assertEqual(saved['rawJson'], source['rawJson']); self.assertEqual(saved['fields']['종결'], 'source-value'); self.assertEqual(saved['fields']['종결금액'], 'source amount')
        self.assertIs(saved['userValues']['종결'], False); self.assertEqual(saved['userValues']['종결금액'], '0'); self.assertIs(saved['userValues']['quantity'], False)
        self.assertEqual(saved['fields']['quantity'], 0); self.assertIs(type(saved['fields']['quantity']), int)

    @unittest.skipUnless((Path(__file__).resolve().parents[2] / 'dist/mvp-host/feedback/G2BHelperHost/G2BHelperHost.exe').exists(), 'Fresh packaged host not built')
    def test_packaged_executable_unicode_path_restart_and_retry(self):
        original = Path(__file__).resolve().parents[2] / 'dist/mvp-host/feedback/G2BHelperHost'
        runtime = Path(self.directory.name) / '실행 파일 한글 경로'
        shutil.copytree(original, runtime)
        database = Path(self.directory.name) / '실제 프로세스 DB.sqlite3'
        exe = runtime / 'G2BHelperHost.exe'
        source = observation('contract'); source['fields']['large'] = '한글🙂' * 100000
        source = source_capture(source)
        def send(process, command, payload, request_id):
            body = json.dumps({'protocolVersion': 1, 'requestId': request_id, 'command': command, 'payload': payload}, ensure_ascii=False).encode('utf-8')
            process.stdin.write(struct.pack('<I', len(body)) + body); process.stdin.flush()
            parts = []
            while True:
                header = process.stdout.read(4); self.assertEqual(len(header), 4)
                size = struct.unpack('<I', header)[0]; self.assertLess(size, 1000000)
                frame = json.loads(process.stdout.read(size))
                if 'chunk' not in frame:
                    return frame
                parts.append(frame['chunk']['text'])
                if len(parts) == frame['chunk']['total']:
                    return json.loads(''.join(parts))
        def start_process():
            return subprocess.Popen([str(exe), '--database', str(database)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        process = start_process()
        try:
            self.assertTrue(send(process, 'mvp.health', {}, 'health')['result']['connected'])
            preview = send(process, 'mvp.preview', {'observations': [source]}, 'preview')['result']
            payload = {'observations': [source], 'token': preview['token'], 'decisions': []}
            saved = send(process, 'mvp.apply', payload, 'save')
            self.assertEqual(saved, send(process, 'mvp.apply', payload, 'save'))
            self.assertEqual(saved['result']['records'][0]['fields']['large'], source['fields']['large'])
            settings = send(process, 'mvp.settings.read', {}, 'settings')['result']
            columns = {'records': [], 'userColumns': {'stage': 'contract', 'keys': ['빈 사용자 열'], 'settingsStoreVersion': settings['storeVersion']}}
            column_saved = send(process, 'mvp.edit', columns, 'columns')
            self.assertEqual(column_saved.get('result'), [], column_saved)
            self.assertEqual(column_saved, send(process, 'mvp.edit', columns, 'columns'))
        finally:
            process.stdin.close(); process.wait(timeout=20); process.stdout.close(); process.stderr.close()
        self.assertEqual(process.returncode, 0)
        process = start_process()
        try:
            response = send(process, 'mvp.records', {'stage': 'contract'}, 'restart')
            self.assertEqual(response['result'][0]['identity'], ['TEST-001', '01'])
            self.assertEqual(response['result'][0]['storeVersion'], 1)
            self.assertEqual(response['result'][0]['rawJson'], source['rawJson'])
            settings = send(process, 'mvp.settings.read', {}, 'restart-settings')['result']
            self.assertEqual(settings['settings']['userColumns']['contract'], ['빈 사용자 열'])
            record = response['result'][0]
            move = {'records': [{'recordId': record['recordId'], 'storeVersion': record['storeVersion']}]}
            moved = send(process, 'mvp.trash', move, 'exe-trash')
            self.assertEqual(moved.get('result'), {'count': 1}, moved)
            self.assertEqual(moved, send(process, 'mvp.trash', move, 'exe-trash'))
            self.assertEqual(send(process, 'mvp.records', {'stage': 'contract'}, 'exe-active')['result'], [])
            trashed = send(process, 'mvp.records', {'stage': 'contract', 'trashed': True}, 'exe-trash-list')['result'][0]
            self.assertEqual(trashed['rawJson'], source['rawJson'])
            self.assertEqual(trashed['userValues'], record['userValues'])
            restored = send(process, 'mvp.restore', {'records': [{'recordId': record['recordId'], 'storeVersion': trashed['storeVersion']}]}, 'exe-restore')
            self.assertEqual(restored.get('result'), {'count': 1}, restored)
            current = send(process, 'mvp.records', {'stage': 'contract'}, 'exe-restored')['result'][0]
            self.assertEqual(current['fields']['quantity'], 0)
            settings['settings']['columnLocks'] = {'quantity': True}
            settings['settings']['hideEmptyTables'] = True
            locked = send(process, 'mvp.settings.save', {'settings': settings['settings'], 'storeVersion': settings['storeVersion']}, 'exe-lock')
            self.assertIn('result', locked, locked)
            changed = copy.deepcopy(current['fields']); changed['quantity'] = 1
            blocked = send(process, 'mvp.edit', {'records': [{'recordId': current['recordId'], 'storeVersion': current['storeVersion'], 'fields': changed, 'userValues': current['userValues']}]}, 'exe-locked-edit')
            self.assertIn('error', blocked, blocked)
            self.assertEqual(send(process, 'mvp.records', {'stage': 'contract'}, 'exe-unchanged')['result'][0]['fields']['quantity'], 0)
        finally:
            process.stdin.close(); process.wait(timeout=20); process.stdout.close(); process.stderr.close()

if __name__ == '__main__':
    unittest.main()

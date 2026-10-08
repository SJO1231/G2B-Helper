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
from pce.mvp import MvpGateway, record_id, IDENTITIES, SCHEMA_VERSION
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

    def save(self, observations, request_id=None):
        observations = [source_capture(value) for value in observations]
        preview = self.call('mvp.preview', {'observations': observations})['result']
        result = self.call('mvp.apply', {'observations': observations, 'token': preview['token']}, request_id)
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
        self.assertEqual(self.call('mvp.apply', {'observations': [observation('contract')], 'token': ''})['error']['code'], 'TRASHED')
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
        for settings in [{'hideEmptyTables': 1}, {'screenRules': None}, {'screenRules': [rule, rule]}, {'screenRules': [{**rule, 'stage': 'bad'}]}, {'screenRules': [{**rule, 'depth3': False}]}, {'screenRules': [{**rule, 'urlPattern': ''}]}]:
            self.assertIn('error', self.update_settings(**settings))
        saved = self.update_settings(hideEmptyTables=True, columnTypes={'quantity': 'money'}, columnLocks={'quantity': True}, screenRules=[rule])['result']
        self.assertTrue(saved['settings']['hideEmptyTables'])
        self.assertNotIn('columnLocks', saved['settings'])  # column locks were withdrawn (#42); an old window's value is dropped
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

    def test_edit_keeps_zero_false_user_values_and_rejects_source_changes_atomically(self):
        # Source values are read only; only user columns are edited (user, 2026-10-09, #42).
        self.save([observation(number='A'), observation(number='B')])
        records = self.records()
        for record in records:
            record['userValues'] = {'zero': 0, 'flag': False}
        records = self.call('mvp.edit', {'records': records})['result']
        self.assertEqual([(r['userValues']['zero'], r['userValues']['flag']) for r in self.records()], [(0, False), (0, False)])
        for field, value in [('quantity', False), ('checked', 0), ('blank', '고침'), ('ctrtDmndRcptNo', 'OTHER')]:
            changes = copy.deepcopy(records)
            changes[0]['userValues']['메모'] = 'first change'
            changes[1]['fields'][field] = value
            self.assertEqual(self.call('mvp.edit', {'records': changes})['error']['code'], 'READ_ONLY')
            self.assertEqual(self.records(), records)
        added = copy.deepcopy(records[0]); added['fields']['new'] = 1
        self.assertEqual(self.call('mvp.edit', {'records': [added]})['error']['code'], 'READ_ONLY')
        unchanged = copy.deepcopy(records[0]); unchanged['userValues']['메모'] = '그대로'
        without = copy.deepcopy(records[1]); del without['fields']; without['userValues']['메모'] = '원천 없이'
        saved = self.call('mvp.edit', {'records': [unchanged, without]})['result']
        self.assertEqual([r['fields'] for r in saved], [r['fields'] for r in records])
        self.assertEqual([r['userValues']['메모'] for r in self.records()], ['그대로', '원천 없이'])

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

    def test_collection_applies_differing_screen_values_and_lists_them(self):
        # The screen's values are applied without a question (user, 2026-10-09, #43); the replaced cells are listed.
        self.save([observation()]); updated = observation(); updated['fields'].update(quantity=3, unitPrice='400.01', blank='보완')
        preview = self.call('mvp.preview', {'observations': [source_capture(updated)]})['result']
        self.assertEqual(sorted((c['field'], c['previous'], c['incoming']) for c in preview['changes']), [('quantity', 0, 3), ('unitPrice', '35608652.5', '400.01')])
        self.assertEqual(preview['items'][0]['status'], 'changed')
        applied = self.call('mvp.apply', {'observations': [source_capture(updated)], 'token': preview['token']})['result']
        self.assertEqual(applied['changes'], preview['changes'])
        fields = self.records()[0]['fields']; self.assertEqual((fields['quantity'], fields['unitPrice'], fields['blank']), (3, '400.01', '보완'))

    def test_preview_reports_each_item_status(self):
        self.save([observation(number='A'), observation(number='B'), observation(number='C')])
        supplemented = observation(number='B'); supplemented['fields']['blank'] = '보완'
        changed = observation(number='C'); changed['fields']['quantity'] = 7
        sources = [source_capture(value) for value in (observation(number='A'), supplemented, changed, observation(number='D'))]
        items = self.call('mvp.preview', {'observations': sources})['result']['items']
        self.assertEqual([item['status'] for item in items], ['identical', 'supplemented', 'changed', 'inserted'])
        self.assertEqual([item['recordId'] for item in items], [record_id(value) for value in sources])

    def contract_with_items(self, rows, number='TEST-001'):
        source = observation('contract', number)
        source['children'] = [{'key': 'items', 'label': '물품', 'kind': 'items', 'rows': rows}]
        return source

    def test_items_add_no_summary_columns(self):
        # The representative/total columns were withdrawn (user, 2026-10-09, #41).
        self.save([self.contract_with_items([{'ctrtItemSqno': '1', 'ctrtItemNm': '하나', 'ctrtQty': '2', 'ctrtUntVal': '개', 'ctrtAmt': '100'}])])
        record = self.records('contract')[0]
        self.assertEqual(record['userValues'], {'종결': False, '지정일': '', '종결금액': '', '선금보증기한': '', '선금보증금액': ''})
        self.assertNotIn('summaryValues', record)

    def test_withdrawn_summary_values_are_removed_once(self):
        self.save([self.contract_with_items([{'ctrtItemSqno': '1', 'ctrtItemNm': '하나', 'ctrtAmt': '100'}]), observation('contract', 'PLAIN')])
        stored = {r['identity'][0]: r for r in self.records('contract')}
        old = stored['TEST-001']
        old['userValues'].update({'대표 품명': '하나', '합계 금액': '100', '품목 수': '1', '메모': '유지'}); old['summaryValues'] = {'대표 품명': '하나', '합계 금액': '100', '품목 수': '1'}
        self.gateway.save(old)
        plain = stored['PLAIN']; self.gateway.save(plain)
        settings = self.call('mvp.settings.read')['result']
        settings['settings'].update(userColumns={'contract': ['메모', '대표 품명', '합계 금액']}, columnTypes={'합계 금액': 'money', '합계 수량': 'text', 'ctrtAmt': 'money'})
        self.assertNotIn('error', self.call('mvp.settings.save', settings))
        self.gateway.db.execute('PRAGMA user_version=0')  # a database written before #41
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        after = {r['identity'][0]: r for r in self.records('contract')}
        self.assertEqual(after['TEST-001']['userValues'], {**{k: v for k, v in old['userValues'].items() if k not in ('대표 품명', '합계 금액', '품목 수')}})
        self.assertNotIn('summaryValues', after['TEST-001'])
        self.assertEqual(after['TEST-001']['storeVersion'], old['storeVersion'] + 1)
        self.assertEqual(after['PLAIN'], plain)  # untouched records keep their version
        saved = self.call('mvp.settings.read')['result']
        self.assertEqual(saved['settings']['userColumns'], {'contract': ['메모']})
        self.assertEqual(saved['settings']['columnTypes'], {'합계 수량': 'text', 'ctrtAmt': 'money'})  # only the old default types go
        self.assertEqual(saved['storeVersion'], settings['storeVersion'] + 2)
        self.assertEqual(self.gateway.db.execute('PRAGMA user_version').fetchone()[0], SCHEMA_VERSION)
        # A user column made later with one of the old names is kept on the next start.
        record = after['TEST-001']; record['userValues']['합계 금액'] = '사용자 값'
        self.assertNotIn('error', self.call('mvp.edit', {'records': [record]}))
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual({r['identity'][0]: r for r in self.records('contract')}['TEST-001']['userValues']['합계 금액'], '사용자 값')

    def test_new_order_takes_user_columns_from_the_previous_order(self):
        self.save([observation(order='00'), observation(order='01')])
        first = {r['identity'][1]: r for r in self.records()}
        first['00']['userValues'] = {'담당': '이전 담당'}; first['01']['userValues'] = {'담당': '최근 담당', '메모': '유지'}
        self.assertNotIn('error', self.call('mvp.edit', {'records': [first['00'], first['01']]}))
        new = source_capture(observation(order='02')); new['fields']['quantity'] = 9
        new['rawJson'] = source_capture(new)['rawJson']
        preview = self.call('mvp.preview', {'observations': [new]})['result']
        self.assertEqual(preview['items'][0], {'recordId': record_id(new), 'status': 'inserted', 'carriedFrom': '01'})
        self.assertNotIn('error', self.call('mvp.apply', {'observations': [new], 'token': preview['token']}))
        records = {r['identity'][1]: r for r in self.records()}
        self.assertEqual(records['02']['userValues'], {'담당': '최근 담당', '메모': '유지'})
        self.assertEqual(records['02']['fields']['quantity'], 9)
        self.assertEqual(records['01']['userValues'], {'담당': '최근 담당', '메모': '유지'})  # the previous order stays

    def test_previous_order_rules_trash_and_defaults(self):
        source = self.contract_with_items([{'ctrtItemSqno': '1', 'ctrtItemNm': '앞 차수', 'ctrtQty': '1', 'ctrtAmt': '10'}])
        source['identity'][1] = '00'; source['fields']['ctrtChgOrd'] = '00'
        self.save([source])
        later = self.contract_with_items([{'ctrtItemSqno': '1', 'ctrtItemNm': '새 차수', 'ctrtQty': '2', 'ctrtAmt': '20'}])
        later['identity'][1] = '01'; later['fields']['ctrtChgOrd'] = '01'
        preview = self.call('mvp.preview', {'observations': [source_capture(later)]})['result']
        self.assertNotIn('carriedFrom', preview['items'][0])  # only the contract defaults were there
        self.save([later])
        values = {r['identity'][1]: r['userValues'] for r in self.records('contract')}
        self.assertEqual(values['01'], values['00'])  # the contract defaults only
        self.assertEqual(self.gateway.previous_order('contract', ['TEST-001', '02'])['identity'], ['TEST-001', '01'])
        self.assertIsNone(self.gateway.previous_order('contract', ['TEST-001', '00']))
        latest = {r['identity'][1]: r for r in self.records('contract')}['01']
        self.call('mvp.trash', {'records': [{'recordId': latest['recordId'], 'storeVersion': latest['storeVersion']}]})
        self.assertEqual(self.gateway.previous_order('contract', ['TEST-001', '02'])['identity'], ['TEST-001', '00'])  # the trash is skipped

    def test_previous_order_compares_numbers_as_numbers(self):
        self.save([observation(order='9'), observation(order='10')])
        self.assertEqual(self.gateway.previous_order('receipt', ['TEST-001', '11'])['identity'][1], '10')
        self.assertEqual(self.gateway.previous_order('receipt', ['TEST-001', '10'])['identity'][1], '9')
        self.assertEqual(self.gateway.previous_order('receipt', ['TEST-001', '²'])['identity'][1], '10')  # text orders follow numbers, no error

    def test_new_order_carries_user_columns_only(self):
        source = self.contract_with_items([{'ctrtItemSqno': '1', 'ctrtItemNm': '앞 차수', 'ctrtQty': '1', 'ctrtAmt': '10'}])
        source['identity'][1] = '00'; source['fields']['ctrtChgOrd'] = '00'
        self.save([source]); record = self.records('contract')[0]
        record['userValues'].update({'메모': '이어받음', '종결금액': '5'})
        self.assertNotIn('error', self.call('mvp.edit', {'records': [record]}))
        later = self.contract_with_items([{'ctrtItemSqno': '1', 'ctrtItemNm': '새 품목', 'ctrtQty': '3', 'ctrtAmt': '30'}])
        later['identity'][1] = '01'; later['fields']['ctrtChgOrd'] = '01'
        preview = self.call('mvp.preview', {'observations': [source_capture(later)]})['result']
        self.assertEqual(preview['items'][0].get('carriedFrom'), '00')
        self.save([later])
        values = {r['identity'][1]: r['userValues'] for r in self.records('contract')}['01']
        self.assertEqual(values, {'종결': False, '지정일': '', '종결금액': '5', '선금보증기한': '', '선금보증금액': '', '메모': '이어받음'})

    def test_previous_order_change_between_preview_and_apply_is_stale(self):
        self.save([observation(order='00')])
        new = source_capture(observation(order='01'))
        preview = self.call('mvp.preview', {'observations': [new]})['result']
        earlier = self.records()[0]; earlier['userValues'] = {'메모': '그사이 고침'}
        self.assertNotIn('error', self.call('mvp.edit', {'records': [earlier]}))
        self.assertEqual(self.call('mvp.apply', {'observations': [new], 'token': preview['token']})['error']['code'], 'STALE')

    def test_withdrawn_corrections_and_locks_are_removed_once(self):
        self.save([observation(number='A'), observation(number='B'), observation(number='C')])
        stored = {r['identity'][0]: r for r in self.records()}
        corrected = stored['A']; corrected['sourceFields'] = copy.deepcopy(corrected['fields']); corrected['overrides'] = {'unitPrice': '수기 단가'}; corrected['fields']['unitPrice'] = '수기 단가'
        self.gateway.save(corrected)
        clean = stored['B']; clean['sourceFields'] = copy.deepcopy(clean['fields']); clean['overrides'] = {}
        self.gateway.save(clean)
        plain = stored['C']
        self.call('mvp.trash', {'records': [{'recordId': clean['recordId'], 'storeVersion': clean['storeVersion']}]})
        settings = self.call('mvp.settings.read')['result']
        self.gateway.db.execute('UPDATE mvp_settings SET payload=? WHERE singleton=1', (json.dumps({**settings['settings'], 'columnLocks': {'unitPrice': True}}, ensure_ascii=False),))
        self.gateway.db.execute('PRAGMA user_version=1')  # a database written before #42
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        after = {r['identity'][0]: r for r in self.records()}
        self.assertEqual(after['A']['fields']['unitPrice'], '35608652.5')  # the collected value (당초값) comes back
        self.assertEqual(after['A']['storeVersion'], corrected['storeVersion'] + 1)
        self.assertFalse({'sourceFields', 'overrides'} & set(after['A']))
        trashed = self.call('mvp.records', {'stage': 'receipt', 'trashed': True})['result'][0]
        self.assertFalse({'sourceFields', 'overrides'} & set(trashed)); self.assertTrue(trashed['deletedAt'])
        self.assertEqual(after['C'], plain)
        read = self.call('mvp.settings.read')['result']
        self.assertNotIn('columnLocks', read['settings']); self.assertEqual(read['storeVersion'], settings['storeVersion'] + 1)
        self.assertEqual(self.gateway.db.execute('PRAGMA user_version').fetchone()[0], SCHEMA_VERSION)
        self.assertEqual(self.call('mvp.corrections.reset', {'records': []})['error']['code'], 'COMMAND')

    def test_new_records_keep_no_correction_copies(self):
        self.save([observation()]); changed = observation(); changed['fields']['unitPrice'] = '1'
        self.save([changed])
        record = self.records()[0]
        self.assertEqual(record['fields']['unitPrice'], '1'); self.assertFalse({'sourceFields', 'overrides'} & set(record))

    def test_false_is_not_zero(self):
        self.save([observation()]); changed = observation(); changed['fields']['quantity'] = False
        self.assertEqual(len(self.call('mvp.preview', {'observations': [source_capture(changed)]})['result']['changes']), 1)

    def test_stale_comparison_rejected(self):
        source = observation(); self.save([source]); updated = observation(); updated['fields']['blank'] = '보완'
        updated = source_capture(updated)
        preview = self.call('mvp.preview', {'observations': [updated]})['result']
        record = self.records()[0]; record['userValues']['메모'] = '다른 창'
        self.call('mvp.edit', {'records': [record]})
        result = self.call('mvp.apply', {'observations': [updated], 'token': preview['token']})
        self.assertEqual(result['error']['code'], 'STALE')

    def test_different_orders_and_stages(self):
        self.save([observation(order='00'), observation(order='01'), observation('contract')])
        self.assertEqual(len(self.records()), 2); self.assertEqual(len(self.records('contract')), 1)

    def test_validation_rolls_back_entire_batch(self):
        invalid = observation(number='INVALID'); invalid['source']['url'] = 'https://g2b.go.kr.evil.example/'
        self.assertIn('error', self.save([observation(), invalid]) if False else self.call('mvp.apply', {'observations': [observation(), invalid], 'token': ''}))
        self.assertEqual(self.records(), [])

    def test_edit_failure_rolls_back_first_row(self):
        self.save([observation(number='A'), observation(number='B')]); rows = self.records()
        rows[0]['userValues']['메모'] = '첫 행'; rows[1]['storeVersion'] = -1
        self.assertEqual(self.call('mvp.edit', {'records': rows})['error']['code'], 'STALE')
        self.assertNotIn('메모', self.records()[0]['userValues'])

    def test_request_replay_once_and_changed_id_rejected(self):
        source = observation(); preview = self.call('mvp.preview', {'observations': [source]})['result']
        payload = {'observations': [source], 'token': preview['token']}
        first = self.call('mvp.apply', payload, 'retry'); second = self.call('mvp.apply', payload, 'retry')
        self.assertEqual(first, second); self.assertEqual(self.records()[0]['storeVersion'], 1)
        payload['token'] = 'changed'; self.assertEqual(self.call('mvp.apply', payload, 'retry')['error']['code'], 'REQUEST_ID')

    def test_restart_requery_unicode_path(self):
        self.save([observation()]); self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.records()[0]['identity'], ['TEST-001', '01'])

    def test_child_table_is_replaced_and_an_empty_screen_table_keeps_rows(self):
        # A differing child table is replaced as a whole; an empty screen table keeps the stored rows (user, 2026-10-09, #43).
        rows = [{'ctrtItemSqno': '01', 'price': '35608652.5'}, {'ctrtItemSqno': '02', 'price': '0'}, {'ctrtItemSqno': '03', 'price': '2.5'}]
        source = observation('contract'); source['children'] = [{'key': 'items', 'label': '물품', 'kind': 'items', 'rows': rows}, {'key': 'other', 'label': '기타', 'kind': 'other', 'rows': [{'a': 1}]}]
        self.save([source]); update = copy.deepcopy(source); update['children'] = [{'key': 'items', 'label': '물품', 'kind': 'items', 'rows': [{'ctrtItemSqno': '01', 'extra': False}]}, {'key': 'new', 'label': '새 표', 'kind': 'other', 'rows': [{'b': 2}]}]
        preview = self.call('mvp.preview', {'observations': [source_capture(update)]})['result']
        self.assertEqual([(c['field'], c['previous'], c['incoming']) for c in preview['changes']], [('["children","물품"]', 3, 1)])
        self.save([update]); children = {child['key']: child['rows'] for child in self.records('contract')[0]['children']}
        self.assertEqual(children, {'물품': [{'ctrtItemSqno': '01', 'extra': False}], 'other': [{'a': 1}], 'new': [{'b': 2}]})  # a table the screen did not send stays
        update['children'][0]['rows'] = []; self.save([update]); self.assertEqual(self.records('contract')[0]['children'][0]['rows'], [{'ctrtItemSqno': '01', 'extra': False}])
        filled = observation('contract', 'FILL'); filled['children'] = [{'key': 'empty', 'label': '빈 표', 'kind': 'other', 'rows': []}]
        self.save([filled]); filled['children'][0]['rows'] = [{'c': 3}]
        preview = self.call('mvp.preview', {'observations': [source_capture(filled)]})['result']
        self.assertEqual((preview['changes'], preview['items'][0]['status']), ([], 'supplemented'))  # filling an empty stored table is not a change

    def test_changed_child_row_replaces_the_table(self):
        source = observation('receipt'); source['children'] = [{'key': 'items', 'label': '물품', 'kind': 'items', 'rows': [{'ctrtDmndRcptItemSqno': '001', 'qty': 1}]}]
        self.save([source]); updated = copy.deepcopy(source); updated['children'][0]['rows'][0]['qty'] = 2
        self.save([updated])
        self.assertEqual(self.records()[0]['children'][0]['rows'], [{'ctrtDmndRcptItemSqno': '001', 'qty': 2}])

    def test_child_tables_are_named_and_attachments_and_second_contacts_dropped(self):
        # Names instead of screen IDs; attachments and every bid contact table after the first are not kept (user, 2026-10-09, #44).
        table = lambda key, kind='other', rows=None: {'key': key, 'label': key, 'kind': kind, 'rows': rows if rows is not None else [{'a': 1}]}
        bid = observation('bid'); bid['children'] = [table('mf_t_itemTabs1_body_wframe6_grdAliasDmTtl06List', rows=[{'deptNm': '부서', 'picNm': '이름'}, {'deptNm': '둘째', 'picNm': '둘째'}]),
            table('mf_t_itemTabs2_body_wframe6_grdAliasDmTtl06List', rows=[]), table('mf_t_wframe7_grdAliasDmTtl07LeftList', 'qualification'),
            table('mf_t_wframe10_grdAliasDmTtl10List', 'qualification', []), table('wq_uuid_1_grdFile'), table('mf_t_wframe1_grdAliasDmTtl01List', 'items')]
        receipt = observation('receipt'); receipt['children'] = [table('mf_c_wfBaseInfo_gvCtrtDmndDmstPic'), table('mf_c_wfBaseInfo_gvOderPlan'), table('mf_c_wfBaseInfo_gridView3', rows=[]),
            table('mf_c_gvDmndItem', 'items'), table('mf_c_gridViewExcel', 'items', [{'b': 2}]), table('wq_uuid_2_grdFile')]
        contract = observation('contract'); contract['children'] = [table('mf_c_grdEtpsLst'), table('mf_c_grdSldrGrnteEtpsLst', rows=[]), table('plain')]
        self.save([bid]); self.save([receipt]); self.save([contract])
        names = lambda stage: [(c['key'], c['label']) for c in self.records(stage)[0]['children']]
        self.assertEqual(names('bid'), [('수요기관', '수요기관'), ('자격제한', '자격제한'), ('grdAliasDmTtl10List', 'grdAliasDmTtl10List'), ('물품', '물품')])
        self.assertEqual(self.records('bid')[0]['children'][0]['rows'], [{'deptNm': '부서', 'picNm': '이름'}, {'deptNm': '둘째', 'picNm': '둘째'}])
        self.assertNotIn('deptNm', self.records('bid')[0]['fields'])
        self.assertEqual([key for key, _ in names('receipt')], ['수요기관', '발주계획', 'gridView3', '물품', '물품 2'])
        self.assertEqual([key for key, _ in names('contract')], ['업체', 'grdSldrGrnteEtpsLst', 'plain'])
        self.assertIn('grdFile', self.records()[0]['rawJson'])  # the raw JSON keeps the attachment table
        # A recollection compares the named tables: the changed item table is replaced.
        receipt['children'][3]['rows'] = [{'a': 9}]; self.save([receipt])
        self.assertEqual({c['key']: c['rows'] for c in self.records()[0]['children']}['물품'], [{'a': 9}])

    def test_stored_child_tables_are_named_once(self):
        self.save([observation('contract')]); record = self.records('contract')[0]
        record['children'] = [{'key': 'mf_c_grdCtrtLis', 'label': 'mf_c_grdCtrtLis', 'kind': 'items', 'rows': [{'x': 1}]},
                              {'key': 'wq_uuid_3_grdFile', 'label': 'wq_uuid_3_grdFile', 'kind': 'other', 'rows': [{'f': 1}]}]
        self.gateway.save(record); self.gateway.db.execute('PRAGMA user_version=2')  # a database written before #44
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        after = self.records('contract')[0]
        self.assertEqual((after['children'], after['storeVersion']), ([{'key': '물품', 'label': '물품', 'kind': 'items', 'rows': [{'x': 1}]}], record['storeVersion'] + 1))
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.records('contract')[0]['storeVersion'], after['storeVersion'])

    def test_helper_columns_are_made_when_read_and_never_stored(self):
        # The 업종제한 sentence and the 수요기관 contact values (user, 2026-10-09, #45).
        bid = observation('bid'); bid['fields']['picNm'] = '메인 이름'  # a main value of the same key wins
        bid['children'] = [
            {'key': 'mf_t_itemTabs1_body_wframe6_grdAliasDmTtl06List', 'label': 'x', 'kind': 'other', 'rows': [{'CHK': False, 'deptNm': '부서', 'picNm': '이름', 'tlphNo': '000', 'eml': 'a@x', 'dmstPicId': 'id'}, {'deptNm': '둘째'}]},
            {'key': 'mf_t_wframe7_grdAliasDmTtl07LeftList', 'label': 'x', 'kind': 'qualification', 'rows': [
                {'lmtGupSqno': '1', 'bidLmtUntyNm': '업종A', 'bidLmtUntyCd': '0001'}, {'lmtGupSqno': '2', 'bidLmtUntyNm': '업종B', 'bidLmtUntyCd': '0002'},
                {'lmtGupSqno': '2', 'bidLmtUntyNm': '업종C', 'bidLmtUntyCd': '0003'}, {'lmtGupSqno': '2', 'bidLmtUntyNm': '업종D', 'bidLmtUntyCd': ''}]}]
        self.save([bid]); record = self.records('bid')[0]
        self.assertEqual(record['computed'], {'업종제한': '[업종A(0001)] 업종 또는 [업종B(0002)와 업종C(0003)와 업종D] 업종', 'deptNm': '부서', 'tlphNo': '000', 'eml': 'a@x', 'dmstPicId': 'id'})
        self.assertNotIn('computed', json.loads(self.gateway.db.execute("SELECT payload FROM mvp_records WHERE stage='bid'").fetchone()[0]))
        receipt = observation('receipt'); receipt['children'] = [{'key': 'mf_c_gvCtrtDmndDmstPic', 'label': 'x', 'kind': 'other', 'rows': [{'deptNm': '접수 부서', 'picNm': '이름', 'tlphNo': '1', 'eml': 'r@x', 'dmstPicId': 'rid'}]}]
        contract = observation('contract'); contract['children'] = [{'key': 'mf_c_grdEtpsLst', 'label': 'x', 'kind': 'other', 'rows': [{'deptNm': '업체 부서'}]}]
        self.save([receipt]); self.save([contract])
        self.assertEqual((self.records()[0]['computed'], self.records('contract')[0].get('computed')), ({'deptNm': '접수 부서', 'eml': 'r@x', 'dmstPicId': 'rid'}, None))  # nothing to show, no key
        record['userValues']['메모'] = '편집'; saved = self.call('mvp.edit', {'records': [record]})['result'][0]
        self.assertNotIn('computed', saved)  # an edit sent with the read values stores none of them

    def test_limit_groups_follow_their_first_appearance(self):
        from pce.mvp import computed_values
        rows = [{'lmtGupSqno': '1', 'bidLmtUntyNm': 'A', 'bidLmtUntyCd': '1'}, {'lmtGupSqno': '2', 'bidLmtUntyNm': 'B', 'bidLmtUntyCd': '2'}, {'lmtGupSqno': '1', 'bidLmtUntyNm': 'C', 'bidLmtUntyCd': '3'}]
        record = {'stage': 'bid', 'fields': {}, 'children': [{'key': '자격제한', 'rows': rows}]}
        self.assertEqual(computed_values(record), {'업종제한': '[A(1)와 C(3)] 업종 또는 [B(2)] 업종'})
        self.assertEqual(computed_values({**record, 'stage': 'contract', 'children': [{'key': '수요기관', 'rows': [{'deptNm': '부서'}]}]}), {})  # contracts take no contact columns

    def test_lcns_limit_flag_gets_a_label_once(self):
        self.assertEqual(self.call('mvp.settings.read')['result']['settings']['dictionary']['keys']['lcnsLmtYn'], '업종제한 여부')
        current = self.call('mvp.settings.read')['result']; del current['settings']['dictionary']['keys']['lcnsLmtYn']
        self.assertNotIn('error', self.call('mvp.settings.save', current))
        self.gateway.db.execute('PRAGMA user_version=3'); self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.call('mvp.settings.read')['result']['settings']['dictionary']['keys']['lcnsLmtYn'], '업종제한 여부')
        current = self.call('mvp.settings.read')['result']; current['settings']['dictionary']['keys']['lcnsLmtYn'] = '사용자 라벨'
        self.assertNotIn('error', self.call('mvp.settings.save', current))
        self.gateway.db.execute('PRAGMA user_version=3'); self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.call('mvp.settings.read')['result']['settings']['dictionary']['keys']['lcnsLmtYn'], '사용자 라벨')

    def test_output_columns_setting_is_validated_and_kept(self):
        for invalid in ([], {'ctrtNo': 1}, {'ctrtNo': None}):
            self.assertEqual(self.update_settings(outputColumns=invalid)['error']['code'], 'VALIDATION')
        saved = self.update_settings(outputColumns={'ctrtNo': False, 'deptNm': True})['result']
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.call('mvp.settings.read')['result']['settings']['outputColumns'], {'ctrtNo': False, 'deptNm': True})

    def test_removed_user_column_values_go_on_request(self):
        # Deleting a user column asks whether its values go too (user, 2026-10-09, #46): every record of the stage, trash included.
        self.save([observation(number='A'), observation(number='B'), observation(number='C')])
        rows = {r['identity'][0]: r for r in self.records()}
        for row in rows.values():
            row['userValues'] = {'메모': '지움', '남김': '둠'}
        rows = {r['identity'][0]: r for r in self.call('mvp.edit', {'records': list(rows.values())})['result']}
        self.call('mvp.trash', {'records': [{'recordId': rows['C']['recordId'], 'storeVersion': rows['C']['storeVersion']}]})
        settings = self.call('mvp.settings.read')['result']
        column = {'stage': 'receipt', 'keys': ['남김'], 'settingsStoreVersion': settings['storeVersion']}
        for bad in (['남김'], '메모', [1]):
            self.assertEqual(self.call('mvp.edit', {'records': [rows['A']], 'userColumns': {**column, 'removeValues': bad}})['error']['code'], 'VALIDATION')
        self.assertEqual(self.records()[0]['userValues'], {'메모': '지움', '남김': '둠'})  # atomic
        contract = {'stage': 'contract', 'keys': [], 'settingsStoreVersion': settings['storeVersion']}
        for fixed in (['종결'], ['지체일수']):
            self.assertEqual(self.call('mvp.edit', {'records': [], 'userColumns': {**contract, 'removeValues': fixed}})['error']['code'], 'VALIDATION')
        edited = self.call('mvp.edit', {'records': [rows['A']], 'userColumns': {**column, 'removeValues': ['메모']}})['result'][0]
        self.assertEqual((edited['userValues'], edited['storeVersion']), ({'남김': '둠'}, rows['A']['storeVersion'] + 1))
        after = {r['identity'][0]: r for r in self.records()}
        self.assertEqual((after['B']['userValues'], after['B']['storeVersion']), ({'남김': '둠'}, rows['B']['storeVersion'] + 1))
        trashed = self.call('mvp.records', {'stage': 'receipt', 'trashed': True})['result'][0]
        self.assertEqual(trashed['userValues'], {'남김': '둠'})
        self.assertEqual(after['A']['storeVersion'], edited['storeVersion'])  # the edited row is not bumped twice

    def test_new_user_column_names_may_not_be_source_keys_or_labels(self):
        self.save([observation()]); settings = self.call('mvp.settings.read')['result']
        label = settings['settings']['dictionary']['keys']['ctrtDmndRcptNo']
        self.assertEqual(settings['settings']['dictionary']['keys']['memo'], '메모')  # a label of a key these records lack stays free
        column = lambda keys, version: {'stage': 'receipt', 'keys': keys, 'settingsStoreVersion': version}
        for name in ('quantity', label):
            self.assertEqual(self.call('mvp.edit', {'records': [], 'userColumns': column([name], settings['storeVersion'])})['error']['code'], 'VALIDATION')
        self.assertNotIn('error', self.call('mvp.edit', {'records': [], 'userColumns': column(['메모'], settings['storeVersion'])}))
        # Names records already hold (no saved definition) stay usable, and so do the contract defaults.
        record = self.records()[0]; record['userValues']['checked'] = '예전 값'
        self.gateway.save({**record, 'storeVersion': record['storeVersion'] + 1})
        self.assertNotIn('error', self.call('mvp.edit', {'records': [], 'userColumns': column(['checked'], self.call('mvp.settings.read')['result']['storeVersion'])}))
        settings = self.call('mvp.settings.read')['result']
        # A name defined before this rule stays usable; only new names are checked.
        current = self.call('mvp.settings.read')['result']; current['settings']['userColumns'] = {'receipt': ['확인 열', 'quantity']}
        self.assertNotIn('error', self.call('mvp.settings.save', current))
        version = self.call('mvp.settings.read')['result']['storeVersion']
        self.assertNotIn('error', self.call('mvp.edit', {'records': [], 'userColumns': column(['확인 열', 'quantity'], version)}))

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
        record['fields']['ctrtNo'] = '0'; self.assertEqual(self.call('mvp.edit', {'records': [record]})['error']['code'], 'READ_ONLY')

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
        record['userValues']['메모'] = '변경'; record['userValues']['빈 사용자 열'] = ''
        result = self.call('mvp.edit', {'records': [record], 'userColumns': {'stage': 'receipt', 'keys': ['빈 사용자 열'], 'settingsStoreVersion': before['storeVersion']}})
        self.assertNotIn('error', result); self.assertIsInstance(result['result'], list); self.assertEqual(result['result'][0]['storeVersion'], 2)
        settings = self.call('mvp.settings.read')['result']
        self.assertEqual(settings['storeVersion'], before['storeVersion'] + 1); self.assertEqual(settings['settings']['userColumns']['receipt'], ['빈 사용자 열'])
        expected = copy.deepcopy(before['settings']); expected['userColumns']['receipt'] = ['빈 사용자 열']; self.assertEqual(settings['settings'], expected)
        self.gateway.close(); self.gateway = MvpGateway(self.path)
        self.assertEqual(self.call('mvp.settings.read')['result']['settings']['userColumns']['receipt'], ['빈 사용자 열'])
        self.assertEqual(self.records()[0]['userValues']['메모'], '변경'); self.assertEqual(self.records()[0]['userValues']['빈 사용자 열'], '')

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
        changed = copy.deepcopy(record); changed['userValues']['메모'] = '되돌려야 함'
        result = self.call('mvp.edit', {'records': [changed], 'userColumns': {'stage': 'receipt', 'keys': ['실패 열'], 'settingsStoreVersion': before['storeVersion'] - 1}})
        self.assertEqual(result['error']['code'], 'STALE'); self.assertEqual(self.records()[0], record); self.assertEqual(self.call('mvp.settings.read')['result'], before)

    def test_stale_row_rolls_back_metadata_and_prior_row(self):
        self.save([observation(number='A'), observation(number='B')]); before_rows = self.records(); before = self.call('mvp.settings.read')['result']
        changed = copy.deepcopy(before_rows); changed[0]['userValues']['메모'] = '첫 행'; changed[1]['storeVersion'] = -1
        result = self.call('mvp.edit', {'records': changed, 'userColumns': {'stage': 'receipt', 'keys': ['실패 열'], 'settingsStoreVersion': before['storeVersion']}})
        self.assertEqual(result['error']['code'], 'STALE'); self.assertEqual(self.records(), before_rows); self.assertEqual(self.call('mvp.settings.read')['result'], before)

    def test_column_metadata_rejects_mixed_stage_and_invalid_types(self):
        self.save([observation(), observation('contract')]); before = self.call('mvp.settings.read')['result']; receipt = self.records()[0]; contract = self.records('contract')[0]
        changed = copy.deepcopy(receipt); changed['userValues']['메모'] = '첫 행'
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
            payload = {'observations': [source], 'token': preview['token']}
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

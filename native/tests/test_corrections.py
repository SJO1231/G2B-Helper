"""Synthetic SQLite regressions for source corrections and uncertain writes."""
import copy
import tempfile
import threading
import unittest
from pathlib import Path

from test_mvp import observation, source_capture
from pce.mvp import MvpGateway


class CorrectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='G2B corrections ')
        self.path = Path(self.directory.name) / 'records.sqlite3'
        self.gateway = MvpGateway(self.path)
        self.sequence = 0

    def tearDown(self):
        self.gateway.close()
        self.directory.cleanup()

    def call(self, command, payload=None, request_id=None):
        self.sequence += 1
        return self.gateway.handle({'protocolVersion': 1, 'requestId': request_id or f'call-{self.sequence}',
                                    'command': command, 'payload': payload or {}})

    def records(self):
        return self.call('mvp.records', {'stage': 'receipt'})['result']

    def capture(self, sources, use_incoming=False):
        sources = [source_capture(source) for source in sources]
        preview = self.call('mvp.preview', {'observations': sources})['result']
        decisions = [{'recordId': item['recordId'], 'field': item['field'], 'useIncoming': use_incoming}
                     for item in preview['conflicts']]
        return self.call('mvp.apply', {'observations': sources, 'token': preview['token'], 'decisions': decisions})

    def edit(self, record, **values):
        edited = copy.deepcopy(record)
        edited['fields'].update(values)
        return self.call('mvp.edit', {'records': [edited]})['result'][0]

    def reset_payload(self, record, fields):
        return {'records': [{'recordId': record['recordId'], 'storeVersion': record['storeVersion'], 'fields': fields}]}

    def settings(self, **values):
        state = self.call('mvp.settings.read')['result']
        state['settings'].update(values)
        return self.call('mvp.settings.save', state)

    def test_recapture_of_same_source_keeps_correction_without_conflict_or_version_change(self):
        source = observation()
        self.capture([source])
        corrected = self.edit(self.records()[0], quantity=12)
        preview = self.call('mvp.preview', {'observations': [source]})['result']
        self.assertEqual(preview['conflicts'], [])
        self.assertEqual(preview['counts']['identical'], 1)
        self.capture([source])
        self.assertEqual(self.records(), [corrected])
        self.assertEqual(corrected['sourceFields'], source['fields'])
        self.assertEqual(corrected['overrides'], {'quantity': 12})
        self.assertEqual(corrected['rawJson'], source['rawJson'])

    def test_source_change_under_override_counts_and_reset_restores_latest_accepted_source(self):
        source = observation()
        self.capture([source])
        corrected = self.edit(self.records()[0], quantity=12)
        incoming = copy.deepcopy(source)
        incoming['fields']['quantity'] = 3
        incoming = source_capture(incoming)
        preview = self.call('mvp.preview', {'observations': [incoming]})['result']
        self.assertEqual(preview['conflicts'], [{'recordId': corrected['recordId'], 'field': 'quantity',
                                               'previous': 0, 'incoming': 3, 'override': 12}])
        response = self.capture([incoming], use_incoming=True)['result']
        updated = response['records'][0]
        self.assertEqual(response['counts']['changed'], 1)
        self.assertEqual(updated['fields']['quantity'], 12)
        self.assertEqual(updated['sourceFields']['quantity'], 3)
        self.assertEqual(updated['storeVersion'], corrected['storeVersion'] + 1)
        self.assertEqual(updated['rawJson'], incoming['rawJson'])
        reset = self.call('mvp.corrections.reset', self.reset_payload(updated, ['quantity']))['result'][0]
        self.assertEqual(reset['fields']['quantity'], 3)
        self.assertEqual(reset['overrides'], {})
        self.assertEqual(reset['rawJson'], incoming['rawJson'])
        self.assertEqual(reset['userValues'], updated['userValues'])

    def test_rejected_source_change_preserves_entire_corrected_record(self):
        source = observation()
        self.capture([source])
        corrected = self.edit(self.records()[0], quantity=None)
        incoming = copy.deepcopy(source)
        incoming['fields']['quantity'] = 3
        preview = self.call('mvp.preview', {'observations': [source_capture(incoming)]})['result']
        self.assertIn('override', preview['conflicts'][0])
        self.assertIsNone(preview['conflicts'][0]['override'])
        self.capture([incoming])
        self.assertEqual(self.records(), [corrected])

    def test_source_supplement_under_override_preserves_correction(self):
        source = observation()
        self.capture([source])
        corrected = self.edit(self.records()[0], blank=False)
        incoming = copy.deepcopy(source)
        incoming['fields']['blank'] = 'source supplement'
        updated = self.capture([incoming])['result']
        self.assertEqual(updated['counts']['supplemented'], 1)
        record = updated['records'][0]
        self.assertIs(record['fields']['blank'], False)
        self.assertEqual(record['sourceFields']['blank'], 'source supplement')
        self.assertEqual(record['overrides'], {'blank': False})
        self.assertEqual(record['storeVersion'], corrected['storeVersion'] + 1)

    def test_zero_false_empty_null_and_nested_type_equality(self):
        source = observation()
        source['fields'].update(a=5, b=True, c='text', d='text', nested={'x': [0, False, None], 'y': '0.00'})
        self.capture([source])
        original = self.records()[0]
        corrected = self.edit(original, a=0, b=False, c='', d=None,
                              nested={'y': '0.00', 'x': [0, False, None]})
        self.assertEqual(corrected['overrides'], {'a': 0, 'b': False, 'c': '', 'd': None})
        different_types = self.edit(corrected, quantity=False, checked=0,
                                    nested={'x': [False, 0, None], 'y': '0.00'})
        self.assertIs(different_types['overrides']['quantity'], False)
        self.assertIs(type(different_types['overrides']['checked']), int)
        self.assertIn('nested', different_types['overrides'])
        restored = self.call('mvp.corrections.reset', self.reset_payload(different_types,
                             ['a', 'b', 'c', 'd', 'quantity', 'checked', 'nested']))['result'][0]
        self.assertEqual(restored['fields'], original['fields'])
        self.assertEqual(restored['overrides'], {})

    def test_manual_return_to_source_removes_override_and_untrusted_metadata_is_ignored(self):
        self.capture([observation()])
        corrected = self.edit(self.records()[0], quantity=99)
        corrected['sourceFields']['quantity'] = 99
        corrected['overrides'] = {'quantity': 'forged'}
        restored = self.edit(corrected, quantity=0)
        self.assertEqual(restored['overrides'], {})
        self.assertEqual(restored['sourceFields']['quantity'], 0)

    def test_same_corrected_value_from_source_keeps_metadata_until_explicit_reset(self):
        source = observation()
        self.capture([source])
        corrected = self.edit(self.records()[0], quantity=4)
        source['fields']['quantity'] = 4
        updated = self.capture([source], use_incoming=True)['result']['records'][0]
        self.assertEqual(updated['overrides'], {'quantity': 4})
        self.assertEqual(updated['fields'], updated['sourceFields'])
        reset = self.call('mvp.corrections.reset', self.reset_payload(updated, ['quantity']))['result'][0]
        self.assertEqual(reset['overrides'], {})
        self.assertEqual(reset['storeVersion'], corrected['storeVersion'] + 2)

    def test_partial_reset_retains_other_corrections_and_user_values(self):
        self.capture([observation()])
        original = self.records()[0]
        original['userValues'] = {'note': None, 'zero': 0, 'flag': False}
        corrected = self.edit(original, quantity=5, checked=True)
        reset = self.call('mvp.corrections.reset', self.reset_payload(corrected, ['quantity']))['result'][0]
        self.assertEqual(reset['overrides'], {'checked': True})
        self.assertEqual(reset['userValues'], original['userValues'])
        self.assertIs(reset['fields']['checked'], True)

    def test_legacy_baseline_is_stored_fields_and_never_reconstructed_from_raw(self):
        source = observation()
        legacy = {**source, 'recordId': 'receipt:legacy', 'storeVersion': 9, 'userValues': {'memo': False}}
        legacy['fields'] = {**source['fields'], 'quantity': 77}
        self.gateway.save(legacy)
        corrected = self.edit(legacy, quantity=88)
        self.assertEqual(corrected['sourceFields']['quantity'], 77)
        self.assertEqual(corrected['overrides'], {'quantity': 88})
        restored = self.call('mvp.corrections.reset', self.reset_payload(corrected, ['quantity']))['result'][0]
        self.assertEqual(restored['fields']['quantity'], 77)
        self.assertEqual(restored['rawJson'], source['rawJson'])

    def test_legacy_identical_capture_and_noop_reset_do_not_migrate_or_increment(self):
        self.capture([observation()])
        legacy = self.records()[0]
        legacy.pop('sourceFields')
        legacy.pop('overrides')
        self.gateway.save(legacy)
        self.capture([observation()])
        self.assertEqual(self.records(), [legacy])
        reset = self.call('mvp.corrections.reset', self.reset_payload(legacy, ['quantity']))['result'][0]
        self.assertEqual(reset, legacy)

    def test_identity_and_lock_restrictions_apply_to_reset(self):
        self.capture([observation()])
        corrected = self.edit(self.records()[0], quantity=1)
        identity = corrected['identity'][0]
        for field in ('ctrtDmndRcptNo', 'ctrtDmndRcptOrd'):
            self.assertEqual(self.call('mvp.corrections.reset', self.reset_payload(corrected, [field]))['error']['code'], 'VALIDATION')
        self.assertNotIn('error', self.settings(columnLocks={'quantity': True}))
        self.assertEqual(self.call('mvp.corrections.reset', self.reset_payload(corrected, ['quantity']))['error']['code'], 'LOCKED')
        self.assertEqual(self.records(), [corrected])
        self.assertEqual(self.records()[0]['identity'][0], identity)

    def test_reset_validation_and_trashed_rows(self):
        self.capture([observation()])
        corrected = self.edit(self.records()[0], quantity=1)
        for selected in ([], 'quantity', ['quantity', 'quantity'], ['missing'], [None]):
            self.assertIn('error', self.call('mvp.corrections.reset', self.reset_payload(corrected, selected)))
            self.assertEqual(self.records(), [corrected])
        for version in (True, None, 0):
            payload = self.reset_payload(corrected, ['quantity'])
            payload['records'][0]['storeVersion'] = version
            self.assertEqual(self.call('mvp.corrections.reset', payload)['error']['code'], 'STALE')
        self.call('mvp.trash', {'records': [{'recordId': corrected['recordId'], 'storeVersion': corrected['storeVersion']}]})
        corrected['storeVersion'] += 1
        self.assertEqual(self.call('mvp.corrections.reset', self.reset_payload(corrected, ['quantity']))['error']['code'], 'TRASHED')

    def test_atomic_batch_rollback_on_late_stale_or_locked_record(self):
        self.capture([observation(number='A'), observation(number='B')])
        records = [self.edit(record, quantity=8, checked=True) for record in self.records()]
        changes = [self.reset_payload(record, ['quantity'])['records'][0] for record in records]
        changes[1]['storeVersion'] -= 1
        self.assertEqual(self.call('mvp.corrections.reset', {'records': changes})['error']['code'], 'STALE')
        self.assertEqual(self.records(), records)
        changes[1]['storeVersion'] += 1
        changes[1]['fields'] = ['checked']
        self.settings(columnLocks={'checked': True})
        self.assertEqual(self.call('mvp.corrections.reset', {'records': changes})['error']['code'], 'LOCKED')
        self.assertEqual(self.records(), records)
        changes[1] = changes[0]
        self.assertIn('error', self.call('mvp.corrections.reset', {'records': changes}))

    def test_other_connection_edit_invalidates_reset_and_preview(self):
        source = observation()
        self.capture([source])
        corrected = self.edit(self.records()[0], quantity=1)
        source['fields']['quantity'] = 2
        source = source_capture(source)
        preview = self.call('mvp.preview', {'observations': [source]})['result']
        other = MvpGateway(self.path)
        try:
            edited = copy.deepcopy(corrected)
            edited['fields']['quantity'] = 3
            response = other.handle({'protocolVersion': 1, 'requestId': 'other-window', 'command': 'mvp.edit', 'payload': {'records': [edited]}})
            self.assertNotIn('error', response)
        finally:
            other.close()
        self.assertEqual(self.call('mvp.corrections.reset', self.reset_payload(corrected, ['quantity']))['error']['code'], 'STALE')
        self.assertEqual(self.call('mvp.apply', {'observations': [source], 'token': preview['token'],
                            'decisions': [{'recordId': corrected['recordId'], 'field': 'quantity', 'useIncoming': True}]})['error']['code'], 'STALE')
        self.assertEqual(self.records()[0]['overrides'], {'quantity': 3})

    def test_reset_and_status_are_idempotent_and_survive_restart(self):
        self.capture([observation()])
        corrected = self.edit(self.records()[0], quantity=9)
        payload = self.reset_payload(corrected, ['quantity'])
        response = self.call('mvp.corrections.reset', payload, 'reset-once')
        self.assertEqual(response, self.call('mvp.corrections.reset', payload, 'reset-once'))
        self.assertEqual(self.call('mvp.request.status', {'requestId': 'reset-once'})['result'], {'status': 'stored', 'response': response})
        self.gateway.close()
        self.gateway = MvpGateway(self.path)
        self.assertEqual(response, self.call('mvp.corrections.reset', payload, 'reset-once'))
        self.assertEqual(self.call('mvp.request.status', {'requestId': 'reset-once'})['result']['response'], response)
        record = self.records()[0]
        self.assertEqual(record['storeVersion'], corrected['storeVersion'] + 1)
        noop = self.call('mvp.corrections.reset', self.reset_payload(record, ['quantity']))['result'][0]
        self.assertEqual(noop, record)
        changed = copy.deepcopy(payload)
        changed['records'][0]['fields'] = ['checked']
        self.assertEqual(self.call('mvp.corrections.reset', changed, 'reset-once')['error']['code'], 'REQUEST_ID')

    def test_uncertain_edit_status_recovers_cached_response_without_reapplying(self):
        self.capture([observation()])
        edited = self.records()[0]
        edited['fields']['quantity'] = 7
        payload = {'records': [edited]}
        response = self.call('mvp.edit', payload, 'uncertain-edit')
        before = self.records()
        status = self.call('mvp.request.status', {'requestId': 'uncertain-edit'})['result']
        self.assertEqual(status, {'status': 'stored', 'response': response})
        self.assertEqual(self.call('mvp.edit', payload, 'uncertain-edit'), response)
        self.assertEqual(self.records(), before)

    def test_two_connections_retry_same_inflight_write_after_writer_lock(self):
        self.capture([observation()])
        original = self.records()[0]
        edited = copy.deepcopy(original)
        edited['fields']['quantity'] = 7
        request = {'protocolVersion': 1, 'requestId': 'concurrent-replay', 'command': 'mvp.edit',
                   'payload': {'records': [edited]}}
        other = MvpGateway(self.path)
        first_uncommitted, replay_at_lock, allow_commit = threading.Event(), threading.Event(), threading.Event()
        responses, failures = [], []

        class GatedConnection:
            def __init__(self, connection, first):
                self.connection, self.first = connection, first

            def execute(self, sql, *args):
                if not self.first and sql == 'BEGIN IMMEDIATE':
                    replay_at_lock.set()
                result = self.connection.execute(sql, *args)
                if self.first and sql.startswith('INSERT INTO mvp_requests'):
                    first_uncommitted.set()
                    if not allow_commit.wait(4):
                        raise RuntimeError('Concurrent replay did not reach the writer lock')
                return result

            def __getattr__(self, name):
                return getattr(self.connection, name)

        self.gateway.db = GatedConnection(self.gateway.db, True)
        other.db = GatedConnection(other.db, False)

        def write(gateway):
            try:
                responses.append(gateway.handle(copy.deepcopy(request)))
            except BaseException as error:
                failures.append(error)

        first = threading.Thread(target=write, args=(self.gateway,))
        replay = threading.Thread(target=write, args=(other,))
        try:
            first.start()
            self.assertTrue(first_uncommitted.wait(3), 'First write never reached uncommitted request cache')
            replay.start()
            self.assertTrue(replay_at_lock.wait(3), 'Replay never attempted the writer lock')
        finally:
            allow_commit.set()
            first.join(5)
            if replay.ident is not None:
                replay.join(5)
            other.close()
        self.assertFalse(first.is_alive())
        self.assertFalse(replay.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(len(responses), 2)
        self.assertNotIn('error', responses[0])
        self.assertEqual(responses[0], responses[1])
        saved = self.records()[0]
        self.assertEqual(saved['storeVersion'], original['storeVersion'] + 1)
        self.assertEqual(saved['overrides'], {'quantity': 7})
        self.assertEqual(self.call('mvp.request.status', {'requestId': request['requestId']})['result']['response'], responses[0])

    def test_request_status_not_found_for_reads_and_failed_writes_and_validates_id(self):
        self.assertEqual(self.call('mvp.request.status', {'requestId': 'missing'})['result'], {'status': 'not-found'})
        self.call('mvp.health', request_id='read-only')
        self.call('mvp.corrections.reset', {'records': []}, 'failed-write')
        for request_id in ('read-only', 'failed-write'):
            self.assertEqual(self.call('mvp.request.status', {'requestId': request_id})['result'], {'status': 'not-found'})
        for invalid in (None, '', '  ', 0, True, [], 'x' * 201):
            self.assertEqual(self.call('mvp.request.status', {'requestId': invalid})['error']['code'], 'VALIDATION')
        self.assertEqual(self.gateway.db.execute('SELECT count(*) FROM mvp_requests').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()

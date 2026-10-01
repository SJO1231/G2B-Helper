import copy
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pce.gateway import Gateway


class DatasetSourcesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='pce-dataset-alias-')
        self.gateway = Gateway(Path(self.directory.name) / 'test.sqlite3')

    def tearDown(self):
        self.gateway.store.db.close()
        self.directory.cleanup()

    def send(self, command, payload):
        return self.gateway.handle({'protocolVersion': 1, 'requestId': str(uuid.uuid4()), 'command': command, 'payload': payload})

    def ok(self, command, payload):
        result = self.send(command, payload)
        self.assertNotIn('error', result)
        return result['result']

    def capture(self):
        return {'pointInfo': {}, 'tables': {}, 'frames': [{'framePath': 'top', 'url': 'https://fixture.test',
                'pointInfo': {'screen': 'one'}, 'tables': {'stableGrid': [{'id': '001', 'zero': 0, 'enabled': False}] * 2},
                'tableSources': {'stableGrid': {'componentId': 'wq_uuid_17_grid', 'originalId': 'stableGrid'}}}]}

    def test_old_actual_id_and_stable_id_keep_one_dataset_and_original_multiplicity(self):
        capture = self.capture()
        source = self.ok('dataset.create', {'name': 'alias test', 'rows': [], 'columns': [{'field': 'id', 'kind': 'text'}]})['sourceId']
        rules = [{'sourceId': source, 'dataset': name, 'identityFields': ['id']} for name in ['wq_uuid_17_grid', 'stableGrid']]
        policy = self.ok('collector.policy', {})
        self.ok('settings.save', {'key': 'collector.rules', 'storeVersion': policy['storeVersion'], 'value': rules})
        policy = self.ok('collector.policy', {})
        result = self.ok('capture.collect', {'policyVersion': policy['storeVersion'], 'bundle': {'format': 'pce-transfer', 'version': 1,
                         'captures': [{'captureId': str(uuid.uuid4()), 'payload': capture}]}})
        stored = self.ok('capture.read', {'captureId': result['captureIds'][0]})['payload']['frames'][0]
        self.assertEqual(stored['tables'], capture['frames'][0]['tables'])
        self.assertEqual(stored['tableSources'], capture['frames'][0]['tableSources'])
        preview = self.ok('collector.preview', {'captureId': result['captureIds'][0]})
        self.assertEqual(len(preview['records']), 1)
        self.assertEqual(preview['records'][0]['identity']['id'], '001')

    def test_malformed_metadata_cannot_write_raw_event(self):
        capture = self.capture()
        capture['frames'][0]['tableSources']['missing'] = {'componentId': 'x', 'originalId': 'x'}
        result = self.send('capture.import', {'bundle': {'format': 'pce-transfer', 'version': 1,
                           'captures': [{'captureId': str(uuid.uuid4()), 'payload': capture}]}})
        self.assertIn('error', result)
        self.assertEqual(self.ok('capture.list', {}), [])


if __name__ == '__main__':
    unittest.main()

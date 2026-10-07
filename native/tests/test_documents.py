import copy
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pce.mvp import MvpGateway


class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.received = []
        self.reply_override = None
        self.reply_omit = ()
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({'profiles': [{'id': 'test', 'label': '검증 서식'}]}).encode())
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.received.append(payload)
                result = {'requestId': payload['requestId'], 'status': 'success', 'results': [{'itemIndex': i, 'status': 'success', 'path': f'test-{i}.hwpx'} for i in range(len(payload['items']))], 'summary': {'succeeded': len(payload['items']), 'needsInput': 0, 'failed': 0}}
                if owner.reply_override: result.update(owner.reply_override)
                for key in owner.reply_omit: result.pop(key, None)
                self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(result).encode())
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.environment = patch.dict(os.environ, {'G2B_STUDIO_PORT': str(self.server.server_port)}); self.environment.start()
        self.tmp = tempfile.TemporaryDirectory()
        self.gateway = MvpGateway(Path(self.tmp.name) / 'helper.sqlite')
        self.payload = {'profileId': 'test', 'sourceKind': 'screen', 'items': [{'stage': 'contract', 'identity': ['0001', '01'], 'fields': {'ctrtNo': '0001', 'amount': '12345678901234567890.00001', 'flag': False, 'zero': 0, 'blank': ''}, 'userValues': {'note': ''}, 'children': [], 'source': {'url': 'https://www.g2b.go.kr/'}}]}

    def tearDown(self):
        self.gateway.close(); self.tmp.cleanup(); self.environment.stop()
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def call(self, command='mvp.document.generate', payload=None):
        return self.gateway.handle({'protocolVersion': 1, 'requestId': 'doc-test', 'command': command, 'payload': copy.deepcopy(self.payload if payload is None else payload)})

    def test_forwards_exact_snapshot_and_retry_id_without_business_db_write(self):
        for _ in range(2): self.assertEqual(self.call()['result']['status'], 'success')
        self.assertEqual(self.received[0], {**self.payload, 'requestId': 'doc-test'})
        self.assertEqual(self.received[0], self.received[1])
        self.assertEqual(self.gateway.db.execute('SELECT COUNT(*) FROM mvp_records').fetchone()[0], 0)
        self.assertEqual(self.gateway.db.execute('SELECT COUNT(*) FROM mvp_requests').fetchone()[0], 0)

    def test_profiles_and_document_setting_validation(self):
        self.assertEqual(self.call('mvp.document.profiles', {})['result']['profiles'][0]['id'], 'test')
        settings = self.gateway.dispatch('mvp.settings.read', {})
        settings['settings']['documentProfiles'] = {'contract': 'test'}
        self.assertIn('result', self.call('mvp.settings.save', settings))
        settings = self.gateway.dispatch('mvp.settings.read', {})
        settings['settings']['documentProfiles'] = {'unknown': 'test'}
        self.assertIn('error', self.call('mvp.settings.save', settings))

    def test_document_field_links_are_validated_per_stage_and_profile(self):
        settings = self.gateway.dispatch('mvp.settings.read', {})
        settings['settings']['documentLinks'] = {'contract': {'test': {'담당부서': 'dmstUntyGrpNm', '계약 금액': 'ctrtAmt'}}}
        self.assertIn('result', self.call('mvp.settings.save', settings))
        self.assertEqual(self.gateway.dispatch('mvp.settings.read', {})['settings']['documentLinks']['contract']['test']['담당부서'], 'dmstUntyGrpNm')
        for links in ({'unknown': {'test': {'a': 'b'}}}, {'contract': {'test': {'a': ''}}}, {'contract': {'': {'a': 'b'}}},
                      {'contract': {'test': ['a']}}, {'contract': {'test': {'a': 1}}}, {'contract': {'test': {str(i): 'b' for i in range(2001)}}}):
            settings = self.gateway.dispatch('mvp.settings.read', {})
            settings['settings']['documentLinks'] = links
            self.assertIn('error', self.call('mvp.settings.save', settings), links if len(str(links)) < 200 else 'oversized')

    def test_rejects_empty_oversized_and_arbitrary_endpoint_payload(self):
        for change in ({'items': []}, {'items': self.payload['items'] * 101}, {'url': 'http://example.com'}, {'sourceKind': 'other'}):
            self.assertIn('error', self.call(payload={**self.payload, **change}))
        self.assertEqual(self.received, [])

    def test_unavailable_studio_is_not_success(self):
        with patch('pce.documents.http.client.HTTPConnection.request', side_effect=ConnectionRefusedError):
            self.assertEqual(self.call()['error']['code'], 'STUDIO_UNAVAILABLE')

    def test_invalid_success_reply_is_rejected(self):
        for override in ({'requestId': 'different'}, {'results': []}, {'results': [{'itemIndex': 0, 'status': 'success'}]}, {'results': [{'itemIndex': 0, 'status': 'error', 'message': 'failed'}]}):
            self.reply_override = override
            self.assertEqual(self.call()['error']['code'], 'STUDIO_RESPONSE')

    def test_rejects_missing_summary(self):
        self.reply_omit = ('summary',)
        self.assertEqual(self.call().get('error', {}).get('code'), 'STUDIO_RESPONSE')

    def test_rejects_invalid_summary_values(self):
        for summary in (None, [], {}, {'succeeded': 1, 'needsInput': 0},
                        {'succeeded': True, 'needsInput': 0, 'failed': 0},
                        {'succeeded': 1.0, 'needsInput': 0, 'failed': 0},
                        {'succeeded': '1', 'needsInput': 0, 'failed': 0},
                        {'succeeded': 1, 'needsInput': -1, 'failed': 1},
                        {'succeeded': 0, 'needsInput': 0, 'failed': 1},
                        {'succeeded': 2, 'needsInput': 0, 'failed': 0}):
            with self.subTest(summary=summary):
                self.reply_override = {'summary': summary}
                self.assertEqual(self.call().get('error', {}).get('code'), 'STUDIO_RESPONSE')

    def test_rejects_overall_status_and_success_path_contradictions(self):
        for status in ('needs-input', 'error', 'partial'):
            with self.subTest(status=status):
                self.reply_override = {'status': status}
                self.assertEqual(self.call().get('error', {}).get('code'), 'STUDIO_RESPONSE')
        self.reply_override = {'results': [{'itemIndex': 0, 'status': 'success', 'path': ' \t'}]}
        self.assertEqual(self.call().get('error', {}).get('code'), 'STUDIO_RESPONSE')

    def test_accepts_single_and_mixed_status_results(self):
        cases = [
            ('needs-input', ['needs-input'], {'succeeded': 0, 'needsInput': 1, 'failed': 0}),
            ('error', ['error'], {'succeeded': 0, 'needsInput': 0, 'failed': 1}),
            ('partial', ['success', 'needs-input', 'error'], {'succeeded': 1, 'needsInput': 1, 'failed': 1}),
            ('partial', ['needs-input', 'error'], {'succeeded': 0, 'needsInput': 1, 'failed': 1}),
        ]
        for overall, statuses, summary in cases:
            with self.subTest(statuses=statuses):
                results = [{'itemIndex': i, 'status': status, **({'path': f'test-{i}.hwpx'} if status == 'success' else {'message': '확인이 필요합니다.'})} for i, status in enumerate(statuses)]
                self.reply_override = {'status': overall, 'results': results, 'summary': summary}
                payload = {**self.payload, 'items': self.payload['items'] * len(statuses)}
                self.assertEqual(self.call(payload=payload)['result'], {'requestId': 'doc-test', **self.reply_override})
        self.reply_override['status'] = 'needs-input'
        self.assertEqual(self.call(payload=payload).get('error', {}).get('code'), 'STUDIO_RESPONSE')

    def test_invalid_reply_can_retry_same_snapshot_without_helper_writes(self):
        self.reply_override = {'summary': {'succeeded': 0, 'needsInput': 0, 'failed': 1}}
        self.assertEqual(self.call().get('error', {}).get('code'), 'STUDIO_RESPONSE')
        self.reply_override = None
        self.assertEqual(self.call()['result']['status'], 'success')
        self.assertEqual(self.received[0], self.received[1])
        self.assertEqual(self.gateway.db.execute('SELECT COUNT(*) FROM mvp_records').fetchone()[0], 0)
        self.assertEqual(self.gateway.db.execute('SELECT COUNT(*) FROM mvp_requests').fetchone()[0], 0)

if __name__ == '__main__': unittest.main()

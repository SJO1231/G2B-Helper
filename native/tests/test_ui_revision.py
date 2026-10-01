import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pce.store import Store
from pce.gateway import Gateway
from pce.model import Fault

class UiRevisionTests(unittest.TestCase):
    def test_dictionary_defaults_preserve_user_values_and_do_not_reseed_deletions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.sqlite3'
            store = Store(path)
            original = store.configuration('dictionary.keys')
            self.assertIn('ctrtDmndRcptNo', original['value'])
            self.assertEqual(len(store.configuration('dictionary.codes')['value']), 17)
            with store.transaction(True):
                store.save_configuration('dictionary.keys', {'ctrtDmndRcptNo': '내 접수번호'}, original['storeVersion'])
            store.db.close()
            reopened = Store(path)
            self.assertEqual(reopened.configuration('dictionary.keys')['value'], {'ctrtDmndRcptNo': '내 접수번호'})
            reopened.db.close()

    def test_dictionary_upgrade_merges_missing_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / 'test.sqlite3')
            with store.transaction(True):
                marker = store.configuration('system.dictionarySeed.v41')
                store.save_configuration('system.dictionarySeed.v41', None, marker['storeVersion'])
                old = store.configuration('dictionary.keys')
                store.save_configuration('dictionary.keys', {'ctrtDmndRcptNo': '사용자'}, old['storeVersion'])
                store.seed_reference_dictionaries()
            self.assertEqual(store.configuration('dictionary.keys')['value']['ctrtDmndRcptNo'], '사용자')
            self.assertIn('bidPbancNo', store.configuration('dictionary.keys')['value'])
            store.db.close()

    def test_download_default_child_navigation_and_escape_block(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);(root / '자식').mkdir();(root / '자식' / 'zero.txt').write_text('0')
            gateway = Gateway(root / 'test.sqlite3')
            with patch('pce.extension.downloads_folder', return_value=root):
                result = gateway.extension.explorer_context({'relativePath':'자식'})
                self.assertEqual(result['entries'][0]['name'], 'zero.txt')
                with self.assertRaises(Fault):gateway.extension.explorer_context({'relativePath':'../'})
            gateway.store.db.close()

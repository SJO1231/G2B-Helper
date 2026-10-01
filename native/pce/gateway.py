import os
import re
import sqlite3
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from datetime import datetime, timezone
from .model import Fault, require, dumps, loads, digest, empty, validate_columns, validate_record, validate_filter, matches, path_value, inferred_column
from .store import Store
from .collector import Collector
from .tables import Tables
from .relations import Relations
from .query import Query
from .backup import Backup
from .reuse import Reuse
from .extension import Extension


class Gateway:
    """Registry composes feature handlers; all mutations share one transaction."""
    def __init__(self, database_path, viewer_directory=None, viewer_open=None):
        self.store = Store(database_path)
        self.collector = Collector(self.store)
        self.lock = threading.RLock()
        self.viewer_directory = Path(viewer_directory or Path(database_path).parent / 'viewers')
        self.tables = Tables(self.store)
        self.relations = Relations(self.store)
        self.query = Query(self.store)
        self.backup = Backup(self.store, self.collector, self.relations)
        self.reuse = Reuse(self.store, self.viewer_directory, viewer_open)
        self.extension = Extension(self.store, self.tables, self.collector, self.reuse)
        self.registry = {}
        self.register('gateway', {'health': self.health})
        self.register('table', {'list': lambda p: self.store.sources(), 'read': self.tables.read_table, 'configure': self.tables.configure_table}, writes={'configure'})
        self.register('dataset', {'create': self.tables.create_dataset}, writes={'create'})
        self.register('grid', {'commit': self.tables.commit_grid}, writes={'commit'})
        self.register('settings', {'read': lambda p: self.store.configuration(p['key']), 'save': self.tables.save_settings}, writes={'save'})
        self.register('relation', {'list': self.relations.list_relations, 'preview': lambda p: self.relations.preview_relation(p['definition']), 'save': self.relations.save_relation, 'query': self.relations.query_relation}, writes={'save'})
        self.register('capture', {'collect': lambda p: self.collector.collect_bundle(p['bundle'], p.get('policyVersion')), 'import': lambda p: self.collector.import_bundle(p['bundle']), 'list': lambda p: self.collector.list(), 'read': lambda p: self.collector.read(p['captureId'])}, writes={'import', 'collect'})
        self.register('collector', {'events': lambda p: self.store.activity(p.get('limit', 1000)), 'policy': lambda p: self.collector.policy(), 'register': self.extension.register_collector, 'preview': lambda p: self.collector.preview(p['captureId']), 'apply': lambda p: self.collector.apply(p['captureId'], p.get('decisions', []), p.get('previewToken'))}, writes={'apply', 'register'})
        self.register('extension.document', {'list': self.extension.list_documents, 'put': self.extension.put_document, 'remove': self.extension.remove_document}, writes={'put', 'remove'})
        self.register('explorer', {'context': self.extension.explorer_context}, writes={'context'})
        self.register('query', {'execute': self.query.execute_sql})
        self.register('search', {'all': self.query.search})
        self.register('backup', {'export': self.backup.export_backup, 'preview': self.backup.preview_backup, 'restore': self.backup.restore_backup}, writes={'restore'})
        self.register('template', {'render': self.reuse.render_template})
        self.register('viewer', {'open': self.reuse.open_viewer}, writes={'open'})
        self.register('files', {'open': self.reuse.open_file, 'ensureFolder': self.reuse.ensure_folder}, writes={'open', 'ensureFolder'})
        self.register('launcher', {'execute': self.reuse.execute_launcher}, writes={'execute'})

    def register(self, plugin, commands, writes=()):
        for name, handler in commands.items():
            command = plugin + '.' + name
            require(command not in self.registry, 'Duplicate plugin command')
            self.registry[command] = (handler, name in writes)

    def handle(self, request):
        response = {'protocolVersion': 1, 'requestId': request.get('requestId', '') if isinstance(request, dict) else ''}
        with self.lock:
            try:
                require(isinstance(request, dict) and request.get('protocolVersion') == 1, 'Unsupported protocol version')
                request_id = request.get('requestId')
                require(isinstance(request_id, str) and 0 < len(request_id) <= 200, 'Invalid request ID')
                command = request.get('command')
                require(command in self.registry, 'Unknown command', 'UNKNOWN_COMMAND')
                payload = request.get('payload', {})
                require(isinstance(payload, dict), 'Payload must be an object')
                handler, write = self.registry[command]
                fingerprint = digest([command, payload])
                with self.store.transaction(write):
                    if write:
                        previous = self.store.cached_request(request_id)
                        if previous:
                            require(previous['payload_hash'] == fingerprint, 'Request ID was used with different content', 'REQUEST_REUSED')
                            return loads(previous['response'])
                    response['result'] = handler(payload)
                    if write:
                        self.store.cache_request(request_id, fingerprint, response)
                return response
            except Fault as error:
                response['error'] = {'code': error.code, 'message': str(error)}
            except (KeyError, TypeError, ValueError, OverflowError, AttributeError) as error:
                response['error'] = {'code': 'VALIDATION', 'message': str(error)}
            except sqlite3.Error as error:
                response['error'] = {'code': 'DATABASE', 'message': str(error)}
            except OSError as error:
                response['error'] = {'code': 'FILESYSTEM', 'message': str(error)}
        response.pop('result', None)
        return response

    def health(self, payload):
        return {'protocolVersion': 1, 'databasePath': self.store.path, 'schemaVersion': 1, 'plugins': sorted({c.split('.')[0] for c in self.registry}), 'status': 'ready'}

    def set_viewer_opener(self, opener):
        self.reuse.viewer_open = opener

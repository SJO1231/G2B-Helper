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


class Backup:
    def __init__(self, store, collector, relations):
        self.store = store
        self.collector = collector
        self.relations = relations

    def export_backup(self, payload):
        selected = payload.get('sourceIds')
        if selected is not None:
            require(isinstance(selected, list), 'sourceIds must be a list')
            for source in selected:
                self.store.definition(source)
        definitions = [d for d in self.store.sources() if selected is None or d['sourceId'] in selected]
        sources = {d['sourceId'] for d in definitions}
        settings = self.store.configurations()
        if selected is not None:
            settings = [s for s in settings if not s['key'].startswith('relation.') or {s['value']['leftSourceId'], s['value']['rightSourceId']} <= sources]
        return {'format': 'pce-backup', 'version': 1, 'exportedAt': datetime.now(timezone.utc).isoformat(), 'partial': selected is not None, 'tables': [{'definition': d, 'rows': self.store.rows(d['sourceId'])} for d in definitions], 'settings': settings, 'captures': [self.collector.read(c['captureId']) for c in self.collector.list()] if selected is None else [], 'externalFiles': 'references-only'}

    def preview_backup(self, payload):
        bundle = payload['bundle']
        require(isinstance(bundle, dict) and bundle.get('format') == 'pce-backup' and bundle.get('version') == 1, 'Unsupported backup')
        require(isinstance(bundle.get('tables'), list) and isinstance(bundle.get('settings'), list) and isinstance(bundle.get('captures', []), list), 'Malformed backup')
        sources, row_ids, conflicts = set(), set(), []
        for table in bundle['tables']:
            definition = table['definition']
            source = definition['sourceId']
            require(isinstance(source, str) and source not in sources, 'Duplicate/invalid backup source')
            require(source.startswith('dataset.') or self.store.definition(source, required=False) is not None, 'Unapproved backup business table')
            require(isinstance(definition.get('storeVersion'), int) and not isinstance(definition['storeVersion'], bool) and definition['storeVersion'] > 0, 'Invalid table version')
            require(isinstance(definition.get('label'), str) and definition['label'].strip() and definition.get('group') in ('dataset', 'reference', 'collection', 'settings'), 'Invalid table metadata')
            sources.add(source)
            validate_columns(definition['columns'])
            self.store.validate_policy(definition['duplicatePolicy'], definition['columns'])
            require(isinstance(table['rows'], list), 'Invalid backup rows')
            for row in table['rows']:
                require(isinstance(row.get('__rowId'), str) and row['__rowId'] not in row_ids and isinstance(row.get('__storeVersion'), int) and row['__storeVersion'] > 0, 'Duplicate/invalid backup row ID/version')
                row_ids.add(row['__rowId'])
                validate_record({k: v for k, v in row.items() if not k.startswith('__')}, definition['columns'])
            existing = self.store.definition(source, required=False)
            if existing and self.store.rows(source):
                conflicts.append(source)
        available = sources | {d['sourceId'] for d in self.store.sources()}
        definitions = {d['sourceId']: d for d in self.store.sources()}
        definitions.update({t['definition']['sourceId']: t['definition'] for t in bundle['tables']})
        keys = set()
        for setting in bundle['settings']:
            require(isinstance(setting.get('key'), str) and setting['key'] not in keys and isinstance(setting.get('storeVersion'), int) and not isinstance(setting['storeVersion'], bool) and setting['storeVersion'] > 0, 'Invalid backup setting')
            keys.add(setting['key'])
            if setting['key'].startswith('relation.'):
                require({setting['value']['leftSourceId'], setting['value']['rightSourceId']} <= available, 'Missing relation dependency')
                relation = setting['value']
                require(relation.get('cardinality') in ('one', 'many') and isinstance(relation.get('fieldPairs'), list) and relation['fieldPairs'], 'Invalid relation')
                left_fields = {c['field'] for c in definitions[relation['leftSourceId']]['columns']}
                right_fields = {c['field'] for c in definitions[relation['rightSourceId']]['columns']}
                require(all(p.get('left') in left_fields and p.get('right') in right_fields for p in relation['fieldPairs']), 'Missing relation column dependency')
                validate_filter(relation.get('filter'))
            elif setting['key'] == 'collector.rules' and setting['value'] is not None:
                value = setting['value']
                if isinstance(value, dict):
                    require(type(value.get('includeDefaults')) is bool, 'Invalid default collection policy')
                    value = value.get('rules')
                require(isinstance(value, list), 'Invalid collection rules')
                for rule in value:
                    require(rule.get('sourceId') in available, 'Missing collection rule dependency')
                    require(isinstance(rule.get('identityFields'), list) and rule['identityFields'], 'Invalid collection rule identity')
                    validate_filter(rule.get('screenFilter'))
                    validate_filter(rule.get('urlFilter'))
        # Evaluate the complete resulting graph, including dependencies outside a
        # partial archive. A preview must reject everything restore would reject.
        settings = {s['key']: s for s in self.store.configurations()}
        settings.update({s['key']: s for s in bundle['settings']})
        all_rows = {s: self.store.rows(s) for s in definitions if s not in sources}
        all_rows.update({t['definition']['sourceId']: t['rows'] for t in bundle['tables']})
        preserved_ids = {r['__rowId'] for s, rows in all_rows.items() if s not in sources for r in rows}
        require(not row_ids.intersection(preserved_ids), 'Backup row ID collides with an unselected table')
        self.validate_dependencies(definitions, all_rows, settings)
        capture_ids, event_contents, capture_conflicts = set(), set(), []
        existing_captures = {c['captureId']: self.collector.read(c['captureId']) for c in self.collector.list()}
        final_captures = dict(existing_captures)
        for capture in bundle.get('captures', []):
            require(isinstance(capture, dict) and isinstance(capture.get('captureId'), str) and capture['captureId'] and capture['captureId'] not in capture_ids and isinstance(capture.get('eventId'), str) and capture['eventId'] and isinstance(capture.get('capturedAt'), str), 'Invalid backup capture metadata')
            self.collector.validate_payload(capture.get('payload'))
            capture_ids.add(capture['captureId'])
            if capture['captureId'] in existing_captures and capture != existing_captures[capture['captureId']]:
                capture_conflicts.append(capture['captureId'])
            final_captures[capture['captureId']] = capture
        for capture in final_captures.values():
            identity = (capture['eventId'], digest(capture['payload']))
            require(identity not in event_contents, 'Capture content exists under another capture ID; exact restore is ambiguous')
            event_contents.add(identity)
        setting_conflicts = [s['key'] for s in bundle['settings'] if self.store.configuration(s['key'])['storeVersion'] and self.store.configuration(s['key']) != {'value': s['value'], 'storeVersion': s['storeVersion']}]
        return {'tableCount': len(sources), 'rowCount': len(row_ids), 'conflicts': conflicts, 'settingConflicts': setting_conflicts, 'captureConflicts': capture_conflicts, 'captureCount': len(capture_ids), 'previewToken': digest([bundle, self.store.state_token()]), 'externalFiles': 'references-only', 'mode': 'replace-selected-tables'}

    def validate_dependencies(self, definitions, all_rows, settings):
        for setting in settings.values():
            key, value = setting['key'], setting['value']
            if key.startswith('relation.'):
                self.relations.validate_relation(value, definitions)
                require(value.get('id') == key.removeprefix('relation.'), 'Relation identity disagrees with its setting key')
            elif key == 'collector.rules' and value is not None:
                if isinstance(value, dict):
                    require(type(value.get('includeDefaults')) is bool, 'Invalid default collection policy')
                    value = value.get('rules')
                require(isinstance(value, list), 'Invalid collection rules')
                for rule in value:
                    require(isinstance(rule, dict) and rule.get('sourceId') in definitions, 'Missing collection rule dependency')
                    require(isinstance(rule.get('dataset'), str) and rule['dataset'], 'Invalid collection rule dataset')
                    require(isinstance(rule.get('identityFields'), list) and rule['identityFields'] and all(isinstance(f, str) and f and not f.startswith('__') for f in rule['identityFields']), 'Invalid collection rule identity')
                    validate_filter(rule.get('screenFilter'))
                    validate_filter(rule.get('urlFilter'))
            elif key == 'dictionary.keys':
                require(isinstance(value, dict) and all(isinstance(v, str) for v in value.values()), 'Invalid key dictionary')
            elif key == 'dictionary.codes':
                require(isinstance(value, dict) and all(isinstance(v, dict) and all(isinstance(label, str) for label in v.values()) for v in value.values()), 'Invalid code dictionary')
            elif key == 'dictionary.hidden':
                require(isinstance(value, list) and all(isinstance(v, str) for v in value), 'Invalid hidden field list')
        from .extension import Extension
        documents = []
        for key, setting in settings.items():
            if key.startswith(Extension.PREFIX) and setting['value'] is not None:
                suffix = key[len(Extension.PREFIX):]
                namespace, separator, document_id = suffix.partition('.')
                require(separator and namespace in Extension.NAMESPACES and document_id and isinstance(setting['value'], dict), 'Invalid extension document backup')
                if namespace == 'hwpx-templates':
                    documents.append({'documentId': document_id, 'value': setting['value']})
        Extension.validate_graph(documents)
        self.store.validate_references(definitions, all_rows)

    def restore_backup(self, payload):
        preview = self.preview_backup(payload)
        if 'previewToken' in payload:
            require(payload['previewToken'] == preview['previewToken'], 'Backup target changed; preview again', 'STALE_VERSION')
        bundle = payload['bundle']
        for table in bundle['tables']:
            definition = table['definition']
            source = definition['sourceId']
            self.store.restore_table(definition, table['rows'])
        for setting in bundle['settings']:
            if setting['key'].startswith('extension.document.'):
                previous = self.store.configuration(setting['key'])
                setting = {**setting, 'storeVersion': max(previous['storeVersion'], setting['storeVersion']) + 1}
            self.store.restore_configuration(setting)
        for relation in self.relations.list_relations({}):
            self.relations.validate_relation(relation)
        for capture in bundle.get('captures', []):
            self.store.capture_restore(capture)
        self.store.log('backup.restore', preview)
        return preview


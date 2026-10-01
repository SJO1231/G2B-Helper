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


class Tables:
    def __init__(self, store):
        self.store = store

    def displayed_definition(self, source):
        definition = self.store.definition(source)
        labels = self.store.configuration('dictionary.keys')['value'] or {}
        codes = self.store.configuration('dictionary.codes')['value'] or {}
        hidden = self.store.configuration('dictionary.hidden')['value'] or []
        for column in definition['columns']:
            field = column['field']
            if field in labels and column.get('label', field) == field:
                column['label'] = labels[field]
            if field in codes:
                column['values'] = {**codes[field], **column.get('values', {})}
            if field in hidden:
                column['hidden'] = True
        return definition

    def read_table(self, payload):
        source = payload['sourceId']
        definition = self.displayed_definition(source)
        expression = payload.get('filter')
        validate_filter(expression)
        rows = [r for r in self.store.rows(source) if matches(r, expression, definition['columns'])]
        offset, limit = payload.get('offset', 0), payload.get('limit', 200)
        require(isinstance(offset, int) and offset >= 0 and isinstance(limit, int) and 0 < limit <= 10000, 'Invalid page bounds')
        return {**definition, 'rows': rows[offset:offset + limit], 'rowCount': len(rows), 'offset': offset, 'hasMore': offset + limit < len(rows)}

    def configure_table(self, payload):
        definition = self.store.definition(payload['sourceId'])
        if 'storeVersion' in payload:
            require(payload['storeVersion'] == definition['storeVersion'], 'Table configuration changed', 'STALE_VERSION')
        result = self.store.configure(**{k: v for k, v in {'source': payload['sourceId'], 'columns': payload.get('columns'), 'duplicatePolicy': payload.get('duplicatePolicy')}.items()})
        self.store.log('table.configure', {'sourceId': payload['sourceId']})
        return result

    def create_dataset(self, payload):
        require(isinstance(payload.get('name'), str) and payload['name'].strip(), 'Dataset name required')
        source = 'dataset.' + str(uuid.uuid4())
        definition = self.store.create(source, payload['name'], payload['columns'], group='dataset', duplicate_policy=payload.get('duplicatePolicy'))
        results = self.commit_grid({'sourceId': source, 'changes': {'added': payload.get('rows', []), 'updated': [], 'deleted': []}})
        return {**definition, 'rowCount': len(results['rows'])}

    def commit_grid(self, payload):
        source = payload['sourceId']
        definition = self.store.definition(source)
        if 'tableVersion' in payload:
            require(payload['tableVersion'] == definition['storeVersion'], 'Table configuration changed; reload before saving', 'STALE_VERSION')
        changes = payload['changes']
        require(isinstance(changes, dict), 'Invalid edit batch')
        for category in ('added', 'updated', 'deleted'):
            require(isinstance(changes.get(category, []), list), 'Invalid edit category')
        if 'columns' in changes:
            require('tableVersion' in payload, 'Column import requires the observed tableVersion', 'STALE_VERSION')
            columns = changes['columns']
            validate_columns(columns)
            existing = definition['columns']
            displayed = self.displayed_definition(source)['columns']
            require(len(columns) >= len(existing) and all(columns[i] == original or columns[i] == displayed[i] for i, original in enumerate(existing)), 'Grid import may only append columns; existing definitions must remain unchanged')
            additions = columns[len(existing):]
            if additions:
                # Store only approved additions, never presentation overlays. The
                # Gateway transaction rolls this back if any row fails to save.
                definition = self.store.configure(source, columns=existing + additions)
        policy = definition['duplicatePolicy']
        modified = []
        touched = [x['rowId'] for category in ('updated', 'deleted') for x in changes.get(category, [])]
        require(len(touched) == len(set(touched)), 'A row cannot be edited twice in one batch')
        for deleted in changes.get('deleted', []):
            self.store.remove(source, deleted['rowId'], deleted['storeVersion'])
        for update in changes.get('updated', []):
            modified.append(self.store.update(source, update['rowId'], update['storeVersion'], update['values']))
        skipped = 0
        for content in changes.get('added', []):
            existing = []
            keys = policy.get('keys', [])
            if policy['mode'] != 'allow' and all(not empty(content.get(k)) for k in keys):
                existing = [r for r in self.store.rows(source) if all(r.get(k) == content.get(k) for k in keys)]
            if existing and policy['mode'] == 'skip':
                skipped += 1
                continue
            require(not existing, 'Duplicate requires comparison; use capture review or edit existing row', 'DUPLICATE')
            modified.append(self.store.insert(source, content))
        if policy['mode'] != 'allow':
            keys = policy.get('keys', [])
            seen = set()
            for row in self.store.rows(source):
                if any(empty(row.get(k)) for k in keys):
                    continue
                key = dumps([row.get(k) for k in keys])
                require(key not in seen, 'Edit creates duplicate identity', 'DUPLICATE')
                seen.add(key)
        self.store.validate_references()
        self.store.log('grid.commit', {'sourceId': source, 'changed': len(modified), 'deleted': len(changes.get('deleted', []))})
        return {'rows': modified, 'skipped': skipped, 'deleted': len(changes.get('deleted', [])), 'storeVersion': definition['storeVersion']}

    def save_settings(self, payload):
        key = payload['key']
        require(isinstance(key, str) and key and not key.startswith('relation.'), 'Invalid setting key; relations use relation.save')
        if key == 'collector.rules' and payload['value'] is not None:
            value = payload['value']
            if isinstance(value, dict):
                require(type(value.get('includeDefaults')) is bool, 'includeDefaults must be boolean')
                value = value.get('rules')
            require(isinstance(value, list), 'Collection rules must be a list')
            for rule in value:
                require(isinstance(rule, dict), 'Invalid collection rule')
                self.store.definition(rule['sourceId'])
                require(isinstance(rule.get('dataset'), str) and rule['dataset'].strip(), 'Rule dataset required')
                require(isinstance(rule.get('identityFields'), list) and rule['identityFields'] and all(isinstance(f, str) and f.strip() and not f.startswith('__') for f in rule['identityFields']) and len(set(rule['identityFields'])) == len(rule['identityFields']), 'Rule identity required')
                require('enabled' not in rule or isinstance(rule['enabled'], bool), 'Rule enabled must be boolean')
                validate_filter(rule.get('screenFilter'))
                validate_filter(rule.get('urlFilter'))
        elif key in ('dictionary.keys', 'dictionary.codes'):
            require(isinstance(payload['value'], dict), 'Dictionary must be an object')
            if key == 'dictionary.keys':
                require(all(isinstance(v, str) for v in payload['value'].values()), 'Key labels must be text')
            else:
                require(all(isinstance(v, dict) and all(isinstance(label, str) for label in v.values()) for v in payload['value'].values()), 'Code dictionaries must map values to text labels')
        elif key == 'dictionary.hidden':
            require(isinstance(payload['value'], list) and all(isinstance(v, str) for v in payload['value']), 'Hidden fields must be a list')
        elif key == 'ui.appearance':
            require(isinstance(payload['value'], dict) and payload['value'].get('theme') in ('light', 'dark'), 'Theme must be light or dark')
        return self.store.save_configuration(key, payload['value'], payload.get('storeVersion'))


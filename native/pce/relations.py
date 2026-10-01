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


class Relations:
    def __init__(self, store):
        self.store = store

    def list_relations(self, payload):
        return [{**entry['value'], 'storeVersion': entry['storeVersion']} for entry in self.store.configurations('relation.')]

    def validate_relation(self, definition, definitions=None):
        require(isinstance(definition, dict) and isinstance(definition.get('name'), str), 'Invalid relation')
        left = definitions.get(definition['leftSourceId']) if definitions is not None else self.store.definition(definition['leftSourceId'])
        right = definitions.get(definition['rightSourceId']) if definitions is not None else self.store.definition(definition['rightSourceId'])
        require(left is not None and right is not None, 'Missing relation table dependency')
        require(definition.get('cardinality') in ('one', 'many'), 'Invalid relationship cardinality')
        pairs = definition.get('fieldPairs')
        require(isinstance(pairs, list) and pairs, 'Relation needs field pairs')
        for pair in pairs:
            require(isinstance(pair, dict) and pair.get('left') in {c['field'] for c in left['columns']} and pair.get('right') in {c['field'] for c in right['columns']}, 'Relation references unknown column')
        validate_filter(definition.get('filter'))

    def preview_relation(self, definition):
        self.validate_relation(definition)
        output = []
        totals = {'matched': 0, 'missing': 0, 'ambiguous': 0}
        right_definition = self.store.definition(definition['rightSourceId'])
        rights = self.store.rows(definition['rightSourceId'])
        for left in self.store.rows(definition['leftSourceId']):
            joined = [right for right in rights if all(not empty(left.get(pair['left'])) and not empty(right.get(pair['right'])) and left[pair['left']] == right[pair['right']] for pair in definition['fieldPairs']) and matches(right, definition.get('filter'), right_definition['columns'])]
            status = 'missing' if not joined else 'ambiguous' if len(joined) > 1 and definition['cardinality'] == 'one' else 'matched'
            totals[status] += 1
            output.append({'left': left, 'right': joined, 'status': status})
        preview_token = digest([definition, self.store.definition(definition['leftSourceId']), right_definition, self.store.rows(definition['leftSourceId']), rights, self.store.configuration('relation.' + definition.get('id', ''))])
        return {'matches': output, **totals, 'previewToken': preview_token}

    def save_relation(self, payload):
        definition = dict(payload['definition'])
        self.validate_relation(definition)
        if 'previewToken' in payload:
            require(payload['previewToken'] == self.preview_relation(definition)['previewToken'], 'Relation or source records changed; preview again', 'STALE_VERSION')
        relation_id = definition.get('id') or str(uuid.uuid4())
        require(isinstance(relation_id, str) and 0 < len(relation_id) <= 200, 'Invalid relation ID')
        definition['id'] = relation_id
        version = definition.pop('storeVersion', None)
        result = self.store.save_configuration('relation.' + relation_id, definition, version)
        self.store.log('relation.save', {'id': relation_id, 'storeVersion': result['storeVersion']})
        return {**definition, 'storeVersion': result['storeVersion']}

    def query_relation(self, payload):
        definition = self.store.configuration('relation.' + payload['id'])['value']
        require(definition is not None, 'Relation not found', 'NOT_FOUND')
        return self.preview_relation(definition)


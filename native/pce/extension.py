"""Extension-owned documents and explicit collection/folder commands.

Uses Store's public operations; no additional physical schema or browser database.
"""
import re
import uuid
from pathlib import Path
from .model import require, digest, dumps, empty, validate_filter, matches, inferred_column
from .folders import downloads_folder


class Extension:
    NAMESPACES = {'notes', 'launchers', 'templates', 'hwpx-templates', 'relations', 'datasets'}
    PREFIX = 'extension.document.'

    def __init__(self, store, tables, collector, reuse):
        self.store, self.tables, self.collector, self.reuse = store, tables, collector, reuse

    def document_key(self, namespace, document_id):
        require(namespace in self.NAMESPACES, 'Unknown extension document namespace')
        require(isinstance(document_id, str) and 0 < len(document_id) <= 200 and not any(ord(c) < 32 for c in document_id), 'Invalid document ID')
        return self.PREFIX + namespace + '.' + document_id

    def list_documents(self, payload):
        namespace = payload.get('namespace')
        require(namespace in self.NAMESPACES, 'Unknown extension document namespace')
        prefix = self.PREFIX + namespace + '.'
        return [{'namespace': namespace, 'documentId': setting['key'][len(prefix):],
                 'storeVersion': setting['storeVersion'], 'value': setting['value']}
                for setting in self.store.configurations(prefix) if setting['value'] is not None]

    @staticmethod
    def validate_graph(documents):
        by_id = {document['documentId']: document['value'] for document in documents}
        for document_id in by_id:
            seen, current = set(), document_id
            while current:
                require(current in by_id, 'Master template is missing', 'REFERENCE_CONFLICT')
                require(current not in seen and len(seen) < 20, 'Template references cycle or exceed 20 levels', 'REFERENCE_CONFLICT')
                seen.add(current)
                value = by_id[current]
                base = value.get('baseTemplateId')
                require(base is None or isinstance(base, str), 'Invalid master template reference')
                require(bool(base) != bool(value.get('masterZip')), 'A HWPX template requires either a master ZIP or a base reference')
                require(not value.get('masterZip') or isinstance(value['masterZip'], str), 'Master ZIP must be base64 text')
                current = base

    def put_document(self, payload):
        namespace, document_id = payload.get('namespace'), payload.get('documentId') or str(uuid.uuid4())
        key = self.document_key(namespace, document_id)
        value = payload.get('value')
        require(isinstance(value, dict), 'Document value must be an object')
        require(len(dumps(value).encode('utf-8')) <= 75 * 1024 * 1024, 'Document exceeds size limit')
        old = self.store.configuration(key)
        expected = payload.get('storeVersion')
        require((expected is None and old['value'] is None) or (type(expected) is int and old['value'] is not None and expected == old['storeVersion']), 'Document changed; reload before saving', 'STALE_VERSION')
        if namespace == 'hwpx-templates':
            documents = self.list_documents({'namespace': namespace})
            expected_ids = payload.get('expectedDocumentIds')
            if expected_ids is not None:
                require(isinstance(expected_ids, list) and all(isinstance(value, str) for value in expected_ids) and len(set(expected_ids)) == len(expected_ids), 'Expected document IDs must be distinct text values')
                require(set(expected_ids) == {document['documentId'] for document in documents}, 'Template list changed; reopen before saving', 'STALE_VERSION')
            references = payload.get('expectedReferences', [])
            require(isinstance(references, list), 'Expected references must be a list')
            for reference in references:
                require(isinstance(reference, dict), 'Invalid expected reference')
                actual = next((d for d in documents if d['documentId'] == reference.get('documentId')), None)
                require(actual is not None and type(reference.get('storeVersion')) is int and actual['storeVersion'] == reference['storeVersion'], 'Master template changed; reopen before saving', 'STALE_VERSION')
            self.validate_graph([d for d in documents if d['documentId'] != document_id] + [{'documentId': document_id, 'value': value}])
        saved = self.store.save_configuration(key, value, old['storeVersion'])
        self.store.log('extension.document.put', {'namespace': namespace, 'documentId': document_id})
        return {'namespace': namespace, 'documentId': document_id, **saved}

    def remove_document(self, payload):
        namespace, document_id = payload.get('namespace'), payload.get('documentId')
        key = self.document_key(namespace, document_id)
        old = self.store.configuration(key)
        require(old['value'] is not None and type(payload.get('storeVersion')) is int and old['storeVersion'] == payload['storeVersion'], 'Document changed; reload before deleting', 'STALE_VERSION')
        if namespace == 'hwpx-templates':
            self.validate_graph([d for d in self.list_documents({'namespace': namespace}) if d['documentId'] != document_id])
        # Keep a tombstone version so delete/recreate cannot revive a stale editor.
        self.store.save_configuration(key, None, old['storeVersion'])
        self.store.log('extension.document.remove', {'namespace': namespace, 'documentId': document_id})
        return {'removed': document_id}

    def register_collector(self, payload):
        capture = payload.get('payload')
        self.collector.validate_payload(capture)
        policy = self.collector.policy()
        require(type(payload.get('policyVersion')) is int and payload['policyVersion'] == policy['storeVersion'], 'Collection policy changed; reload before registering', 'STALE_VERSION')
        dataset, label = payload.get('dataset'), payload.get('label')
        require(isinstance(dataset, str) and dataset.strip() and isinstance(label, str) and label.strip(), 'Dataset and table label required')
        keys = payload.get('identityFields')
        require(isinstance(keys, list) and keys and all(isinstance(k, str) and k and not k.startswith('__') for k in keys) and len(set(keys)) == len(keys), 'Select distinct identity fields before registration')
        for field in ('screenFilter', 'urlFilter'):
            validate_filter(payload.get(field))
        units = capture.get('frames') or [{'framePath': 'top', 'url': capture.get('url', ''), 'pointInfo': capture['pointInfo'], 'tables': capture['tables']}]
        units = [unit for unit in units if (payload.get('framePath') is None or unit.get('framePath') == payload['framePath']) and matches(unit.get('pointInfo', {}), payload.get('screenFilter')) and matches({'url': unit.get('url', '')}, payload.get('urlFilter'))]
        require(len(units) == 1, 'Choose exactly one matching source screen before registration')
        unit = units[0]
        rows = [unit.get('pointInfo', {})] if dataset == '$pointInfo' else unit.get('tables', {}).get(dataset)
        require(isinstance(rows, list) and rows, 'Selected source dataset is empty or missing')
        require(all(all(not empty(row.get(key)) and not isinstance(row[key], (list, dict)) for key in keys) for row in rows), 'Every selected row requires complete scalar identity fields')
        fields = list(dict.fromkeys(field for row in rows for field in row if field and not field.startswith('__')))
        columns = []
        for field in fields:
            values = [row[field] for row in rows if field in row and not empty(row[field])]
            column = inferred_column(field, values[0] if values else '')
            if field in keys:
                column['kind'] = 'text'  # Collector identities are persisted as exact strings.
            elif len({inferred_column(field, value)['kind'] for value in values}) > 1:
                column['kind'] = 'json'
            columns.append(column)
        source = self.store.create('dataset.' + str(uuid.uuid4()), label, columns, group='collection', duplicate_policy=payload.get('duplicatePolicy', {'mode': 'compare', 'keys': keys}))
        source['rowCount'] = 0
        rule = {'sourceId': source['sourceId'], 'dataset': dataset, 'identityFields': keys, 'enabled': True}
        for field in ('screenFilter', 'urlFilter'):
            if payload.get(field) is not None:
                rule[field] = payload[field]
        rules = [*(policy['rules'] or []), rule]
        include_defaults = policy['rules'] is None or policy.get('includeDefaults', False)
        self.tables.save_settings({'key': 'collector.rules', 'value': {'rules': rules, 'includeDefaults': include_defaults}, 'storeVersion': policy['storeVersion']})
        self.store.log('collector.register', {'sourceId': source['sourceId'], 'dataset': dataset})
        return {'source': source, 'rule': rule, 'policy': self.collector.policy()}

    def explorer_context(self, payload):
        source, row_id = payload.get('sourceId'), payload.get('rowId')
        definition = self.store.definition(source) if source and row_id else None
        if definition:
            self.store.row(source, row_id)
        action = payload.get('action', 'list')
        require(action in ('list', 'ensure', 'open'), 'Unknown explorer action')
        configuration = self.store.configuration('explorer.root')['value'] or {}
        require(isinstance(configuration, dict), 'Explorer root setting must contain basePath')
        raw_base = payload.get('basePath') or configuration.get('basePath') or str(downloads_folder())
        require(isinstance(raw_base, str) and raw_base.strip(), 'Invalid folder root')
        base = Path(raw_base).expanduser().resolve()
        require(base.is_dir(), 'Configured root folder does not exist', 'NOT_FOUND')
        label = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', definition['label'] if definition else '').strip(' .')[:50] or '업무'
        folder_name = 'PCE-' + label + '-' + digest([source, row_id])[:24]
        path = (base / folder_name).resolve() if definition else base
        require(path == base or path.parent == base, 'Linked folder resolves outside configured root')
        if definition and action in ('ensure', 'open'):
            path = Path(self.reuse.ensure_folder({'basePath': str(base), 'folderName': folder_name})['path'])
        root = path
        relative = payload.get('relativePath', '')
        require(isinstance(relative, str) and not Path(relative).is_absolute(), 'Folder child must be relative')
        path = (root / relative).resolve()
        require(path == root or root in path.parents, 'Folder child resolves outside linked root')
        if path.is_file():
            require(action == 'open', 'Select a folder to list')
            self.reuse.open_file({'path': str(path)})
            return {'path': str(path), 'opened': True, 'file': True}
        exists = path.is_dir()
        children = sorted(path.iterdir(), key=lambda child: (not child.is_dir(), child.name.casefold())) if exists else []
        entries = [{'name': child.name, 'isDirectory': child.is_dir(), 'size': child.stat().st_size if child.is_file() else None} for child in children[:1000]]
        if action == 'open':
            self.reuse.open_file({'path': str(path)})
        return {'sourceId': source, 'rowId': row_id, 'path': str(path), 'relativePath': relative, 'exists': exists, 'entries': entries, 'hasMore': len(children) > 1000, 'opened': action == 'open'}

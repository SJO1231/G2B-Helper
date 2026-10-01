import sqlite3
import uuid
import gzip
from contextlib import contextmanager
from pathlib import Path
from .model import dumps, loads, require, Fault, validate_columns, validate_record, inferred_column, digest, empty
from .dictionary_seed import DEFAULTS


PRESETS = {
    'procurement.receipt': ('접수', ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd']),
    'procurement.receipt_item': ('접수 물품', ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd', 'ctrtDmndRcptItemSqno']),
    'procurement.bid': ('공고', ['bidPbancNo', 'bidPbancOrd']),
    'procurement.bid_item': ('공고 물품', ['bidPbancNo', 'bidPbancOrd', 'bidClsfNo', 'bidPbancItemSqno']),
    'procurement.contract': ('계약', ['ctrtNo', 'ctrtChgOrd']),
    'procurement.contract_item': ('계약 물품', ['ctrtNo', 'ctrtChgOrd', 'ctrtItemSqno']),
}
REFERENCES = {
    'contacts': ('연락처', ['name', 'organization', 'phone', 'email']),
    'classification': ('물품분류', ['code', 'name']),
    'organizations': ('수요기관', ['code', 'name', 'phone']),
    'memos': ('메모', ['title', 'body', 'sourceId', 'rowId', 'screenKey']),
    'schedules': ('일정', ['title', 'start', 'end', 'sourceId', 'rowId', 'screenKey']),
    'templates': ('템플릿', ['name', 'body', 'masterId']),
    'launchers': ('런처', ['name', 'kind', 'target']),
    'file_links': ('파일 연결', ['name', 'path', 'sourceId', 'rowId']),
}


class Store:
    """Storage boundary: plugins use these operations, never own other plugins' SQL."""
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=10, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO schema_migrations VALUES(1);
        CREATE TABLE IF NOT EXISTS table_definitions(source_id TEXT PRIMARY KEY, definition TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records(row_id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES table_definitions(source_id), store_version INTEGER NOT NULL, content TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS records_source ON records(source_id);
        CREATE TABLE IF NOT EXISTS configurations(key TEXT PRIMARY KEY, store_version INTEGER NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS captures(capture_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, content_hash TEXT NOT NULL, metadata TEXT NOT NULL, compressed BLOB NOT NULL, UNIQUE(event_id,content_hash));
        CREATE TABLE IF NOT EXISTS requests(request_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, response TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail TEXT NOT NULL, occurred_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE VIEW IF NOT EXISTS pce_records AS SELECT row_id,source_id,store_version,content FROM records;
        CREATE VIEW IF NOT EXISTS pce_tables AS SELECT source_id,definition FROM table_definitions;
        ''')
        with self.db:
            for source, (label, fields) in {**PRESETS, **REFERENCES}.items():
                if not self.definition(source, required=False):
                    self.create(source, label, [{'field': f, 'label': f, 'kind': 'text', 'editable': True} for f in fields], 'collection' if source in PRESETS else 'reference', {'mode': 'compare', 'keys': fields} if source in PRESETS else {'mode': 'allow', 'keys': []})
            self.seed_reference_dictionaries()

    def seed_reference_dictionaries(self):
        marker = 'system.dictionarySeed.v41'
        if self.configuration(marker)['value']:
            return
        for key, defaults in [('dictionary.keys', DEFAULTS['KEY_LABELS']), ('dictionary.codes', DEFAULTS['CODE_SEED'])]:
            current = self.configuration(key)
            existing = current['value'] if isinstance(current['value'], dict) else {}
            merged = {**defaults, **existing}
            if key == 'dictionary.codes':
                merged = {field: {**labels, **existing.get(field, {})} for field, labels in defaults.items()}
                merged.update({field: labels for field, labels in existing.items() if field not in defaults})
            self.save_configuration(key, merged, current['storeVersion'])
        self.save_configuration(marker, {'version': 1}, self.configuration(marker)['storeVersion'])

    def activity(self, limit=1000):
        require(type(limit) is int and 1 <= limit <= 10000, 'Activity limit must be 1..10000')
        return [{'id': row['sequence'], 'action': row['action'], 'detail': loads(row['detail']), 'time': row['occurred_at']} for row in self.db.execute('SELECT * FROM audit ORDER BY sequence DESC LIMIT ?', (limit,))]

    def definition(self, source, required=True):
        row = self.db.execute('SELECT definition FROM table_definitions WHERE source_id=?', (source,)).fetchone()
        if required:
            require(row is not None, 'Unknown table: ' + str(source), 'NOT_FOUND')
        return loads(row[0]) if row else None

    @contextmanager
    def transaction(self, write=False):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield

    def create(self, source, label, columns, group='reference', duplicate_policy=None):
        validate_columns(columns)
        definition = {'sourceId': source, 'label': label, 'group': group, 'columns': columns, 'editable': True, 'duplicatePolicy': duplicate_policy or {'mode': 'allow', 'keys': []}, 'storeVersion': 1}
        self.validate_policy(definition['duplicatePolicy'], columns)
        self.db.execute('INSERT INTO table_definitions VALUES(?,?)', (source, dumps(definition)))
        return definition

    def validate_policy(self, policy, columns):
        require(isinstance(policy, dict) and policy.get('mode') in ('allow', 'skip', 'compare'), 'Invalid duplicate policy')
        require(isinstance(policy.get('keys', []), list) and all(k in {c['field'] for c in columns} for k in policy.get('keys', [])), 'Invalid duplicate keys')
        require(policy['mode'] == 'allow' or bool(policy.get('keys')), 'Duplicate comparison requires keys')

    def configure(self, source, columns=None, duplicatePolicy=None, **unused):
        definition = self.definition(source)
        if columns is not None:
            validate_columns(columns)
            old = {c['field'] for c in definition['columns']}
            require(old <= {c['field'] for c in columns}, 'Column removal requires explicit migration')
            for row in self.rows(source):
                validate_record({k: v for k, v in row.items() if not k.startswith('__')}, columns)
            definition['columns'] = columns
        if duplicatePolicy is not None:
            definition['duplicatePolicy'] = duplicatePolicy
        self.validate_policy(definition['duplicatePolicy'], definition['columns'])
        definition['storeVersion'] += 1
        self.db.execute('UPDATE table_definitions SET definition=? WHERE source_id=?', (dumps(definition), source))
        return definition

    def sources(self):
        results = []
        for row in self.db.execute('SELECT definition FROM table_definitions ORDER BY source_id'):
            definition = loads(row[0])
            definition['rowCount'] = self.db.execute('SELECT COUNT(*) FROM records WHERE source_id=?', (definition['sourceId'],)).fetchone()[0]
            results.append(definition)
        return results

    def rows(self, source):
        self.definition(source)
        return [{**loads(r['content']), '__rowId': r['row_id'], '__storeVersion': r['store_version']} for r in self.db.execute('SELECT * FROM records WHERE source_id=? ORDER BY rowid', (source,))]

    def row(self, source, row_id):
        row = self.db.execute('SELECT * FROM records WHERE source_id=? AND row_id=?', (source, row_id)).fetchone()
        require(row is not None, 'Record not found', 'NOT_FOUND')
        return {**loads(row['content']), '__rowId': row['row_id'], '__storeVersion': row['store_version']}

    def insert(self, source, content, row_id=None):
        validate_record(content, self.definition(source)['columns'])
        row_id = row_id or str(uuid.uuid4())
        self.db.execute('INSERT INTO records VALUES(?,?,1,?)', (row_id, source, dumps(content)))
        return self.row(source, row_id)

    def update(self, source, row_id, version, changes):
        current = self.row(source, row_id)
        require(current['__storeVersion'] == version, 'Record changed; compare again', 'STALE_VERSION')
        content = {k: v for k, v in current.items() if not k.startswith('__')}
        content.update(changes)
        validate_record(content, self.definition(source)['columns'])
        self.db.execute('UPDATE records SET content=?,store_version=store_version+1 WHERE row_id=?', (dumps(content), row_id))
        return self.row(source, row_id)

    def remove(self, source, row_id, version):
        current = self.row(source, row_id)
        require(current['__storeVersion'] == version, 'Record changed', 'STALE_VERSION')
        self.db.execute('DELETE FROM records WHERE row_id=?', (row_id,))

    def validate_references(self, definitions=None, all_rows=None):
        """Validate the final graph, after a batch, without cascading deletions.

        Backup preview can supply its proposed graph through this public API.
        Normal writes inspect the transaction's current rows.
        """
        if definitions is None:
            definitions = {d['sourceId']: d for d in self.sources()}
        if all_rows is None:
            row_sources = {row['row_id']: row['source_id'] for row in self.db.execute('SELECT row_id,source_id FROM records')}
            all_rows = {source: self.rows(source) for source in ('memos', 'schedules', 'file_links', 'templates') if source in definitions}
        else:
            row_sources = {row['__rowId']: source for source, rows in all_rows.items() for row in rows}
        for source in ('memos', 'schedules', 'file_links'):
            for row in all_rows.get(source, []):
                linked_source, linked_row = row.get('sourceId'), row.get('rowId')
                require(empty(linked_row) or not empty(linked_source), 'A linked rowId requires sourceId', 'REFERENCE_CONFLICT')
                if not empty(linked_source):
                    require(linked_source in definitions, 'Linked table is missing. Detach the link before removing its target.', 'REFERENCE_CONFLICT')
                    if not empty(linked_row):
                        require(row_sources.get(linked_row) == linked_source, 'Linked record is missing or belongs to another table. Detach linked memos, schedules or file links before deleting the target record.', 'REFERENCE_CONFLICT')
        templates = {row['__rowId']: row for row in all_rows.get('templates', [])}
        for template_id in templates:
            seen, current = set(), template_id
            while not empty(current):
                require(current in templates, 'Master template is missing. Clear its masterId references before deleting the master.', 'REFERENCE_CONFLICT')
                require(current not in seen, 'Template master references form a cycle', 'REFERENCE_CONFLICT')
                seen.add(current)
                current = templates[current].get('masterId')

    def configuration(self, key):
        row = self.db.execute('SELECT * FROM configurations WHERE key=?', (key,)).fetchone()
        return {'value': loads(row['value']), 'storeVersion': row['store_version']} if row else {'value': None, 'storeVersion': 0}

    def save_configuration(self, key, value, version=None):
        old = self.configuration(key)
        require(version is not None or old['storeVersion'] == 0, 'Existing configuration requires storeVersion', 'STALE_VERSION')
        require(version is None or version == old['storeVersion'], 'Configuration changed', 'STALE_VERSION')
        self.db.execute('INSERT INTO configurations VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET store_version=excluded.store_version,value=excluded.value', (key, old['storeVersion'] + 1, dumps(value)))
        return self.configuration(key)

    def configurations(self, prefix=''):
        return [{'key': r['key'], 'value': loads(r['value']), 'storeVersion': r['store_version']} for r in self.db.execute('SELECT * FROM configurations') if r['key'].startswith(prefix)]

    def log(self, action, detail):
        self.db.execute('INSERT INTO audit(action,detail) VALUES(?,?)', (action, dumps(detail)))

    def query_connection(self):
        """Expose only the public query schema, without private storage tables."""
        connection = sqlite3.connect(':memory:')
        try:
            connection.execute('CREATE TABLE pce_records(row_id, source_id, store_version, content)')
            connection.execute('CREATE TABLE pce_tables(source_id, definition)')
            connection.executemany('INSERT INTO pce_records VALUES(?,?,?,?)', self.db.execute('SELECT row_id,source_id,store_version,content FROM records'))
            connection.executemany('INSERT INTO pce_tables VALUES(?,?)', self.db.execute('SELECT source_id,definition FROM table_definitions'))
            connection.commit()
            connection.execute('PRAGMA query_only=ON')
            connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 4 * 1024 * 1024)
            return connection
        except Exception:
            connection.close()
            raise

    def cached_request(self, request_id):
        return self.db.execute('SELECT * FROM requests WHERE request_id=?', (request_id,)).fetchone()

    def cache_request(self, request_id, fingerprint, response):
        self.db.execute('INSERT INTO requests VALUES(?,?,?)', (request_id, fingerprint, dumps(response)))

    def capture_existing(self, event_id, fingerprint):
        row = self.db.execute('SELECT capture_id FROM captures WHERE event_id=? AND content_hash=?', (event_id, fingerprint)).fetchone()
        return row[0] if row else None

    def capture_save(self, capture_id, event_id, fingerprint, metadata, payload):
        self.db.execute('INSERT INTO captures VALUES(?,?,?,?,?)', (capture_id, event_id, fingerprint, dumps(metadata), gzip.compress(dumps(payload).encode('utf-8'))))

    def capture_list(self):
        return [loads(r[0]) for r in self.db.execute('SELECT metadata FROM captures ORDER BY rowid DESC')]

    def capture_read(self, capture_id):
        row = self.db.execute('SELECT metadata,compressed FROM captures WHERE capture_id=?', (capture_id,)).fetchone()
        require(row is not None, 'Capture not found', 'NOT_FOUND')
        return {**loads(row['metadata']), 'payload': loads(gzip.decompress(row['compressed']).decode('utf-8'))}

    def capture_restore(self, capture):
        """Restore archived identity and metadata exactly; no import exclusions."""
        metadata = {key: value for key, value in capture.items() if key != 'payload'}
        self.db.execute('DELETE FROM captures WHERE capture_id=?', (capture['captureId'],))
        self.capture_save(capture['captureId'], capture['eventId'], digest(capture['payload']), metadata, capture['payload'])

    def state_token(self):
        """Version/content token also detects restoring an older saved version."""
        return digest({'tables': self.sources(), 'rows': [(d['sourceId'], self.rows(d['sourceId'])) for d in self.sources()], 'settings': self.configurations(), 'captures': [(r['capture_id'], r['content_hash'], r['metadata']) for r in self.db.execute('SELECT capture_id,content_hash,metadata FROM captures ORDER BY capture_id')]})

    def restore_table(self, definition, rows):
        source = definition['sourceId']
        self.db.execute('DELETE FROM records WHERE source_id=?', (source,))
        self.db.execute('INSERT INTO table_definitions VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET definition=excluded.definition', (source, dumps(definition)))
        for row in rows:
            content = {k: v for k, v in row.items() if not k.startswith('__')}
            self.db.execute('INSERT INTO records VALUES(?,?,?,?)', (row['__rowId'], source, row['__storeVersion'], dumps(content)))

    def restore_configuration(self, setting):
        self.db.execute('INSERT INTO configurations VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET store_version=excluded.store_version,value=excluded.value', (setting['key'], setting['storeVersion'], dumps(setting['value'])))

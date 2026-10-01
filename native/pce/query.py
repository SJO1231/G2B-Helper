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


class Query:
    def __init__(self, store):
        self.store = store

    def execute_sql(self, payload):
        sql = payload['sql']
        require(isinstance(sql, str) and len(sql) <= 100000, 'Invalid SQL')
        started = time.monotonic()
        connection = self.store.query_connection()
        functions = {'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'ifnull', 'nullif', 'abs', 'round', 'length', 'lower', 'upper', 'substr', 'substring', 'trim', 'ltrim', 'rtrim', 'replace', 'instr', 'printf', 'format', 'date', 'datetime', 'strftime', 'julianday', 'unixepoch', 'typeof', 'json_extract', 'json_type', 'json_valid', 'json_array_length', 'json', 'group_concat', 'like', 'glob', 'row_number', 'rank', 'dense_rank', 'iif', 'total'}
        def authorize(action, first, second, database, view):
            if action in (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_RECURSIVE):
                return sqlite3.SQLITE_OK
            if action == sqlite3.SQLITE_READ:
                return sqlite3.SQLITE_OK if first in ('pce_records', 'pce_tables') else sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_FUNCTION:
                return sqlite3.SQLITE_OK if (second or first or '').lower() in functions else sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_DENY
        connection.set_authorizer(authorize)
        connection.set_progress_handler(lambda: int(time.monotonic() - started > 1.5), 1000)
        try:
            cursor = connection.execute(sql)
            names = [c[0] for c in cursor.description or []]
            require(len(names) == len(set(names)), 'SQL column aliases must be unique')
            rows, output_bytes, truncated = [], 0, False
            for row in cursor:
                content = dict(zip(names, row))
                output_bytes += len(dumps(content).encode('utf-8'))
                if len(rows) >= 1000 or output_bytes > 4 * 1024 * 1024:
                    truncated = True
                    break
                rows.append(content)
            return {'columns': [inferred_column(n, rows[0].get(n) if rows else '') for n in names], 'rows': rows, 'rowCount': len(rows), 'metadata': {'truncated': truncated, 'elapsedMs': round((time.monotonic() - started) * 1000)}}
        finally:
            connection.close()

    def search(self, payload):
        text = payload.get('text', '')
        require(isinstance(text, str) and text, 'Search text required')
        results = []
        for definition in self.store.sources():
            for row in self.store.rows(definition['sourceId']):
                if text.casefold() in dumps(row).casefold():
                    results.append({'sourceId': definition['sourceId'], 'label': definition['label'], 'row': row})
                    if len(results) >= 1000:
                        return {'results': results, 'truncated': True}
        return {'results': results, 'truncated': False}


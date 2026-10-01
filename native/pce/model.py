import hashlib
import json
import math
import re
from decimal import Decimal, InvalidOperation


class Fault(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def require(condition, message, code='VALIDATION'):
    if not condition:
        raise Fault(code, message)


def dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def loads(value):
    return json.loads(value, parse_float=str, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))


def digest(value):
    return hashlib.sha256(dumps(value).encode('utf-8')).hexdigest()


def empty(value):
    return value is None or isinstance(value, str) and not value.strip()


def path_value(record, field, path=None):
    value = record.get(field)
    for segment in path or []:
        require(str(segment) not in ('__proto__', 'constructor', 'prototype'), 'Forbidden JSON path')
        if isinstance(value, dict):
            value = value.get(str(segment))
        elif isinstance(value, list) and str(segment).isdigit():
            index = int(segment)
            value = value[index] if index < len(value) else None
        else:
            return None
    return value


OPERATORS = {'equals', 'notEquals', 'contains', 'notContains', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'}


def validate_filter(expression, depth=0):
    if expression is None:
        return
    require(isinstance(expression, dict) and depth <= 12, 'Invalid or excessively nested filter')
    if 'join' in expression:
        require(expression['join'] in ('and', 'or') and isinstance(expression.get('conditions'), list) and len(expression['conditions']) <= 100, 'Invalid filter group')
        for child in expression['conditions']:
            validate_filter(child, depth + 1)
    else:
        require(isinstance(expression.get('field'), str) and expression.get('operator') in OPERATORS, 'Invalid filter condition')
        require(isinstance(expression.get('values', []), list) and len(expression.get('values', [])) <= 1000 and all(isinstance(x, str) for x in expression.get('values', [])), 'Filter values must be text list')
        require(isinstance(expression.get('path', []), list) and all(isinstance(x, str) and x not in ('__proto__', 'constructor', 'prototype') for x in expression.get('path', [])), 'Invalid JSON path')
        require(expression.get('compareAs', 'raw') in ('raw', 'label'), 'Invalid comparison mode')
        if expression['operator'] not in ('empty', 'notEmpty'):
            require(bool(expression.get('values')), 'Filter requires at least one search value')


def matches(record, expression, columns=()):
    if expression is None:
        return True
    if 'join' in expression:
        values = [matches(record, c, columns) for c in expression['conditions']]
        return (all(values) if expression['join'] == 'and' else any(values)) if values else True
    value = path_value(record, expression['field'], expression.get('path'))
    operator = expression['operator']
    if operator == 'empty':
        return empty(value)
    if operator == 'notEmpty':
        return not empty(value)
    if empty(value):
        return bool(expression.get('includeEmpty', False))
    if expression.get('compareAs') == 'label':
        column = next((c for c in columns if c['field'] == expression['field']), {})
        value = column.get('values', {}).get(str(value), value)
    text = ('true' if value else 'false') if isinstance(value, bool) else dumps(value) if isinstance(value, (dict, list)) else str(value)
    needles = expression['values']
    if operator == 'equals':
        return text in needles
    if operator == 'notEquals':
        return text not in needles
    if operator == 'contains':
        return any(n in text for n in needles)
    if operator == 'notContains':
        return all(n not in text for n in needles)
    def compare(needle):
        # Same grammar as TypeScript compareDecimal; exponent/NaN/Infinity
        # strings use lexical comparison instead of Decimal's broader grammar.
        if re.fullmatch(r'[+-]?[0-9]+(?:\.[0-9]*)?', text.strip()) and re.fullmatch(r'[+-]?[0-9]+(?:\.[0-9]*)?', needle.strip()):
            left, right = Decimal(text), Decimal(needle)
        else:
            left, right = text, needle
        return {'gt': left > right, 'gte': left >= right, 'lt': left < right, 'lte': left <= right}[operator]
    return any(compare(n) for n in needles)


KINDS = {'text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'code', 'json'}


def validate_columns(columns):
    require(isinstance(columns, list), 'Columns must be a list')
    seen = set()
    for column in columns:
        require(isinstance(column, dict) and isinstance(column.get('field'), str) and column['field'] and not column['field'].startswith('__'), 'Invalid column field')
        require(column['field'] not in seen and column.get('kind', 'text') in KINDS, 'Duplicate column or invalid type')
        seen.add(column['field'])


def validate_record(record, columns):
    require(isinstance(record, dict), 'Record must be an object')
    definitions = {c['field']: c for c in columns}
    for field, value in record.items():
        require(field in definitions, 'Unknown field: ' + field)
        column = definitions[field]
        if empty(value):
            require(not column.get('required'), 'Required field: ' + field)
            continue
        kind = column.get('kind', 'text')
        if kind == 'integer':
            require(isinstance(value, int) and not isinstance(value, bool), 'Expected integer: ' + field)
        elif kind == 'boolean':
            require(isinstance(value, bool), 'Expected boolean: ' + field)
        elif kind == 'decimal':
            require(isinstance(value, (str, int)) and not isinstance(value, bool), 'Decimal must be exact text: ' + field)
            try:
                require(Decimal(str(value)).is_finite(), 'Invalid decimal: ' + field)
            except InvalidOperation:
                raise Fault('VALIDATION', 'Invalid decimal: ' + field)
        elif kind in ('text', 'code', 'date', 'datetime'):
            require(isinstance(value, str), 'Expected text: ' + field)
    for field, column in definitions.items():
        require(not column.get('required') or not empty(record.get(field)), 'Required field: ' + field)


def inferred_column(field, value):
    kind = 'json' if isinstance(value, (dict, list)) else 'boolean' if isinstance(value, bool) else 'integer' if isinstance(value, int) else 'text'
    return {'field': field, 'label': field, 'kind': kind, 'editable': True}

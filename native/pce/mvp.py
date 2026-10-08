"""Small SQLite owner for the manual G2B Helper MVP. No legacy Store is opened."""
import copy
import json
import sqlite3
import threading
import re
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from urllib.parse import urlparse
from .model import Fault, require, dumps, loads, digest, empty
from .dictionary_seed import DEFAULTS
from .documents import COMMANDS as DOCUMENT_COMMANDS, forward as document_forward

IDENTITIES = {'receipt': ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd'], 'bid': ['bidPbancNo', 'bidPbancOrd'], 'contract': ['ctrtNo', 'ctrtChgOrd']}
SCREENS = {'receipt': ('01001', {'01114', '01117'}), 'bid': ('01173', {'01174'}), 'contract': ('01570', {'01571'})}
ITEM_KEYS = {'receipt': ['ctrtDmndRcptItemSqno'], 'bid': ['bidClsfNo', 'bidPbancItemSqno'], 'contract': ['ctrtItemSqno']}
WRITE = {'mvp.apply', 'mvp.edit', 'mvp.corrections.reset', 'mvp.trash', 'mvp.restore', 'mvp.settings.save'}
CONTRACT_USER_DEFAULTS = {'종결': False, '지정일': '', '종결금액': '', '선금보증기한': '', '선금보증금액': ''}
DERIVED_USER_FIELDS = {'지체일수', '미종결금액'}

def identity_text(value):
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return str(value) if isinstance(value, (str, int)) else None

def belongs_to(row, stage, identity):
    return all(k not in row or absent(row[k]) or identity_text(row[k]) == value for k, value in zip(IDENTITIES[stage], identity))

def default_user_values(stage):
    return copy.deepcopy(CONTRACT_USER_DEFAULTS) if stage == 'contract' else {}

def valid_user_column_keys(keys):
    return isinstance(keys, list) and len(keys) <= 500 and all(isinstance(key, str) and key.strip() for key in keys) and len(set(keys)) == len(keys)

def valid_document_links(links):
    """Per stage and template profile: template field name -> Helper source key (#21)."""
    text = lambda value: isinstance(value, str) and 0 < len(value) <= 200
    return isinstance(links, dict) and all(
        stage in IDENTITIES and isinstance(profiles, dict) and all(
            text(profile) and isinstance(fields, dict) and len(fields) <= 2000 and all(text(name) and text(source) for name, source in fields.items())
            for profile, fields in profiles.items())
        for stage, profiles in links.items())

def default_settings():
    return {'theme': 'light', 'extractionMode': 'tables', 'hideEmptyColumns': True, 'hideUnmappedColumns': False, 'hideEmptyTables': False,
            'dictionary': {'keys': DEFAULTS['KEY_LABELS'], 'values': DEFAULTS['CODE_SEED']}, 'launchers': [],
            'shortcuts': {'collect': 'Alt+Shift+S', 'document': 'Alt+Shift+D'}, 'columnTypes': {}, 'columnLocks': {}, 'userColumns': {}}

def same(left, right):
    return dumps(left) == dumps(right)  # SQLite/Python bool != integer zero.

def absent(value):
    return empty(value) or value == [] or value == {}

def record_id(observation):
    return observation['stage'] + ':' + digest(observation['identity'])[:32]

def valid_screen_rules(rules):
    return (isinstance(rules, list) and len(rules) <= 500 and all(
        isinstance(rule, dict) and rule.get('stage') in IDENTITIES
        and all(isinstance(rule.get(key), str) and rule[key].strip() for key in ('id', 'urlPattern', 'areaCd', 'depth1', 'depth2'))
        and ('depth3' not in rule or isinstance(rule['depth3'], str)) for rule in rules)
        and len({rule['id'] for rule in rules}) == len(rules))


def screen_rule_matches(rule, source):
    pattern = rule['urlPattern']
    url_matches = (re.fullmatch('.*'.join(re.escape(part) for part in pattern.split('*')), source['url'], re.DOTALL) is not None
                   if '*' in pattern else source['url'].startswith(pattern))
    return (url_matches and all(source.get(key) == rule[key] for key in ('areaCd', 'depth1', 'depth2'))
            and (not rule.get('depth3', '').strip() or source.get('depth3') == rule['depth3']))


def validate_observation(observation, screen_rules=None):
    require(isinstance(observation, dict), '수집 자료가 객체여야 합니다.')
    stage = observation.get('stage')
    require(stage in IDENTITIES, '지원하지 않는 업무입니다.')
    identity = observation.get('identity')
    require(isinstance(identity, list) and len(identity) == 2 and all(isinstance(s, str) and s.strip() for s in identity), '업무번호와 차수가 필요합니다.')
    fields = observation.get('fields')
    require(isinstance(fields, dict) and all(isinstance(k, str) for k in fields), '원천 열을 확인하세요.')
    require(all(identity_text(fields.get(k)) == v for k, v in zip(IDENTITIES[stage], identity)), '업무키와 원천 필드가 다릅니다.')
    source = observation.get('source', {})
    require(isinstance(source, dict) and isinstance(source.get('url'), str), '프레임 출처 형식을 확인하세요.', 'SCREEN')
    locator = urlparse(source['url']); host = locator.hostname or ''
    depth1, depth2 = SCREENS[stage]
    require(locator.scheme in ('http', 'https') and (host == 'g2b.go.kr' or host.endswith('.g2b.go.kr')), '등록된 나라장터 URL에서만 수집합니다.', 'SCREEN')
    if screen_rules is None:
        require(source.get('areaCd') == '14' and source.get('depth1') == depth1 and source.get('depth2') in depth2, '등록된 화면 코드에서만 수집합니다.', 'SCREEN')
        if source.get('depth3') and stage in ('bid', 'contract'):
            # Notice/contract management lists (01175/01572) are excluded by default (#17); saved screen rules can add them.
            require(source['depth3'] in ({'01179'} if stage == 'bid' else {'01579'}), '등록되지 않은 하위 화면입니다.', 'SCREEN')
    else:
        matches = {rule['stage'] for rule in screen_rules if screen_rule_matches(rule, source)}
        require(matches == {stage}, '등록된 수집 화면 규칙이 일치하지 않거나 업무가 모호합니다.', 'SCREEN')
    require(isinstance(source.get('framePath'), str), '프레임 출처가 필요합니다.')
    raw = observation.get('rawJson')
    require(isinstance(raw, str) and len(raw.encode('utf-8')) <= 48 * 1024 * 1024, '원본 JSON 크기/형식을 확인하세요.')
    try:
        origin = loads(raw)
    except (ValueError, TypeError):
        raise Fault('VALIDATION', '원본 JSON을 읽을 수 없습니다.')
    require(isinstance(origin, dict), '원본 JSON이 객체여야 합니다.')
    point = origin.get('pointInfo', {})
    require(isinstance(point, dict) and all(point.get(k) == source.get(k) for k in ['areaCd', 'depth1', 'depth2']), '원본과 화면 조건이 다릅니다.', 'SCREEN')
    require(not source.get('depth3') or point.get('depth3') == source['depth3'], '원본 하위 화면 코드가 다릅니다.', 'SCREEN')
    require('url' not in origin or origin['url'] == source['url'], '원본 프레임 URL이 다릅니다.', 'SCREEN')
    require('framePath' not in origin or origin['framePath'] == source['framePath'], '원본 프레임 경로가 다릅니다.', 'SCREEN')
    require(not origin.get('warnings'), '읽기 오류가 있는 원본은 수집하지 않습니다.', 'SCREEN')
    tables = origin.get('tables')
    require(isinstance(tables, dict) and all(isinstance(k, str) and isinstance(rows, list) and all(isinstance(row, dict) for row in rows) for k, rows in tables.items()), '원본 표 형식을 확인하세요.')
    source_rows = [point, *(row for rows in tables.values() for row in rows)]
    relevant = [row for row in source_rows if belongs_to(row, stage, identity)]
    require(any(all(k in row and identity_text(row[k]) == value for k, value in zip(IDENTITIES[stage], identity)) for row in relevant), '원본에 완전한 업무키가 없습니다.')
    require(all(any(field in row and same(row[field], value) for row in relevant) for field, value in fields.items()), '원천 열/값이 해당 업무의 원본 JSON과 다릅니다.')
    children = observation.get('children')
    require(isinstance(children, list) and len(children) <= 500, '하위 표 형식을 확인하세요.')
    seen = set()
    for child in children:
        require(isinstance(child, dict) and isinstance(child.get('key'), str) and child['key'] not in seen, '하위 표 키가 중복되었습니다.')
        seen.add(child['key'])
        require(child.get('kind') in ('items', 'qualification', 'other') and isinstance(child.get('label'), str), '하위 표 분류를 확인하세요.')
        require(isinstance(child.get('rows'), list) and all(isinstance(row, dict) for row in child['rows']), '하위 표 행을 확인하세요.')
        require(child['key'] in tables and all(belongs_to(row, stage, identity) and any(same(row, source_row) for source_row in tables[child['key']]) for row in child['rows']), '하위 표가 해당 업무의 원본 JSON과 다릅니다.')
    require(isinstance(observation.get('capturedAt'), str), '수집 시각이 필요합니다.')
    return observation

def merge_fields(previous, incoming, prefix, rid, conflicts, decisions):
    merged = copy.deepcopy(previous)
    for field, value in incoming.items():
        if field not in merged or absent(merged[field]):
            if not absent(value) or field not in merged:
                merged[field] = copy.deepcopy(value)
        elif absent(value) or same(merged[field], value):
            continue
        else:
            path = field if not prefix else dumps([*prefix, field])
            conflicts.append({'recordId': rid, 'field': path, 'previous': merged[field], 'incoming': value})
            if decisions.get((rid, path), False):
                merged[field] = copy.deepcopy(value)
    return merged

def merge_children(previous, incoming, stage, rid, conflicts, decisions):
    merged = copy.deepcopy(previous)
    for child in incoming:
        old = next((c for c in merged if c['key'] == child['key']), None)
        if old is None:
            merged.append(copy.deepcopy(child)); continue
        if not child['rows']:
            continue
        keys = ITEM_KEYS[stage] if child['kind'] == 'items' else []
        for row in child['rows']:
            if keys and all(not absent(row.get(k)) for k in keys):
                matches = [(index, candidate) for index, candidate in enumerate(old['rows']) if all(same(candidate.get(k), row[k]) for k in keys)]
                require(len(matches) <= 1, '기존 하위 표의 물품키가 중복되어 비교할 수 없습니다.', 'AMBIGUOUS')
                if matches:
                    index, candidate = matches[0]
                    old['rows'][index] = merge_fields(candidate, row, ['children', child['key'], index], rid, conflicts, decisions)
                else:
                    old['rows'].append(copy.deepcopy(row))
            elif not any(same(candidate, row) for candidate in old['rows']):
                old['rows'].append(copy.deepcopy(row))
    return merged

# Item keys per stage, checked against real screen captures (#30): name, quantity, unit, amount, order.
ITEM_SUMMARY = {'receipt': ('dtlsPrnm', 'ctrtDmndQty', 'qtyUntNm', 'ctrtDmndAmt', ['ctrtDmndRcptItemSqno']),
                'bid': ('dtlsPrnmNm', 'prchsDtlItemQty', 'prchsDtlItemUntVal', 'rowAmtSum', ['bidClsfNo', 'bidPbancItemSqno']),
                'contract': ('ctrtItemNm', 'ctrtQty', 'ctrtUntVal', 'ctrtAmt', ['ctrtItemSqno'])}

def decimal_of(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    if not re.fullmatch(r'[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?', text):
        return None
    return Decimal(text.replace(',', ''))

def item_summary(stage, children):
    """Representative item by amount (ties: lower order; no amount: lowest order) and exact totals (user, 2026-10-07, #30)."""
    name, quantity, unit, amount, order = ITEM_SUMMARY[stage]
    rows, seen = [], set()
    for child in children:
        if child.get('kind') != 'items':
            continue
        for row in child['rows']:
            key = dumps([str(row.get(k)) for k in order]) if all(not absent(row.get(k)) for k in order) else None
            if key is not None and key in seen:
                continue
            seen.add(key)
            rows.append(row)
    if not rows:
        return None
    def position(row):
        return tuple((0, decimal_of(row.get(k)), '') if decimal_of(row.get(k)) is not None else (1, Decimal(0), str(row.get(k))) if not absent(row.get(k)) else (2, Decimal(0), '') for k in order)
    ordered = sorted(rows, key=position)
    representative = ordered[0]
    for row in ordered:
        value, best = decimal_of(row.get(amount)), decimal_of(representative.get(amount))
        if value is not None and (best is None or value > best):
            representative = row
    def total(key):
        values = [decimal_of(row.get(key)) for row in rows]
        if any(value is None for value in values):
            return ''
        with localcontext() as context:
            context.prec = sum(len(value.as_tuple().digits) + abs(value.as_tuple().exponent) for value in values) + 10  # exact, never rounded
            return format(sum(values, Decimal(0)), 'f')
    text = lambda value: '' if absent(value) else value if isinstance(value, str) else dumps(value)
    return {'대표 품명': text(representative.get(name)), '대표 단위': text(representative.get(unit)),
            '합계 수량': total(quantity), '합계 금액': total(amount), '품목 수': str(len(rows))}

SUMMARY_COLUMNS = ('대표 품명', '대표 단위', '합계 수량', '합계 금액', '품목 수')

def order_key(order):
    """Business order numbers compare as numbers when they are digits ('00' < '01' < '10')."""
    return (0, int(order), order) if order.isdigit() else (1, 0, order)

def carried_user_values(stage, earlier):
    """User column values a new order takes from the previous order (user, 2026-10-08, #34); summaries are recomputed."""
    values = {key: copy.deepcopy(value) for key, value in earlier['userValues'].items() if key not in SUMMARY_COLUMNS}
    defaults = default_user_values(stage)
    meaningful = any(not absent(value) and not (key in defaults and same(value, defaults[key])) for key, value in values.items())
    return values, meaningful

def with_item_summary(record):
    """Fill the summary user columns when empty or still holding the last automatic value; user edits stay."""
    summary = item_summary(record['stage'], record['children'])
    if summary is None:
        return record
    previous = record.get('summaryValues', {})
    user = dict(record['userValues'])
    for key, value in summary.items():
        if absent(user.get(key)) or (key in previous and same(user.get(key), previous[key])):
            user[key] = value
    if same(user, record['userValues']) and same(summary, previous):
        return record
    return {**record, 'userValues': user, 'summaryValues': summary}

class MvpGateway:
    def __init__(self, filename):
        from pathlib import Path
        Path(filename).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(filename, isolation_level=None, check_same_thread=False)
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA busy_timeout=5000')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.lock = threading.RLock()
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS mvp_records (record_id TEXT PRIMARY KEY, stage TEXT NOT NULL, store_version INTEGER NOT NULL, payload TEXT NOT NULL, deleted_at TEXT);
            CREATE TABLE IF NOT EXISTS mvp_settings (singleton INTEGER PRIMARY KEY CHECK(singleton=1), store_version INTEGER NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS mvp_requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS mvp_stage ON mvp_records(stage);
        ''')
        if 'deleted_at' not in {row[1] for row in self.db.execute('PRAGMA table_info(mvp_records)')}:
            self.db.execute('ALTER TABLE mvp_records ADD COLUMN deleted_at TEXT')
        self.db.execute('INSERT OR IGNORE INTO mvp_settings VALUES(1,1,?)', (dumps(default_settings()),))

    def close(self):
        self.db.close()

    def get(self, rid):
        row = self.db.execute('SELECT payload FROM mvp_records WHERE record_id=?', (rid,)).fetchone()
        return loads(row[0]) if row else None

    def save(self, record):
        self.db.execute('INSERT INTO mvp_records(record_id,stage,store_version,payload,deleted_at) VALUES(?,?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET store_version=excluded.store_version,payload=excluded.payload,deleted_at=excluded.deleted_at',
                        (record['recordId'], record['stage'], record['storeVersion'], dumps(record), record.get('deletedAt')))

    def previous_order(self, stage, identity):
        """The latest earlier order of the same business number outside the trash, if any."""
        rows = self.db.execute("SELECT payload FROM mvp_records WHERE stage=? AND deleted_at IS NULL AND json_extract(payload, '$.identity[0]')=?", (stage, identity[0])).fetchall()
        earlier = [record for record in (loads(row[0]) for row in rows) if order_key(record['identity'][1]) < order_key(identity[1])]
        return max(earlier, key=lambda record: order_key(record['identity'][1]), default=None)

    def compare(self, observations, decisions=None, edits=None):
        require(isinstance(observations, list) and 0 < len(observations) <= 20000, '수집 대상이 없거나 너무 많습니다.')
        # Values the user changed in the extraction table, one entry (or None) per observation (#24).
        require(edits is None or isinstance(edits, list) and len(edits) == len(observations), '고친 값 형식을 확인하세요.')
        decisions = decisions or {}
        conflicts, records, versions, seen, items = [], [], [], set(), []
        counts = {'inserted': 0, 'identical': 0, 'supplemented': 0, 'changed': 0}
        settings = loads(self.db.execute('SELECT payload FROM mvp_settings WHERE singleton=1').fetchone()[0])
        for index, observation in enumerate(observations):
            validate_observation(observation, settings.get('screenRules'))
            incoming = observation['fields']
            change = edits[index] if edits else None
            if change is not None:
                require(isinstance(change, dict) and change and all(key in incoming for key in change), '고친 값은 업무 자료의 원천 열에만 넣을 수 있습니다.')
                require(not set(change) & set(IDENTITIES[observation['stage']]), '업무키는 수정할 수 없습니다.')
                require(not any(settings.get('columnLocks', {}).get(key) is True for key in change), '잠긴 열은 수정할 수 없습니다.', 'LOCKED')
                incoming = {**incoming, **copy.deepcopy(change)}
            rid = record_id(observation)
            require(rid not in seen, '한 요청에 같은 업무키가 여러 번 있습니다.', 'AMBIGUOUS')
            seen.add(rid)
            previous = self.get(rid)
            require(previous is None or not previous.get('deletedAt'), '휴지통의 자료입니다. 먼저 복원한 뒤 수집하세요.', 'TRASHED')
            versions.append((rid, previous['storeVersion'] if previous else None))
            if previous is None:
                # A new order keeps the screen's source values and takes the user columns of the previous order, which stays (#34).
                user, carried, earlier = default_user_values(observation['stage']), False, self.previous_order(observation['stage'], observation['identity'])
                if earlier is not None:
                    versions.append((earlier['recordId'], earlier['storeVersion']))
                    values, carried = carried_user_values(observation['stage'], earlier)
                    user = {**user, **values}
                records.append(with_item_summary({**copy.deepcopy(observation), 'fields': copy.deepcopy(incoming), 'sourceFields': copy.deepcopy(incoming), 'overrides': {}, 'recordId': rid, 'storeVersion': 1, 'userValues': user}))
                counts['inserted'] += 1; items.append({'recordId': rid, 'status': 'inserted', **({'carriedFrom': earlier['identity'][1]} if carried else {})}); continue
            before_conflicts = len(conflicts)
            # 당초값 (last collected) and 정정값 (user corrections) are kept apart (#36). A record stored before this keeps
            # its stored view as the baseline: its earlier edits cannot be told apart from collected values.
            source_fields = previous.get('sourceFields', previous['fields'])
            overrides = copy.deepcopy(previous.get('overrides', {}))
            fields = merge_fields(source_fields, {k: v for k, v in incoming.items() if k not in overrides}, [], rid, conflicts, decisions)
            for field in list(overrides):
                # A corrected cell asks only when the screen differs from 당초값; 당초값 becomes the screen value either way.
                if field not in incoming or absent(incoming[field]) or same(incoming[field], source_fields.get(field)):
                    continue
                conflicts.append({'recordId': rid, 'field': field, 'previous': copy.deepcopy(source_fields.get(field)), 'incoming': copy.deepcopy(incoming[field]), 'override': copy.deepcopy(overrides[field])})
                fields[field] = copy.deepcopy(incoming[field])
                if decisions.get((rid, field), False):
                    overrides.pop(field)
            children = merge_children(previous['children'], observation['children'], observation['stage'], rid, conflicts, decisions)
            corrected = sum(1 for conflict in conflicts[before_conflicts:] if 'override' in conflict)
            plain = len(conflicts) - before_conflicts - corrected
            changed = not same(fields, source_fields) or not same(children, previous['children']) or not same(overrides, previous.get('overrides', {}))
            # Corrected cells are not counted as "different" for 화면대로/DB대로 (user, 2026-10-08).
            status = 'changed' if plain else 'supplemented' if changed else 'identical'
            counts[status] += 1; items.append({'recordId': rid, 'status': status, **({'corrections': corrected} if corrected else {})})
            merged = {**previous, **({'fields': {**fields, **copy.deepcopy(overrides)}, 'sourceFields': fields, 'overrides': overrides, 'children': children, 'rawJson': observation['rawJson'], 'source': observation['source'], 'capturedAt': observation['capturedAt'], 'storeVersion': previous['storeVersion'] + 1} if changed else {})}
            summarized = with_item_summary(merged)
            records.append({**summarized, 'storeVersion': previous['storeVersion'] + 1} if summarized is not merged and not changed else summarized)
        token = {'observations': observations, 'versions': versions, **({'edits': edits} if edits is not None else {})}
        return {'token': digest(token), 'observations': observations, 'conflicts': conflicts, 'counts': counts, 'items': items}, records

    def dispatch(self, command, payload):
        if command == 'mvp.health':
            return {'connected': True, 'storage': 'SQLite', 'protocolVersion': 1}
        if command == 'mvp.records':
            require(payload.get('stage') in IDENTITIES, '업무 종류를 확인하세요.')
            require('trashed' not in payload or type(payload['trashed']) is bool, '휴지통 조회는 체크값이어야 합니다.')
            query = 'SELECT payload FROM mvp_records WHERE stage=? AND deleted_at IS ' + ('NOT NULL' if payload.get('trashed', False) else 'NULL') + ' ORDER BY record_id'
            return [loads(row[0]) for row in self.db.execute(query, (payload['stage'],))]
        if command in ('mvp.trash', 'mvp.restore'):
            changes = payload.get('records')
            require(isinstance(changes, list) and 0 < len(changes) <= 20000, '이동할 행이 없거나 너무 많습니다.')
            require(all(isinstance(change, dict) and isinstance(change.get('recordId'), str) and type(change.get('storeVersion')) is int for change in changes), '행 번호와 저장 버전을 확인하세요.')
            require(len({change['recordId'] for change in changes}) == len(changes), '이동할 행이 중복되었습니다.')
            timestamp = datetime.now(timezone.utc).isoformat()
            for change in changes:
                previous = self.get(change['recordId'])
                require(previous is not None, '이동할 자료가 없습니다.')
                require(previous['storeVersion'] == change['storeVersion'], '자료가 다른 창에서 바뀌었습니다. 다시 조회하세요.', 'STALE')
                require(bool(previous.get('deletedAt')) == (command == 'mvp.restore'), '자료의 휴지통 상태가 바뀌었습니다. 다시 조회하세요.', 'STALE')
                record = {**previous, 'storeVersion': previous['storeVersion'] + 1}
                if command == 'mvp.trash':
                    record['deletedAt'] = timestamp
                else:
                    record.pop('deletedAt', None)
                self.save(record)
            return {'count': len(changes)}
        if command == 'mvp.preview':
            return self.compare(payload.get('observations'), None, payload.get('edits'))[0]
        if command == 'mvp.apply':
            choices = payload.get('decisions', [])
            require(isinstance(choices, list) and all(isinstance(c, dict) and isinstance(c.get('recordId'), str) and isinstance(c.get('field'), str) and isinstance(c.get('useIncoming'), bool) for c in choices), '충돌 선택 형식을 확인하세요.')
            decisions = {(c['recordId'], c['field']): c['useIncoming'] for c in choices}
            require(len(decisions) == len(choices), '중복 충돌 선택입니다.')
            preview, records = self.compare(payload.get('observations'), decisions, payload.get('edits'))
            require(payload.get('token') == preview['token'], '자료가 바뀌었습니다. 다시 비교하세요.', 'STALE')
            expected = {(c['recordId'], c['field']) for c in preview['conflicts']}
            require(set(decisions) == expected, '각 충돌에 유지/반영을 선택하세요.')
            for record in records:
                self.save(record)
            return {'records': records, 'counts': preview['counts']}
        if command == 'mvp.corrections.reset':
            changes = payload.get('records')
            require(isinstance(changes, list) and 0 < len(changes) <= 20000, '정정을 취소할 행이 없거나 너무 많습니다.')
            require(all(isinstance(change, dict) and isinstance(change.get('recordId'), str) for change in changes), '행 번호를 확인하세요.')
            require(len({change['recordId'] for change in changes}) == len(changes), '정정을 취소할 행이 중복되었습니다.')
            locks = loads(self.db.execute('SELECT payload FROM mvp_settings WHERE singleton=1').fetchone()[0]).get('columnLocks', {})
            records = []
            for change in changes:
                previous = self.get(change['recordId'])
                require(previous is not None, '정정을 취소할 자료가 없습니다.')
                require(not previous.get('deletedAt'), '휴지통 자료는 먼저 복원하세요.', 'TRASHED')
                require(type(change.get('storeVersion')) is int and change['storeVersion'] == previous['storeVersion'], '다른 창에서 수정되었습니다. 입력을 유지하고 재조회하세요.', 'STALE')
                selected = change.get('fields')
                require(isinstance(selected, list) and selected and all(isinstance(field, str) for field in selected) and len(set(selected)) == len(selected) and set(selected) <= set(previous['fields']), '취소할 원천 열을 확인하세요.')
                require(not set(selected) & set(IDENTITIES[previous['stage']]), '업무키는 수정할 수 없습니다.')
                require(not any(locks.get(field) is True for field in selected), '잠긴 열은 정정을 취소할 수 없습니다.', 'LOCKED')
                source_fields = copy.deepcopy(previous.get('sourceFields', previous['fields']))
                overrides, fields = copy.deepcopy(previous.get('overrides', {})), copy.deepcopy(previous['fields'])
                for field in selected:
                    overrides.pop(field, None)
                    fields[field] = copy.deepcopy(source_fields.get(field))
                record = previous
                if not same(fields, previous['fields']) or not same(overrides, previous.get('overrides', {})):
                    record = {**previous, 'fields': fields, 'sourceFields': source_fields, 'overrides': overrides, 'storeVersion': previous['storeVersion'] + 1}
                    self.save(record)
                records.append(record)
            return records
        if command == 'mvp.edit':
            changes = payload.get('records')
            column_change = payload.get('userColumns')
            if 'userColumns' in payload:
                require(isinstance(column_change, dict) and isinstance(column_change.get('stage'), str) and column_change['stage'] in IDENTITIES, '사용자 열의 업무를 확인하세요.')
                require(valid_user_column_keys(column_change.get('keys')), '사용자 열 이름은 중복 없는 문자열 목록이어야 합니다.')
                require(type(column_change.get('settingsStoreVersion')) is int, '설정 버전은 정수여야 합니다.')
            require(isinstance(changes, list) and (changes or column_change is not None), '저장할 행이 없습니다.')
            require(all(isinstance(c, dict) for c in changes), '수정 행이 객체여야 합니다.')
            require(len({c.get('recordId') for c in changes if isinstance(c, dict)}) == len(changes), '수정 행이 중복되었습니다.')
            records = []
            settings = loads(self.db.execute('SELECT payload FROM mvp_settings WHERE singleton=1').fetchone()[0])
            locks = settings.get('columnLocks', {})
            for change in changes:
                previous = self.get(change.get('recordId', ''))
                require(previous is not None, '수정할 자료가 없습니다.')
                require(not previous.get('deletedAt'), '휴지통 자료는 먼저 복원하세요.', 'TRASHED')
                require(column_change is None or previous['stage'] == column_change['stage'], '다른 업무의 행과 사용자 열을 함께 저장할 수 없습니다.')
                require(type(change.get('storeVersion')) is int and change['storeVersion'] == previous['storeVersion'], '다른 창에서 수정되었습니다. 입력을 유지하고 재조회하세요.', 'STALE')
                fields, user = change.get('fields'), change.get('userValues')
                require(isinstance(fields, dict) and isinstance(user, dict), '수정 열을 확인하세요.')
                require(set(fields) == set(previous['fields']), '원천 열의 추가/삭제는 허용하지 않습니다.')
                require(all(same(fields.get(k), previous['fields'].get(k)) for k in IDENTITIES[previous['stage']]), '업무키는 수정할 수 없습니다.')
                require(not DERIVED_USER_FIELDS.intersection(user), '계산 열은 저장하지 않습니다.')
                if previous['stage'] == 'contract':
                    require(isinstance(user.get('종결', False), bool), '종결은 체크값이어야 합니다.')
                    require(all(isinstance(user.get(k, ''), str) for k in ('지정일', '선금보증기한')), '사용자 날짜는 원래 입력 문자열로 저장합니다.')
                    require(all(isinstance(user.get(k, ''), (str, int)) and not isinstance(user.get(k, ''), bool) for k in ('종결금액', '선금보증금액')), '사용자 금액은 정확한 문자열 또는 정수여야 합니다.')
                    user = {**default_user_values('contract'), **user}
                else:
                    require('종결' not in user, '종결은 계약에만 있습니다.')
                for field, locked in locks.items():
                    if not locked:
                        continue
                    require((field in fields) == (field in previous['fields']) and same(fields.get(field), previous['fields'].get(field))
                            and (field in user) == (field in previous.get('userValues', {})) and same(user.get(field), previous.get('userValues', {}).get(field)),
                            '잠긴 열은 수정할 수 없습니다: ' + field, 'LOCKED')
                # Cells that differ from 당초값 are the user's corrections (#36).
                source_fields = copy.deepcopy(previous.get('sourceFields', previous['fields']))
                overrides = {field: copy.deepcopy(value) for field, value in fields.items() if not same(value, source_fields.get(field))}
                record = {**previous, 'fields': fields, 'sourceFields': source_fields, 'overrides': overrides, 'userValues': user, 'storeVersion': previous['storeVersion'] + 1}
                self.save(record); records.append(record)
            if column_change is not None:
                settings = loads(self.db.execute('SELECT payload FROM mvp_settings WHERE singleton=1').fetchone()[0])
                settings['userColumns'] = {**settings.get('userColumns', {}), column_change['stage']: copy.deepcopy(column_change['keys'])}
                cursor = self.db.execute('UPDATE mvp_settings SET store_version=store_version+1,payload=? WHERE singleton=1 AND store_version=?',
                                         (dumps(settings), column_change['settingsStoreVersion']))
                require(cursor.rowcount == 1, '사용자 열 설정이 다른 창에서 바뀌었습니다. 입력을 유지하고 재조회하세요.', 'STALE')
            return records
        if command == 'mvp.settings.read':
            row = self.db.execute('SELECT store_version,payload FROM mvp_settings').fetchone()
            return {'storeVersion': row[0], 'settings': loads(row[1])}
        if command == 'mvp.settings.save':
            settings = payload.get('settings', {})
            require(isinstance(settings, dict), '설정이 객체여야 합니다.')
            require(settings.get('theme') in ('light', 'dark') and settings.get('extractionMode') in ('tables', 'all'), '표시 설정을 확인하세요.')
            require(all(isinstance(settings.get(k), bool) for k in ('hideEmptyColumns', 'hideUnmappedColumns')), '숨김 설정은 체크값이어야 합니다.')
            require('hideEmptyTables' not in settings or type(settings['hideEmptyTables']) is bool, '빈 표 숨김은 체크값이어야 합니다.')
            dictionary = settings.get('dictionary', {})
            require(isinstance(dictionary, dict), '키/값 사전이 객체여야 합니다.')
            require(isinstance(dictionary.get('keys'), dict) and all(isinstance(v, str) for v in dictionary['keys'].values()), '키 사전을 확인하세요.')
            require(isinstance(dictionary.get('values'), dict) and all(isinstance(v, dict) and all(isinstance(t, str) for t in v.values()) for v in dictionary['values'].values()), '값 사전을 확인하세요.')
            require(isinstance(settings.get('launchers'), list) and all(isinstance(c, dict) and all(isinstance(c.get(k), str) for k in ('id', 'label', 'script')) for c in settings['launchers']), '런처를 확인하세요.')
            require(isinstance(settings.get('columnTypes', {}), dict) and all(isinstance(v, str) and v in ('text', 'number', 'money', 'percent', 'date', 'datetime', 'boolean') for v in settings.get('columnTypes', {}).values()), '열 타입을 확인하세요.')
            formats = settings.get('columnFormats', {})
            require(isinstance(formats, dict) and all(isinstance(value, dict) and set(value) <= {'decimals', 'grouping', 'dateFormat'}
                    and ('decimals' not in value or type(value['decimals']) is int and 0 <= value['decimals'] <= 20)
                    and ('grouping' not in value or type(value['grouping']) is bool)
                    and ('dateFormat' not in value or isinstance(value['dateFormat'], str) and value['dateFormat'] in ('dot', 'dash', 'compact')) for value in formats.values()), '열 서식을 확인하세요.')
            require(isinstance(settings.get('columnLocks', {}), dict) and all(isinstance(key, str) and type(value) is bool for key, value in settings.get('columnLocks', {}).items()), '열 잠금은 체크값 목록이어야 합니다.')
            require('screenRules' not in settings or valid_screen_rules(settings['screenRules']), '수집 화면 규칙을 확인하세요.')
            require(isinstance(settings.get('documentProfiles', {}), dict) and all(k in IDENTITIES and isinstance(v, str) and 0 < len(v) <= 200 for k, v in settings.get('documentProfiles', {}).items()), '업무별 문서 서식을 확인하세요.')
            require(valid_document_links(settings.get('documentLinks', {})), '업무·서식별 필드 연결을 확인하세요.')
            require(isinstance(settings.get('shortcuts', {}), dict) and all(k in ('extract', 'collect', 'db', 'document', 'launcher') and isinstance(v, str) for k, v in settings.get('shortcuts', {}).items()), '단축키를 확인하세요.')
            require(isinstance(settings.get('userColumns', {}), dict) and all(stage in IDENTITIES and valid_user_column_keys(columns) for stage, columns in settings.get('userColumns', {}).items()), '사용자 열 설정을 확인하세요.')
            require(all(key not in settings or isinstance(settings[key], str) and settings[key].strip() for key in ('contractEndField', 'contractAmountField')), '계약 계산 기준 열을 확인하세요.')
            require(type(payload.get('storeVersion')) is int, '설정 버전은 정수여야 합니다.')
            cursor = self.db.execute('UPDATE mvp_settings SET store_version=store_version+1,payload=? WHERE singleton=1 AND store_version=?', (dumps(settings), payload.get('storeVersion')))
            require(cursor.rowcount == 1, '설정이 다른 창에서 바뀌었습니다. 다시 여세요.', 'STALE')
            return self.dispatch('mvp.settings.read', {})
        raise Fault('COMMAND', '등록되지 않은 명령입니다.')

    def handle(self, request):
        rid = request.get('requestId', '') if isinstance(request, dict) else ''
        response = {'protocolVersion': 1, 'requestId': rid}
        try:
            require(isinstance(request, dict) and type(request.get('protocolVersion')) is int and request['protocolVersion'] == 1 and isinstance(rid, str) and 0 < len(rid) <= 200, '요청 버전/번호를 확인하세요.')
            command, payload = request.get('command'), request.get('payload')
            require(isinstance(command, str) and isinstance(payload, dict), '명령/본문 형식을 확인하세요.')
            if command in DOCUMENT_COMMANDS:
                # No Helper write transaction is held while the generator runs.
                response['result'] = document_forward(command, payload, rid)
                return response
            with self.lock:
                fingerprint = digest(request)
                cached = self.db.execute('SELECT fingerprint,response FROM mvp_requests WHERE request_id=?', (rid,)).fetchone()
                if cached:
                    require(cached[0] == fingerprint, '같은 요청 번호에 다른 내용이 들어왔습니다.', 'REQUEST_ID')
                    return loads(cached[1])
                self.db.execute('BEGIN IMMEDIATE' if command in WRITE else 'BEGIN')
                try:
                    response['result'] = self.dispatch(command, payload)
                    if command in WRITE:
                        self.db.execute('INSERT INTO mvp_requests VALUES(?,?,?)', (rid, fingerprint, dumps(response)))
                    self.db.execute('COMMIT')
                except Exception:
                    self.db.execute('ROLLBACK'); raise
        except Fault as error:
            response['error'] = {'code': error.code, 'message': str(error)}
        except (TypeError, ValueError, KeyError, sqlite3.Error) as error:
            response['error'] = {'code': 'VALIDATION', 'message': str(error)}
        return response

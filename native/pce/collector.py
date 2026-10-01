import gzip
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit
from .model import dumps, loads, digest, empty, require, Fault, inferred_column, matches, validate_filter
from .store import PRESETS


IDENTITIES = {
    'receipt': ['ctrtDmndRcptNo', 'ctrtDmndRcptOrd'],
    'bid': ['bidPbancNo', 'bidPbancOrd'],
    'contract': ['ctrtNo', 'ctrtChgOrd'],
}
ITEMS = {'receipt': ['ctrtDmndRcptItemSqno'], 'bid': ['bidClsfNo', 'bidPbancItemSqno'], 'contract': ['ctrtItemSqno']}


def dataset_name(unit, name):
    if name in unit.get('tables', {}):
        return name
    aliases = [key for key, source in unit.get('tableSources', {}).items()
               if key in unit.get('tables', {}) and name in (source.get('componentId'), source.get('originalId'))]
    return aliases[0] if len(aliases) == 1 else None


class Collector:
    def __init__(self, store):
        self.store = store

    def policy(self):
        configuration = self.store.configuration('collector.rules')
        value = configuration['value']
        return {'version': 1, 'storeVersion': configuration['storeVersion'], 'rules': value.get('rules') if isinstance(value, dict) else value,
                **({'includeDefaults': value.get('includeDefaults', False)} if isinstance(value, dict) else {})}

    def collect_bundle(self, bundle, policy_version):
        policy = self.policy()
        require(type(policy_version) is int and policy_version == policy['storeVersion'],
                '수집 정책이 변경되었습니다. 정책을 다시 읽고 수집하세요.', 'STALE_VERSION')
        require(isinstance(bundle, dict) and bundle.get('format') == 'pce-transfer' and bundle.get('version') == 1,
                'Unsupported transfer format/version')
        events = bundle.get('captures')
        require(isinstance(events, list) and events, 'Transfer has no captures')
        scoped_events = []
        # Scope every event before import_bundle performs the first raw insert.
        for event in events:
            require(isinstance(event, dict), 'Invalid capture event')
            require(event.get('purpose', 'collection') == 'collection', 'capture.collect accepts collection events only')
            self.validate_payload(event.get('payload'))
            scoped = self.scope_payload(event['payload'], policy['rules'], policy.get('includeDefaults', False))
            scoped_events.append({**event, 'payload': scoped})
        return self.import_bundle({**bundle, 'captures': scoped_events})

    @staticmethod
    def scope_payload(payload, rules=None, include_defaults=False):
        """Native mirror of plugins/collector/scope.ts; do not join frame contexts."""
        def scalar(value):
            return not empty(value) and isinstance(value, (str, int, float, bool, Decimal))

        def complete(row, keys):
            return all(scalar(row.get(key)) for key in keys)

        def value_text(value):
            return ('true' if value else 'false') if isinstance(value, bool) else str(value)

        def identity(row, keys):
            return dumps([value_text(row[key]) for key in keys])

        def conflicts(left, right):
            return any(key in right and not empty(value) and not empty(right[key]) and
                       dumps(value) != dumps(right[key]) for key, value in left.items())

        def reject(message, code='AMBIGUOUS'):
            raise Fault(code, message)

        if include_defaults and rules is not None:
            branches = []
            for branch_rules in (None, rules):
                try:
                    scoped = Collector.scope_payload(payload, branch_rules)
                except Fault as error:
                    if error.code == 'COLLECTION_SCOPE':
                        continue
                    raise
                units = scoped.get('frames') or [{'framePath': 'top', 'url': payload.get('url', ''), 'pointInfo': scoped['pointInfo'], 'tables': scoped['tables'], 'tableSources': scoped.get('tableSources', {})}]
                branches.append((branch_rules, units))
            require(branches, '지정된 수집 화면/규칙과 일치하지 않아 수집하지 않았습니다.', 'COLLECTION_SCOPE')
            parent_contexts = set()
            def add_parents(stage, rows):
                for row in rows:
                    if complete(row, IDENTITIES[stage]):
                        parent_contexts.add(stage + ':' + identity(row, IDENTITIES[stage]))
            for branch_rules, units in branches:
                for unit in units:
                    point, tables = unit.get('pointInfo', {}), unit.get('tables', {})
                    if branch_rules is None:
                        stage = {'01114': 'receipt', '01117': 'receipt', '01174': 'bid', '01571': 'contract'}.get(str(point.get('depth2')))
                        if stage:
                            add_parents(stage, [point] + [row for rows in tables.values() for row in rows])
                    else:
                        for rule in branch_rules:
                            if rule.get('enabled', True) is False or not matches(point, rule.get('screenFilter')) or not matches({'url': unit.get('url', '')}, rule.get('urlFilter')):
                                continue
                            stage = next((stage for stage in IDENTITIES if rule['sourceId'] in ('procurement.' + stage, 'procurement.' + stage + '_item')), None)
                            rows = [point] if rule['dataset'] == '$pointInfo' else tables.get(dataset_name(unit, rule['dataset']), [])
                            eligible = [row for row in rows if complete(row, rule['identityFields'])]
                            if stage and eligible:
                                add_parents(stage, [point] + eligible)
            require(len(parent_contexts) <= 1, '기본 조건과 사용자 규칙이 서로 다른 업무 문맥을 포함합니다.', 'AMBIGUOUS')
            originals = payload.get('frames') or [{'framePath': 'top', 'url': payload.get('url', ''), 'pointInfo': payload['pointInfo'], 'tables': payload['tables'], 'tableSources': payload.get('tableSources', {})}]
            frame_key = lambda unit: digest([unit.get('framePath'), unit.get('url'), unit.get('pointInfo')])
            original_frames = {frame_key(unit): unit for unit in originals}
            selected, selected_by_frame = [], {}
            for _, units in branches:
                for unit in units:
                    key = frame_key(unit)
                    if key not in selected_by_frame:
                        merged = {**unit, 'tables': {name: list(rows) for name, rows in unit.get('tables', {}).items()}}
                        selected.append(merged)
                        selected_by_frame[key] = merged
                    else:
                        merged = selected_by_frame[key]
                        for name, rows in unit.get('tables', {}).items():
                            previous = merged['tables'].get(name, [])
                            accepted = {digest(row) for row in previous + rows}
                            # Filter the original sequence, not a set: two equal raw
                            # rows remain two rows even when several rules select them.
                            original_rows = original_frames[key]['tables'].get(name, [])
                            merged['tables'][name] = [row for row in original_rows if digest(row) in accepted]
            return {'pointInfo': {}, 'tables': {}, 'frames': selected, 'warnings': list(payload.get('warnings', []))}
        units = payload.get('frames') or [{'framePath': 'top', 'url': payload.get('url', ''),
                                         'pointInfo': payload['pointInfo'], 'tables': payload['tables'], 'tableSources': payload.get('tableSources', {})}]
        selected, contexts, records = [], {}, {}
        recognized = False
        custom_procurement_context = None

        def record(source, keys, row, single_context=True):
            row_id = identity(row, keys)
            if single_context and source in contexts and contexts[source] != row_id:
                return False
            if single_context:
                contexts[source] = row_id
            key = source + ':' + row_id
            previous = records.get(key, {})
            if conflicts(previous, row):
                return False
            records[key] = {**previous, **{key: value for key, value in row.items() if not empty(value)}}
            return True

        for unit in units:
            point, tables = unit.get('pointInfo', {}), unit.get('tables', {})
            rows = [row for dataset in tables.values() for row in dataset]
            if rules is None:
                if str(point.get('areaCd')) != '14':
                    continue
                url = unit.get('url', '')
                if url:
                    try:
                        parsed_url = urlsplit(url)
                        hostname = parsed_url.hostname or ''
                        allowed_url = parsed_url.scheme in ('http', 'https') and (hostname == 'g2b.go.kr' or hostname.endswith('.g2b.go.kr'))
                    except (ValueError, TypeError, AttributeError):
                        allowed_url = False
                    if not allowed_url:
                        continue
                stage = {'01114': 'receipt', '01117': 'receipt', '01174': 'bid', '01571': 'contract'}.get(str(point.get('depth2')))
                if stage is None:
                    continue
                recognized = True
                expected_depth = {'receipt': '01001', 'bid': '01173', 'contract': '01570'}[stage]
                if str(point.get('depth1')) != expected_depth:
                    reject('화면 상위 경로와 지정 업무 화면이 일치하지 않습니다.')
                keys = IDENTITIES[stage]
                own = [point] + rows
                complete_rows = [row for row in own if complete(row, keys)]
                if not complete_rows:
                    continue
                if len({identity(row, keys) for row in complete_rows}) != 1:
                    reject('지정 화면에 여러 업무 식별값이 있습니다.')
                business = complete_rows[0]
                if any(any(not empty(row.get(key)) and value_text(row[key]) != value_text(business[key]) for key in keys) for row in own):
                    reject('화면과 Dataset의 업무 식별값이 충돌합니다.')
                if contexts and stage not in contexts:
                    reject('서로 다른 업무 화면이 함께 로딩되어 있습니다.')
                if not record(stage, keys, {**point, **{key: business[key] for key in keys}}):
                    reject('Frame 간 업무 식별 또는 화면 값이 충돌합니다.')
                for row in rows:
                    if not complete(row, ITEMS[stage]):
                        continue
                    key = stage + '_item:' + identity(row, ITEMS[stage])
                    previous = records.get(key, {})
                    if conflicts(previous, row):
                        reject('동일 물품의 Dataset 값이 충돌합니다.')
                    records[key] = {**previous, **{key: value for key, value in row.items() if not empty(value)}}
                selected.append(unit)
            else:
                scoped_tables, matched = {}, False
                for rule in rules:
                    if rule.get('enabled', True) is False or not matches(point, rule.get('screenFilter')) or not matches({'url': unit.get('url', '')}, rule.get('urlFilter')):
                        continue
                    source_rows = [point] if rule['dataset'] == '$pointInfo' else tables.get(dataset_name(unit, rule['dataset']), [])
                    if not source_rows:
                        continue
                    recognized = True
                    eligible = [row for row in source_rows if complete(row, rule['identityFields'])]
                    for row in eligible:
                        if not record(rule['sourceId'], rule['identityFields'], row, single_context=False):
                            reject('설정된 규칙의 업무 식별 또는 값이 충돌합니다.')
                    stage = next((stage for stage in IDENTITIES if rule['sourceId'] in ('procurement.' + stage, 'procurement.' + stage + '_item')), None)
                    if stage and eligible:
                        parents = [parent for parent in [point] + eligible if complete(parent, IDENTITIES[stage])]
                        for parent in parents:
                            context = stage + ':' + identity(parent, IDENTITIES[stage])
                            if custom_procurement_context is not None and custom_procurement_context != context:
                                reject('수집 규칙이 서로 다른 업무 문맥을 포함합니다.')
                            custom_procurement_context = context
                        if parents and any(any(not empty(row.get(key)) and value_text(row[key]) != value_text(parents[0][key]) for key in IDENTITIES[stage]) for row in [point] + source_rows):
                            reject('설정된 Dataset의 일부 업무 식별값이 충돌합니다.')
                    if eligible:
                        matched = True
                        if rule['dataset'] != '$pointInfo':
                            accepted = {digest(row) for row in scoped_tables.get(dataset_name(unit, rule['dataset']), []) + eligible}
                            scoped_tables[dataset_name(unit, rule['dataset'])] = [row for row in source_rows if digest(row) in accepted]
                if matched:
                    selected.append({**unit, 'tables': scoped_tables, **({'tableSources': {name: source for name, source in unit['tableSources'].items() if name in scoped_tables}} if 'tableSources' in unit else {})})
        if not selected:
            reject('지정 화면의 업무 식별 열이 완전하지 않아 수집하지 않았습니다.' if recognized else
                   '지정된 수집 화면/규칙과 일치하지 않아 수집하지 않았습니다.', 'COLLECTION_SCOPE')
        point_info, tables = {}, {}
        for unit in selected:
            for target, values in ((point_info, unit.get('pointInfo', {})), (tables, unit.get('tables', {}))):
                for key, value in values.items():
                    name = key if key not in target else str(unit.get('framePath', 'top')) + '::' + key
                    initial, index = name, 2
                    while name in target:
                        name = initial + '#' + str(index)
                        index += 1
                    target[name] = value
        warnings = list(payload.get('warnings', []))
        if payload.get('frames'):
            for unit in selected:
                for warning in unit.get('warnings', []):
                    warning = '[' + str(unit.get('framePath', 'top')) + '] ' + warning
                    if warning not in warnings:
                        warnings.append(warning)
        warnings = list(dict.fromkeys(warnings))
        return {'pointInfo': point_info, 'tables': tables, **({'url': payload['url']} if 'url' in payload else {}),
                **({'frames': selected} if payload.get('frames') else {'tableSources': selected[0].get('tableSources', {})}), 'warnings': warnings}

    def import_bundle(self, bundle):
        require(isinstance(bundle, dict), 'Transfer must be an object')
        if 'pointInfo' in bundle and 'tables' in bundle:
            events = [{'captureId': digest(bundle), 'payload': bundle, 'origin': 'legacy-file'}]
        else:
            require(bundle.get('format') == 'pce-transfer' and bundle.get('version') == 1, 'Unsupported transfer format/version')
            events = bundle.get('captures')
            require(isinstance(events, list) and events, 'Transfer has no captures')
        # Validate all events before the first insert; the Gateway also wraps a transaction.
        for event in events:
            require(isinstance(event, dict) and isinstance(event.get('captureId'), str) and 0 < len(event['captureId']) <= 200, 'Invalid event identity')
            self.validate_payload(event.get('payload'))
        capture_ids = []
        exclusions = (self.store.configuration('dictionary')['value'] or {}).get('excludeKeys', [])
        def exclude(value):
            if isinstance(value, dict):
                return {k: exclude(v) for k, v in value.items() if k not in exclusions}
            if isinstance(value, list):
                return [exclude(v) for v in value]
            return value
        for event in events:
            payload = exclude(event['payload'])
            fingerprint = digest(payload)
            existing = self.store.capture_existing(event['captureId'], fingerprint)
            if existing:
                capture_ids.append(existing)
                continue
            capture_id = str(uuid.uuid4())
            metadata = {k: v for k, v in event.items() if k != 'payload'}
            metadata.update({'captureId': capture_id, 'eventId': event['captureId'], 'capturedAt': event.get('capturedAt') or datetime.now(timezone.utc).isoformat(), 'warnings': payload.get('warnings', []), 'settingsReferences': bundle.get('settingsReferences', event.get('settingsReferences', []))})
            self.store.capture_save(capture_id, event['captureId'], fingerprint, metadata, payload)
            capture_ids.append(capture_id)
        return {'captureIds': capture_ids}

    @staticmethod
    def validate_payload(payload):
        require(isinstance(payload, dict) and isinstance(payload.get('pointInfo'), dict) and isinstance(payload.get('tables'), dict), 'Malformed capture payload')
        require(all(isinstance(rows, list) and all(isinstance(r, dict) for r in rows) for rows in payload['tables'].values()), 'Capture datasets must contain object rows')
        require(isinstance(payload.get('frames', []), list) and isinstance(payload.get('warnings', []), list), 'Invalid frame/warning list')
        for unit in [payload] + payload.get('frames', []):
            require(isinstance(unit, dict), 'Invalid capture frame')
            sources = unit.get('tableSources', {})
            require(isinstance(sources, dict), 'Invalid Dataset source metadata')
            require(all(name in unit.get('tables', {}) and isinstance(source, dict)
                        and all(isinstance(source.get(field), str) and source[field] for field in ('componentId', 'originalId'))
                        for name, source in sources.items()), 'Invalid Dataset source metadata')
        for frame in payload.get('frames', []):
            require(isinstance(frame, dict) and isinstance(frame.get('pointInfo', {}), dict) and isinstance(frame.get('tables', {}), dict), 'Invalid frame')
            require(all(isinstance(rows, list) and all(isinstance(row, dict) for row in rows) for rows in frame.get('tables', {}).values()), 'Invalid frame rows')

    def list(self):
        return self.store.capture_list()

    def read(self, capture_id):
        return self.store.capture_read(capture_id)

    def candidates(self, payload):
        point = payload['pointInfo']
        for frame in payload.get('frames', []):
            frame_point = frame.get('pointInfo', {})
            root_stages = {stage for stage, fields in IDENTITIES.items() if all(not empty(point.get(f)) for f in fields)}
            frame_stages = {stage for stage, fields in IDENTITIES.items() if all(not empty(frame_point.get(f)) for f in fields)}
            if root_stages and frame_stages and not root_stages.intersection(frame_stages):
                return [], 'ambiguous', ['서로 다른 업무 단계의 Frame 자료가 함께 있습니다.']
            for fields in IDENTITIES.values():
                if all(not empty(point.get(f)) and not empty(frame_point.get(f)) for f in fields) and any(str(point[f]) != str(frame_point[f]) for f in fields):
                    return [], 'ambiguous', ['최상위 화면과 Frame 업무 식별값이 다릅니다.']
        root_has_identity = any(all(not empty(point.get(f)) for f in fields) for fields in IDENTITIES.values())
        if not root_has_identity and not any(payload['tables'].values()) and payload.get('frames'):
            merged = {}
            for frame in payload['frames']:
                records, status, warnings = self.candidates({'pointInfo': frame.get('pointInfo', {}), 'tables': frame.get('tables', {})})
                if status == 'ambiguous':
                    return [], status, warnings
                for source, identity, content in records:
                    key = dumps([source, identity])
                    if key in merged and any(k in merged[key][2] and not empty(v) and not empty(merged[key][2][k]) and v != merged[key][2][k] for k, v in content.items()):
                        return [], 'ambiguous', ['Frame 간 동일 업무값이 충돌합니다. 원본 검토가 필요합니다.']
                    if key in merged:
                        merged[key][2].update({k: v for k, v in content.items() if not empty(v)})
                    else:
                        merged[key] = (source, identity, content)
            parents = {(source, dumps(identity)) for source, identity, _ in merged.values() if not source.endswith('_item')}
            if len(parents) > 1:
                return [], 'ambiguous', ['여러 Frame에서 다른 업무가 발견되었습니다.']
            if merged:
                return list(merged.values()), 'ready', []
        tables = dict(payload['tables'])
        # Frame sources are retained; conflicting headers never silently overwrite.
        for index, frame in enumerate(payload.get('frames', [])):
            for key, rows in frame.get('tables', {}).items():
                tables['frame:' + str(index) + ':' + key] = rows
        rows = [r for dataset in tables.values() for r in dataset]
        possible = []
        depth = str(point.get('depth2', ''))
        for stage, fields in IDENTITIES.items():
            if all(not empty(point.get(f)) for f in fields) or any(all(not empty(r.get(f)) for f in fields) for r in rows):
                possible.append(stage)
        # Existing source fixtures: depth + identity/dataset structure, never UUID or number length.
        if depth in ('01108', '01118'):
            return [], 'raw_only', ['별도 요청번호 화면 또는 업무키가 부족한 화면입니다. 원본으로 보관합니다.']
        depth_hint = {'01114': 'receipt', '01117': 'receipt', '01174': 'bid', '01571': 'contract'}.get(depth)
        expected_depth1 = {'receipt': '01001', 'bid': '01173', 'contract': '01570'}
        if depth and depth_hint is None:
            return [], 'raw_only', ['설정되지 않은 화면 경로입니다. 원본을 보관합니다.']
        if depth_hint and point.get('depth1') and str(point['depth1']) != expected_depth1[depth_hint]:
            return [], 'ambiguous', ['화면 상위 경로가 업무 종류와 일치하지 않습니다.']
        if depth_hint in possible:
            possible = [depth_hint]
        elif depth_hint:
            return [], 'raw_only', ['화면 업무의 번호와 차수가 완전하지 않습니다.']
        elif 'contract' in possible and any('ctrtItemSqno' in r for r in rows):
            possible = ['contract']
        elif 'bid' in possible and ('bidPbancNo' in point or any('bidPbancItemSqno' in r for r in rows)):
            possible = ['bid']
        if len(possible) != 1:
            return [], 'ambiguous' if possible else 'raw_only', ['화면 식별이 불명확합니다. 원본 확인 또는 수집규칙을 지정하세요.']
        stage = possible[0]
        parent_fields = IDENTITIES[stage]
        identities = {dumps({f: str(r[f]) for f in parent_fields}): {f: str(r[f]) for f in parent_fields} for r in [point] + rows if all(not empty(r.get(f)) for f in parent_fields)}
        if len(identities) != 1:
            return [], 'ambiguous', ['여러 업무 식별값이 발견되었습니다. 자동 정규화를 중단했습니다.']
        identity = next(iter(identities.values()))
        parent = {k: v for k, v in point.items() if k and not k.startswith('__')}
        parent.update(identity)
        candidates = [('procurement.' + stage, identity, parent)]
        child_fields = parent_fields + ITEMS[stage]
        by_identity = {}
        for row in rows:
            if not all(not empty(row.get(f)) for f in ITEMS[stage]):
                continue
            if any(not empty(row.get(f)) and str(row[f]) != identity[f] for f in parent_fields):
                continue
            child = {**row, **identity}
            child_identity = {f: str(child[f]) for f in child_fields}
            child.update(child_identity)
            key = dumps(child_identity)
            if key in by_identity:
                previous = by_identity[key]
                if any(k in previous and not empty(previous[k]) and not empty(v) and previous[k] != v for k, v in child.items()):
                    return [], 'ambiguous', ['동일 물품의 데이터셋 값이 서로 다릅니다. 원본 비교가 필요합니다.']
                previous.update({k: v for k, v in child.items() if k not in previous or empty(previous[k])})
            else:
                by_identity[key] = child
        for child in by_identity.values():
            candidates.append(('procurement.' + stage + '_item', {f: child[f] for f in child_fields}, child))
        return candidates, 'ready', []

    def rule_candidates(self, payload, rules):
        candidates = []
        for frame in payload.get('frames', []):
            candidates.extend(self.rule_candidates({'pointInfo': frame.get('pointInfo', {}), 'tables': frame.get('tables', {}), 'url': frame.get('url', ''), 'tableSources': frame.get('tableSources', {})}, rules))
        if payload.get('frames'):
            return candidates
        for rule in rules:
            if rule.get('enabled', True) is False:
                continue
            validate_filter(rule.get('screenFilter'))
            validate_filter(rule.get('urlFilter'))
            if not matches(payload['pointInfo'], rule.get('screenFilter')) or not matches({'url': payload.get('url', '')}, rule.get('urlFilter')):
                continue
            source = rule.get('sourceId')
            self.store.definition(source)
            keys = rule.get('identityFields', [])
            require(keys, 'Collection rule requires identityFields')
            records = [payload['pointInfo']] if rule.get('dataset') == '$pointInfo' else payload['tables'].get(dataset_name(payload, rule.get('dataset')), [])
            for row in records:
                if all(not empty(row.get(f)) for f in keys):
                    candidates.append((source, {f: str(row[f]) for f in keys}, {**row, **{f: str(row[f]) for f in keys}}))
        return candidates

    def preview(self, capture_id):
        capture = self.read(capture_id)
        configuration = self.store.configuration('collector.rules')
        policy = self.policy()
        rules = policy['rules']
        if rules is not None:
            candidates = self.rule_candidates(capture['payload'], rules)
            status, warnings = ('ready', []) if candidates else ('raw_only', ['설정된 수집규칙과 일치하지 않습니다.'])
            if policy.get('includeDefaults'):
                try:
                    scoped = self.scope_payload(capture['payload'])
                    defaults, default_status, default_warnings = self.candidates(scoped)
                    candidates = defaults + candidates
                    if default_status == 'ambiguous':
                        status, warnings = default_status, default_warnings
                    elif candidates:
                        status, warnings = 'ready', []
                except Fault as error:
                    if error.code != 'COLLECTION_SCOPE':
                        status, warnings = 'ambiguous', [str(error)]
        else:
            candidates, status, warnings = self.candidates(capture['payload'])
        merged = {}
        for source, identity, incoming in candidates:
            key = dumps([source, identity])
            if key in merged:
                previous = merged[key][2]
                if any(k in previous and not empty(previous[k]) and not empty(v) and previous[k] != v for k, v in incoming.items()):
                    status = 'ambiguous'
                    warnings.append('동일 업무의 원본 값이 충돌합니다: ' + source)
                else:
                    previous.update({k: v for k, v in incoming.items() if not empty(v)})
            else:
                merged[key] = (source, identity, dict(incoming))
        candidates = list(merged.values())
        proposed = []
        for source, identity, incoming in candidates:
            # Collection identity belongs to the rule (or built-in stage mapping).
            # Storage duplicate policy is a separate constraint, never a join key.
            policy = self.store.definition(source)['duplicatePolicy']
            matches_existing = [r for r in self.store.rows(source) if all(str(r.get(k)) == str(v) for k, v in identity.items())]
            if len(matches_existing) > 1:
                warnings.append('저장 중복으로 대상을 정할 수 없습니다: ' + source)
                status = 'ambiguous'
                continue
            current = matches_existing[0] if matches_existing else {}
            duplicate_keys = policy.get('keys', [])
            if not current and policy['mode'] != 'allow' and duplicate_keys and all(not empty(incoming.get(k)) for k in duplicate_keys):
                duplicates = [r for r in self.store.rows(source) if all(str(r.get(k)) == str(incoming[k]) for k in duplicate_keys)]
                if duplicates:
                    warnings.append('업무 식별과 별개인 저장 중복 정책에 해당합니다: ' + source)
                    if policy['mode'] == 'compare':
                        status = 'ambiguous'
                    continue
            changes = []
            for field, value in incoming.items():
                if not field or field.startswith('__') or value == [] or value == {}:
                    continue
                # Empty observation is retained in raw, not interpreted as erasure.
                if current and empty(value):
                    continue
                if field not in current or current[field] != value:
                    changes.append({'field': field, 'previous': current.get(field), 'incoming': value, 'conflict': field in current and not empty(current[field]) and not empty(value)})
            proposed.append({'recordKey': digest([source, identity]), 'sourceId': source, 'identity': identity, 'rowId': current.get('__rowId'), 'storeVersion': current.get('__storeVersion'), 'isNew': not current, 'changes': changes})
        token = digest([capture_id, configuration['storeVersion'], [(r['sourceId'], self.store.definition(r['sourceId'])['storeVersion'], r['recordKey'], r['storeVersion'], r['changes']) for r in proposed]])
        return {'captureId': capture_id, 'previewToken': token, 'classification': ','.join(sorted({r['sourceId'] for r in proposed})), 'status': status, 'warnings': capture.get('warnings', []) + warnings, 'records': proposed}

    def apply(self, capture_id, decisions, preview_token):
        proposal = self.preview(capture_id)
        require(preview_token == proposal['previewToken'], '자료 또는 설정이 변경되었습니다. 다시 비교하세요.', 'STALE_VERSION')
        require(proposal['status'] == 'ready', 'Capture requires raw review', 'AMBIGUOUS')
        require(isinstance(decisions, list), 'Decisions must be a list')
        decisions_by_key = {d['recordKey']: d for d in decisions}
        require(len(decisions_by_key) == len(decisions), 'Duplicate decision')
        require(set(decisions_by_key) <= {r['recordKey'] for r in proposal['records']}, 'Unknown record decision')
        changed = []
        for record in proposal['records']:
            decision = decisions_by_key.get(record['recordKey'])
            if decision:
                require(decision.get('storeVersion') == record['storeVersion'], 'Record changed since preview', 'STALE_VERSION')
                require(set(decision.get('fields', [])) <= {c['field'] for c in record['changes']}, 'Unknown field decision')
            # New/fill values are automatic; conflicting values require explicit field approval.
            selected = {c['field']: c['incoming'] for c in record['changes'] if not c['conflict'] or decision and c['field'] in decision.get('fields', [])}
            if not selected:
                continue
            definition = self.store.definition(record['sourceId'])
            columns = [dict(c) for c in definition['columns']]
            known = {c['field']: c for c in columns}
            for field, value in selected.items():
                if field not in known:
                    column = inferred_column(field, value)
                    columns.append(column)
                    known[field] = column
                if known[field].get('kind') in ('text', 'code') and not isinstance(value, (dict, list)) and value is not None:
                    selected[field] = str(value)
                elif known[field].get('kind') == 'integer' and isinstance(value, str) and not empty(value):
                    try:
                        number = Decimal(value)
                        require(number.is_finite(), 'Invalid numeric observation')
                        if number == number.to_integral_value():
                            selected[field] = int(number)
                        else:
                            known[field]['kind'] = 'decimal'
                    except InvalidOperation:
                        raise Fault('VALIDATION', 'Invalid integer observation: ' + field)
            if columns != definition['columns']:
                self.store.configure(record['sourceId'], columns=columns)
            if record['isNew']:
                result = self.store.insert(record['sourceId'], selected)
            else:
                result = self.store.update(record['sourceId'], record['rowId'], record['storeVersion'], selected)
            changed.append({'sourceId': record['sourceId'], 'rowId': result['__rowId']})
        self.store.log('collector.apply', {'captureId': capture_id, 'changed': changed})
        return {'changed': changed, 'pending': self.preview(capture_id)}

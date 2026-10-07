"""Fixed loopback adapter; Studio owns templates, output paths and retry receipts."""
import http.client
import os
from .model import Fault, require, dumps, loads

COMMANDS = {'mvp.document.profiles', 'mvp.document.generate'}
STAGES = {'receipt', 'bid', 'contract'}


def forward(command, payload, request_id, port=None):
    require(command in COMMANDS, '문서 명령을 확인하세요.')
    if command == 'mvp.document.generate':
        require(set(payload) == {'profileId', 'sourceKind', 'items'}, '문서 전달 항목을 확인하세요.')
        require(isinstance(payload['profileId'], str) and 0 < len(payload['profileId']) <= 200, '연결된 서식을 확인하세요.')
        require(payload['sourceKind'] in ('screen', 'db'), '자료 출처를 확인하세요.')
        items = payload['items']
        require(isinstance(items, list) and 0 < len(items) <= 100, '생성할 자료를 1~100건 선택하세요.')
        for item in items:
            require(isinstance(item, dict) and item.get('stage') in STAGES, '생성 업무를 확인하세요.')
            require(isinstance(item.get('fields'), dict) and isinstance(item.get('userValues'), dict), '원천 값과 사용자 값을 확인하세요.')
            require(isinstance(item.get('children'), list) and isinstance(item.get('source'), dict), '하위 표와 출처를 확인하세요.')
            require(isinstance(item.get('identity'), list) and all(isinstance(v, str) for v in item['identity']), '자료 식별값을 확인하세요.')
        body = dumps({**payload, 'requestId': request_id}).encode('utf-8')
        require(len(body) <= 32 * 1024 * 1024, '문서 전달 자료는 32MB 이내여야 합니다.')
    else:
        require(not payload, '서식 조회에는 별도 인수가 없습니다.')
        body = None
    try:
        studio_port = int(port if port is not None else os.environ.get('G2B_STUDIO_PORT', '4318'))
        require(1 <= studio_port <= 65535, 'Studio lite 연결 포트를 확인하세요.')
    except (TypeError, ValueError):
        raise Fault('VALIDATION', 'Studio lite 연결 포트를 확인하세요.')
    connection = http.client.HTTPConnection('127.0.0.1', studio_port, timeout=120)
    try:
        connection.request('POST' if body else 'GET', '/api/g2b/generate' if body else '/api/g2b/profiles', body=body,
                           headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
        response = connection.getresponse()
        raw = response.read(1024 * 1024 + 1)
        require(len(raw) <= 1024 * 1024, 'Studio lite 응답이 너무 큽니다.', 'STUDIO_RESPONSE')
        try:
            result = loads(raw.decode('utf-8'))
        except (ValueError, UnicodeError):
            raise Fault('STUDIO_RESPONSE', 'Studio lite 응답 형식을 확인하세요.')
        require(isinstance(result, dict), 'Studio lite 응답 형식을 확인하세요.', 'STUDIO_RESPONSE')
        if response.status != 200:
            message = result.get('error', 'Studio lite가 요청을 처리하지 못했습니다.')
            raise Fault('STUDIO_RESPONSE', message if isinstance(message, str) else 'Studio lite가 요청을 처리하지 못했습니다.')
        if body:
            require(result.get('requestId') == request_id and result.get('status') in ('success', 'needs-input', 'error', 'partial'), '생성 응답 번호/상태를 확인하세요.', 'STUDIO_RESPONSE')
            results = result.get('results')
            require(isinstance(results, list) and len(results) == len(items), '생성 결과 건수가 다릅니다.', 'STUDIO_RESPONSE')
            require(all(isinstance(r, dict) and type(r.get('itemIndex')) is int and r.get('status') in ('success', 'needs-input', 'error') for r in results), '생성 결과 항목을 확인하세요.', 'STUDIO_RESPONSE')
            require(sorted(r['itemIndex'] for r in results) == list(range(len(items))), '생성 결과 자료 번호가 다릅니다.', 'STUDIO_RESPONSE')
            require(all(r['status'] != 'success' or isinstance(r.get('path'), str) and bool(r['path'].strip()) for r in results), '저장된 파일 경로가 없습니다.', 'STUDIO_RESPONSE')
            statuses = {r['status'] for r in results}
            expected_status = results[0]['status'] if len(statuses) == 1 else 'partial'
            require(result['status'] == expected_status, '전체 생성 상태와 항목별 결과가 다릅니다.', 'STUDIO_RESPONSE')
            summary = result.get('summary')
            counts = {key: sum(r['status'] == status for r in results) for key, status in
                      (('succeeded', 'success'), ('needsInput', 'needs-input'), ('failed', 'error'))}
            require(isinstance(summary, dict) and all(type(summary.get(key)) is int and summary[key] == count for key, count in counts.items()), '생성 요약과 항목별 결과 건수가 다릅니다.', 'STUDIO_RESPONSE')
        else:
            require(isinstance(result.get('profiles'), list) and all(isinstance(p, dict) and all(isinstance(p.get(k), str) and p[k] for k in ('id', 'label')) for p in result['profiles']), '서식 목록 형식을 확인하세요.', 'STUDIO_RESPONSE')
        return result
    except (OSError, http.client.HTTPException):
        raise Fault('STUDIO_UNAVAILABLE', 'Studio lite에 연결할 수 없습니다. 실행 상태를 확인한 뒤 같은 요청으로 다시 시도하세요.')
    finally:
        connection.close()

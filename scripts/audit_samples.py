"""Read-only source audit. Reports structure, never publishes source values."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]

def read_markdown(path):
    payload = {'pointInfo': {}, 'tables': {}}
    current = None
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        match = re.match(r'■ \[표: (.+)\]', line)
        if match:
            current = match.group(1)
            payload['tables'][current] = []
        elif current and '\t' in line and ':' in line:
            payload['tables'][current].append(dict(part.split(':', 1) for part in line.split('\t') if ':' in part))
        elif current is None and ' : ' in line:
            key, value = line.split(' : ', 1)
            payload['pointInfo'][key] = value
    return payload

def audit():
    reports=[]
    for path in sorted((ROOT/'참고자료').glob('data_map_*.txt')):
        payload=json.loads(path.read_text(encoding='utf-8-sig'),parse_float=str)
        tables=payload['tables']; points=payload['pointInfo']
        rows=[row for rows in tables.values() if isinstance(rows,list) for row in rows if isinstance(row,dict)]
        signatures=[json.dumps(value,sort_keys=True,ensure_ascii=False) for value in tables.values() if value]
        stage_keys={
            '접수':('ctrtDmndRcptNo','ctrtDmndRcptOrd'),
            '공고':('bidPbancNo','bidPbancOrd'),
            '계약':('ctrtNo','ctrtChgOrd'),
            '별도 요청':('ctrtDmndNo','ctrtDmndOrd'),
        }
        observed=[stage for stage,keys in stage_keys.items() if any(all(str(row.get(key,'')) for key in keys) for row in [points,*rows])]
        reports.append({'file':path.name,'pointFields':len(points),'tables':len(tables),'rows':len(rows),'duplicateTables':len(signatures)-len(set(signatures)),'observedIdentityFamilies':observed})
    return reports

if __name__=='__main__':
    report=audit()
    print(json.dumps({'jsonFiles':len(report),'parsed':len(report),'reports':report},ensure_ascii=True,indent=2))

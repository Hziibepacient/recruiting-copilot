"""Validate a single reviewed-candidate permit within the authorized outreach scope."""
import re, uuid, time, math, json
from pathlib import Path
SCOPE={'account':'DEMO_ACCOUNT','jobId':'10000000','greeting':'你好~我这里有个职位很适合你，待遇优厚，了解一下吗？期待回复！'}
def permit_path(runtime,ident):
    canonical=str(uuid.UUID(ident))
    if ident!=canonical:raise ValueError('Noncanonical permit ID')
    return runtime/'permits'/(canonical+'.json')
def validate_permit(p,request,now=None):
    now=time.time() if now is None else now
    expiry=p.get('expiresAt')
    if p.get('state')!='armed' or isinstance(expiry,bool) or not isinstance(expiry,(int,float)) or not math.isfinite(expiry) or expiry<=now:raise ValueError('许可不可用或过期')
    if request.get('permitId')!=p.get('permitId') or request.get('candidateId')!=p.get('candidateId'):raise ValueError('许可与候选人不符')
    if any(p.get(k)!=v for k,v in SCOPE.items()):raise ValueError('许可范围不符')
    for key,pattern in [('candidateId',r'[A-Za-z0-9]{15,80}'),('usercId',r'[a-f0-9]{32}'),('digest',r'[a-f0-9]{64}')]:
        if not isinstance(p.get(key),str) or not re.fullmatch(pattern,p[key]):raise ValueError('许可身份格式不符')
    if not isinstance(p.get('batchId'),str) or not p['batchId']:raise ValueError('缺少批次')


def load_local_scope(root):
    """CLI-only binding; unit tests keep the public demonstration scope."""
    path = Path(root)/'extension'/'outreach-scope.json'
    if not path.exists():
        raise ValueError('Missing local authorization: extension/outreach-scope.json')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict) or any(not isinstance(value.get(k), str) or not value[k].strip() for k in ('account','jobId','greeting')) or not re.fullmatch(r'[0-9]+', value['jobId']):
        raise ValueError('Invalid local authorization scope')
    SCOPE.update({k:value[k] for k in ('account','jobId','greeting')})
    return SCOPE

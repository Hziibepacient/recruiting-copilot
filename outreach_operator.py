"""Local reviewed-candidate permission and ledger helper. Never sends by itself."""
import argparse, datetime as dt, hashlib, importlib.util, json, time, uuid, os
from pathlib import Path
from permits import SCOPE, permit_path, validate_permit, load_local_scope
from ledger import file_lock
ROOT=Path(__file__).resolve().parent
RUNTIME=ROOT/'.runtime'
TZ=dt.timezone(dt.timedelta(hours=8))

def read(path):
    raw=Path(path).read_bytes()
    return json.loads(raw.decode('utf-16') if raw.startswith(b'\xff\xfe') else raw.decode('utf-8-sig'))
def data(path):
    result=read(path)
    if 'result' in result:
        if result['result'].get('ok') is not True:raise ValueError('Input operation did not succeed')
        return result['result']['data']
    return result
def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temp.open('w',encoding='utf-8') as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2,allow_nan=False)
        stream.flush();os.fsync(stream.fileno())
    temp.replace(path)
def ledger():
    spec=importlib.util.spec_from_file_location('outreach_ledger',ROOT/'ledger.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

def arm(a):
    d=data(a.decision)
    if isinstance(d,dict) and d.get('type')=='import':d=d['value']
    if isinstance(d,list):
        if len(d)!=1:raise ValueError('One reviewed candidate required')
        d=d[0]
    prep,snapshot,state=data(a.prepare),data(a.snapshot),data(a.state)
    for k,v in SCOPE.items():
        if state['config'].get(k)!=v:raise ValueError('Authorized scope changed')
    if d.get('approved') is not True or d.get('direction') not in ('CRM','通用'):raise ValueError('Missing review')
    if any(d.get(k)!=SCOPE[k] for k in ('account','jobId')):raise ValueError('Review scope mismatch')
    if snapshot.get('complete') is not True or snapshot.get('candidateId')!=d['candidateId']:raise ValueError('Incomplete candidate snapshot')
    if hashlib.sha256(snapshot['text'].encode()).hexdigest()!=d['digest'] or snapshot['digest']!=d['digest']:raise ValueError('Snapshot digest mismatch')
    # AI-assisted development is a scoring/preference item in the current
    # Xiaoman workflow, not a universal outreach hard gate. Keep the hard
    # gates aligned with the screening configuration: CRM additionally needs
    # Java; generic Agent does not.
    gates=['education','backend','expected_city','agent','delivery']+(['java'] if d['direction']=='CRM' else [])
    for key in gates:
        g=d.get('gates',{}).get(key,{})
        if g.get('state')!='pass' or len(g.get('quote',''))<4 or g['quote'] not in snapshot['text']:raise ValueError('Missing evidence: '+key)
    expected={'candidateId':d['candidateId'],'digest':d['digest'],'batchId':state['run']['batchId'],**SCOPE}
    if prep.get('ready') is not True or any(prep.get(k)!=v for k,v in expected.items()):raise ValueError('Prepared candidate mismatch')
    if any(state.get('preparedReview',{}).get(k)!=prep.get(k) for k in [*expected,'usercId','preparedAt']):raise ValueError('Preparation is not current')
    age=time.time()-dt.datetime.fromisoformat(prep['preparedAt'].replace('Z','+00:00')).timestamp()
    if not 0<=age<=600:raise ValueError('Preparation expired or future-dated')
    if state.get('historyAccount')!=SCOPE['account']:raise ValueError('History not loaded')
    queue=state.get('queue',[])
    if len(queue)!=1 or queue[0].get('candidateId')!=d['candidateId'] or queue[0].get('digest')!=d['digest'] or queue[0].get('approved') is not True:raise ValueError('Current queue mismatch')
    unresolved={}
    for e in state['events']:
        if e.get('account')!=SCOPE['account'] or e.get('origin')=='historical-import':continue
        key=e.get('permitId') or '|'.join([e['account'],e['candidateId'],e.get('batchId') or 'legacy'])
        if e.get('status') in ('pending','uncertain'):unresolved[key]=e
        elif e.get('status') in ('verified','not_sent','failed') and key in unresolved:
            previous=unresolved[key]
            if not previous.get('time') or (e.get('time') and e['time']>=previous['time']):unresolved.pop(key)
    if unresolved:raise ValueError('Unresolved extension attempt')
    today=dt.datetime.now(TZ).date().isoformat()
    daily=len({e['candidateId'] for e in state['events'] if e.get('account')==SCOPE['account'] and e.get('day')==today and e.get('status')=='verified'})
    if daily>=min(state['config']['dailyLimit'],60):raise ValueError('Daily limit reached')
    count=len({e['candidateId'] for e in state['events'] if e.get('account')==SCOPE['account'] and e.get('batchId')==state['run']['batchId'] and e.get('origin')=='extension' and e.get('status')=='verified'})
    checkpoint=state['run'].get('switchCheckpoint',0)
    if not isinstance(checkpoint,int) or checkpoint<0 or checkpoint>count:raise ValueError('Invalid keyword checkpoint')
    carry=state['run'].get('keywordCarry',0)
    if isinstance(carry,bool) or not isinstance(carry,int) or not 0<=carry<state['config']['switchAfter']:raise ValueError('Invalid keyword carry')
    if count>=state['config']['batchLimit'] or state['run'].get('needsKeywordChange') or carry+count-checkpoint>=state['config']['switchAfter']:raise ValueError('Batch or keyword limit')
    if any(e.get('account')==SCOPE['account'] and e.get('candidateId')==d['candidateId'] and e.get('status')=='verified' for e in state['events']):raise ValueError('Already contacted')
    ident=str(uuid.uuid4())
    p={**expected,'usercId':prep['usercId'],'permitId':ident,'state':'armed','expiresAt':time.time()+300}
    request={'type':'run','candidateId':d['candidateId'],'permitId':ident,'tabId':a.tab_id}
    validate_permit(p,request)
    path=permit_path(RUNTIME,ident)
    if path.exists():raise ValueError('Permission already exists')
    day=dt.datetime.now(TZ).date().isoformat()
    out=RUNTIME/'evidence'/day/d['candidateId']/'attempts'/ident
    evidence=out/'screening-and-prepare.json';save(evidence,{'decision':d,'prepare':prep,'read_scope':snapshot.get('readScope')})
    config={'required_gate_keys':gates,'optional_gate_keys':['ai_dev'],'daily_limit':60,'greeting':{'mode':'platform_default','expected_default_text':SCOPE['greeting']}}
    record={'platform':'liepin','account_id':SCOPE['account'],'candidate_id':d['candidateId'],'job_id':SCOPE['jobId'],'job_title':state['config']['jobTitle'],'direction':d['direction'],'name':d.get('name','待确认'),'keywords':a.keyword,'greeting':SCOPE['greeting'],'source_url':snapshot['url'],'detail_evidence':str(evidence),'read_scope':snapshot.get('readScope'),'authorization_confirmed':True,'status':'pending','permit_id':ident,'gates':{k:{'state':'pass','evidence':d['gates'][k]['quote']} for k in gates},'analysis':d.get('analysis','')}
    attempt=RUNTIME/'attempts'/ident
    save(attempt/'record.json',record);save(attempt/'config.json',config);save(attempt/'request.json',request)
    with file_lock(attempt/'transaction.lock'):
        # A preparing permit cannot be dispatched. A crash before the final
        # atomic promotion is therefore recoverable without guessing a receipt.
        save(path,{**p,'state':'preparing'})
        try:
            ledger().append_record(RUNTIME/'ledger',record,config)
            save(path,p)
        except Exception:
            if read(path).get('state')=='preparing':
                _recover_arm(a=argparse.Namespace(permit_id=ident))
            raise
    print(json.dumps({'permitId':ident,'requestFile':str(attempt/'request.json'),'resultFile':str(attempt/'result.json'),'evidence':str(evidence)},ensure_ascii=False))

def finish(a):
    attempt=RUNTIME/'attempts'/a.permit_id
    # Check the canonical ID before constructing any new on-disk path.
    permit_path(RUNTIME,a.permit_id)
    with file_lock(attempt/'transaction.lock'):
        result=_finish(a)
    print(json.dumps(result,ensure_ascii=False))

def _finish(a):
    p=read(permit_path(RUNTIME,a.permit_id));attempt=RUNTIME/'attempts'/a.permit_id
    record,config=read(attempt/'record.json'),read(attempt/'config.json')
    envelope=read(a.result)
    if not isinstance(envelope,dict) or not isinstance(envelope.get('result'),dict):raise ValueError('Invalid result envelope')
    r=envelope['result'];d=r.get('data',{}) if r.get('ok') is True else {}
    if not isinstance(d,dict):raise ValueError('Invalid result data')
    if p.get('state')!='consumed' or envelope.get('id')!=p.get('commandId') or record.get('permit_id')!=a.permit_id or p.get('permitId')!=a.permit_id:raise ValueError('Result is not for this consumed command')
    if any(p.get(k)!=v for k,v in SCOPE.items()) or record.get('candidate_id')!=p.get('candidateId'):raise ValueError('Result scope mismatch')
    result_digest=hashlib.sha256(json.dumps(envelope,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
    ledger_root=RUNTIME/'ledger'
    mod=ledger()
    with file_lock(ledger_root/'.ledger.lock'):
        previous=[e for e in mod.read_events(ledger_root) if e.get('permit_id')==a.permit_id and e.get('result_sha256')]
    if previous:
        terminal=previous[-1]
        if terminal['result_sha256']!=result_digest:raise ValueError('Conflicting result for this permit; use explicit receipt reconciliation')
        return {'saved':str(ledger_root/(terminal['_date']+'.jsonl')),'key':terminal['key'],'status':terminal['status'],'duplicate':True}
    if p.get('state')=='consumed' and r.get('ok') and d.get('verified') is True and isinstance(d.get('receipt'),str) and d['receipt'].strip() and d.get('submitted') is not False and not d.get('notSent') and d.get('candidateId')==p['candidateId'] and d.get('usercId')==p['usercId']:
        record.update(status='verified',receipt=d['receipt'])
    elif r.get('ok') is True and d.get('notSent') is True and d.get('verified') in (None,False) and d.get('submitted') is False and d.get('phase') in ('preflight','pre-submit') and d.get('candidateId')==p['candidateId'] and d.get('usercId')==p['usercId']:
        record.update(status='not_sent',pre_send_failure_evidence=d.get('error','Page reported no click'))
    else:
        record.update(status='uncertain',error=r.get('error',envelope.get('status','Missing receipt')))
    out=attempt/'send-result.json'
    save(out,envelope);record.update(receipt_file=str(out),result_sha256=result_digest,command_id=p['commandId'])
    return mod.append_record(ledger_root,record,config)

def _recover_arm(a):
    """Only a never-dispatchable preparing permit can release an orphan pending."""
    path=permit_path(RUNTIME,a.permit_id);p=read(path)
    if p.get('state') not in ('preparing','cancelled_before_dispatch'):
        raise ValueError('Only an unfinished preparation may be recovered; armed/consumed permits require receipt inspection')
    if p.get('commandId') or p.get('consumedAt'):
        raise ValueError('Permit has dispatch evidence; do not mark not_sent')
    if any(p.get(k)!=v for k,v in SCOPE.items()):raise ValueError('Recovery scope mismatch')
    for leased in RUNTIME.glob('*.leased.json'):
        if read(leased).get('command',{}).get('permitId')==a.permit_id:
            raise ValueError('Leased command exists; inspect receipt instead')
    attempt=RUNTIME/'attempts'/a.permit_id
    record,config=read(attempt/'record.json'),read(attempt/'config.json')
    if record.get('permit_id')!=a.permit_id or record.get('candidate_id')!=p.get('candidateId'):raise ValueError('Recovery identity mismatch')
    # Cancellation is durable before releasing a ledger block. Retrying this
    # recovery cannot turn the permit back into an executable one.
    save(path,{**p,'state':'cancelled_before_dispatch'})
    mod=ledger();ledger_root=RUNTIME/'ledger'
    with file_lock(ledger_root/'.ledger.lock'):
        matches=[e for e in mod.read_events(ledger_root) if e.get('permit_id')==a.permit_id]
    if not matches:return {'status':'cancelled_before_dispatch','ledgerRecord':False}
    if matches[-1]['status']=='not_sent':return {'status':'not_sent','duplicate':True}
    if matches[-1]['status']!='pending':raise ValueError('Preparation is not a pending local-only attempt')
    record.update(status='not_sent',pre_send_failure_evidence='Permit remained preparing and was durably cancelled before dispatch; no leased command exists')
    return mod.append_record(ledger_root,record,config)

def recover_arm(a):
    permit_path(RUNTIME,a.permit_id)
    with file_lock(RUNTIME/'attempts'/a.permit_id/'transaction.lock'):
        result=_recover_arm(a)
    print(json.dumps(result,ensure_ascii=False))

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('arm')
    for name in ('decision','prepare','snapshot','state','keyword'):p.add_argument('--'+name,required=True)
    p.add_argument('--tab-id',type=int,required=True)
    p=sub.add_parser('finish');p.add_argument('--permit-id',required=True);p.add_argument('--result',required=True)
    p=sub.add_parser('recover-arm');p.add_argument('--permit-id',required=True)
    a=parser.parse_args();load_local_scope(ROOT)
    {'arm':arm,'finish':finish,'recover-arm':recover_arm}[a.action](a)
if __name__=='__main__':main()

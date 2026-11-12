"""Local authenticated Chrome bridge. No platform HTTP calls, no browser debugging."""
import argparse, json, secrets, time, uuid, threading, os, math
from permits import permit_path, validate_permit, load_local_scope
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
ROOT=Path(__file__).resolve().parent
RUNTIME=ROOT/'.runtime'
PORT=18763
ALLOWED={'tabs','state','read','import','run','stop','reconcile','history','openDetail','search','preview','prepare','preflight','diagnostics','activate','openSearch','nextBatch','resume','migrateStorage','config','reloadSearch','dialogDiagnostics'}
def init():
    RUNTIME.mkdir(exist_ok=True)
    p=ROOT/'extension/bridge-config.json'
    if not p.exists(): p.write_text(json.dumps({'url':f'http://127.0.0.1:{PORT}','token':secrets.token_urlsafe(32)}),encoding='utf-8')
    return json.loads(p.read_text(encoding='utf-8'))
def save(p,v):
    # Flush the complete result or lease before exposing its final filename.
    p.parent.mkdir(parents=True,exist_ok=True)
    temp=p.with_name(p.name+'.'+uuid.uuid4().hex+'.tmp')
    with temp.open('w',encoding='utf-8') as f:
        json.dump(v,f,ensure_ascii=False,allow_nan=False);f.flush();os.fsync(f.fileno())
    temp.replace(p)

def blocked_tasks(runtime,now=None):
    now=time.time() if now is None else now
    blocked=[]
    for p in runtime.glob('*.leased.json'):
        if p.with_name(p.name.replace('.leased.json','.result.json')).exists():continue
        data=json.loads(p.read_text(encoding='utf-8'))
        expiry=data.get('expiresAt')
        blocked.append({'id':p.name.replace('.leased.json',''),'type':data.get('command',{}).get('type'),
                        'ageSeconds':round(max(0,now-p.stat().st_mtime),1),
                        'deadlinePassed':isinstance(expiry,(int,float)) and expiry<=now})
    return blocked
def make_server(read_only=False):
    config=init();lock=threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*a):pass
        def authorized(self):
            origin=self.headers.get('Origin','')
            return self.headers.get('Host')==f'127.0.0.1:{PORT}' and (not origin or origin.startswith('chrome-extension://')) and secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+config['token'])
        def response(self,code,data):
            self.send_response(code)
            origin=self.headers.get('Origin','')
            if origin.startswith('chrome-extension://'):self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data,ensure_ascii=False).encode())
        def do_OPTIONS(self):
            if not self.headers.get('Origin','').startswith('chrome-extension://'):return self.response(403,{})
            self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type, X-TTC-Client');self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS');self.end_headers()
        def do_GET(self):
            if not self.authorized():return self.response(403,{'error':'unauthorized'})
            if self.path!='/next':return self.response(404,{})
            if self.headers.get('X-TTC-Client')!='direct-1':return self.response(200,None)
            with lock:
                save(RUNTIME/'heartbeat.json',{'time':time.time()})
                # Never dispatch another task until the previous result is durable.
                unresolved=[p for p in RUNTIME.glob('*.leased.json') if not p.with_name(p.name.replace('.leased.json','.result.json')).exists()]
                if unresolved:return self.response(200,None)
                pending=sorted(RUNTIME.glob('*.command.json'),key=lambda p:(p.stat().st_mtime_ns,p.name))
                if not pending:return self.response(200,None)
                p=pending[0];cmd=json.loads(p.read_text(encoding='utf-8'))
                expiry=cmd.get('expiresAt')
                if not isinstance(expiry,(int,float)) or isinstance(expiry,bool) or not math.isfinite(expiry) or expiry<=time.time():
                    save(RUNTIME/(cmd['id']+'.result.json'),{'id':cmd['id'],'result':{'ok':False,'error':'未执行，请求已过期'}})
                    p.rename(p.with_name(p.name.replace('.command.json','.expired.json')))
                    return self.response(200,None)
                if cmd.get('command',{}).get('type')=='run':
                    try:
                        if read_only:raise ValueError('Sending disabled in read-only validation mode')
                        request=cmd['command']
                        path=permit_path(RUNTIME,request.get('permitId',''))
                        permit=json.loads(path.read_text(encoding='utf-8'))
                        validate_permit(permit,request)
                        permit.update(state='consumed',commandId=cmd['id'],consumedAt=time.time())
                        save(path,permit)
                        request.update(_permit=permit,_commandId=cmd['id'])
                        save(p,cmd)
                    except (OSError,ValueError,TypeError):
                        save(RUNTIME/(cmd['id']+'.result.json'),{'id':cmd['id'],'result':{'ok':False,'error':'发送锁定：一次许可缺失、已用或不匹配'}})
                        p.rename(p.with_name(p.name.replace('.command.json','.blocked.json')))
                        return self.response(200,None)
                # Lease before delivery: lost replies never cause automatic resend.
                p.rename(p.with_name(p.name.replace('.command.json','.leased.json')))
                self.response(200,cmd)
        def do_POST(self):
            if not self.authorized():return self.response(403,{'error':'unauthorized'})
            if self.path!='/result':return self.response(404,{})
            try:
                n=int(self.headers.get('Content-Length','0'))
                if n<1:return self.response(400,{'error':'invalid body length'})
                if n>8_000_000:return self.response(413,{})
                self.connection.settimeout(8)
                data=json.loads(self.rfile.read(n),parse_constant=lambda value:(_ for _ in ()).throw(ValueError('Nonfinite JSON')))
                if not isinstance(data,dict) or not isinstance(data.get('id'),str):return self.response(400,{'error':'invalid result envelope'})
                ident=str(uuid.UUID(data['id']))
                if ident!=data['id']:return self.response(400,{'error':'noncanonical command ID'})
                if not isinstance(data.get('result'),dict) or not isinstance(data['result'].get('ok'),bool):return self.response(400,{'error':'missing result'})
                if not (RUNTIME/(ident+'.leased.json')).exists():return self.response(409,{})
                with lock:
                    existing=RUNTIME/(ident+'.result.json')
                    if existing.exists():return self.response(200 if json.loads(existing.read_text(encoding='utf-8'))==data else 409,{'duplicate':True})
                    save(RUNTIME/(ident+'.result.json'),data)
                self.response(200,{'ok':True})
            except (ValueError,KeyError,TypeError,TimeoutError):self.response(400,{'error':'invalid result request'})
    return ThreadingHTTPServer(('127.0.0.1',PORT),Handler)

def serve(read_only=False):
    load_local_scope(ROOT)
    server=make_server(read_only=read_only)
    save(RUNTIME/'server-state.json',{'pid':os.getpid(),'readOnly':read_only,'startedAt':time.time()})
    try:server.serve_forever()
    finally:server.server_close()
def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['serve','status','call']);p.add_argument('--file');p.add_argument('--read-only',action='store_true');a=p.parse_args();init()
    if a.action=='serve':return serve(read_only=a.read_only)
    if a.action=='status':
        h=RUNTIME/'heartbeat.json';v=json.loads(h.read_text()) if h.exists() else {}
        blocked=blocked_tasks(RUNTIME)
        print(json.dumps({'connected':time.time()-v.get('time',0)<10,'lastSeen':v.get('time'),'blockedTasks':blocked}));return
    cmd=json.loads(Path(a.file).read_text(encoding='utf-8-sig'))
    if cmd.get('type') not in ALLOWED:raise ValueError('Unsupported operation')
    ident=str(uuid.uuid4());save(RUNTIME/(ident+'.command.json'),{'id':ident,'command':cmd,'expiresAt':time.time()+45})
    for _ in range(100):
        r=RUNTIME/(ident+'.result.json')
        if r.exists():print(r.read_text(encoding='utf-8'));return
        time.sleep(.5)
    print(json.dumps({'id':ident,'status':'timeout','message':'Do not retry sends; inspect result and receipt first'}))
if __name__=='__main__':main()

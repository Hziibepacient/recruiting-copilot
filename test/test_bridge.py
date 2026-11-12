import importlib.util, tempfile, pathlib, threading, urllib.request, urllib.error, json, uuid, unittest, concurrent.futures, sys, time, http.client, os
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]))
spec=importlib.util.spec_from_file_location('bridge',pathlib.Path(__file__).parents[1]/'bridge.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BridgeTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();b.ROOT=pathlib.Path(self.tmp.name);(b.ROOT/'extension').mkdir();b.RUNTIME=b.ROOT/'.runtime';b.PORT=0
  self.server=b.make_server();b.PORT=self.server.server_address[1];self.config=b.init();self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def tearDown(self):self.server.shutdown();self.server.server_close();self.tmp.cleanup()
 def req(self,path='/next',data=None,origin=None,token=True):
  headers={'X-RC-Client':'direct-1'}
  if token:headers['Authorization']='Bearer '+self.config['token']
  if origin:headers['Origin']=origin
  req=urllib.request.Request(f'http://127.0.0.1:{b.PORT}'+path,data=json.dumps(data).encode() if data else None,headers=headers)
  with urllib.request.urlopen(req,timeout=2) as r:return json.load(r)
 def queue(self,kind='tabs'):
  ident=str(uuid.uuid4());b.save(b.RUNTIME/(ident+'.command.json'),{'id':ident,'expiresAt':time.time()+45,'command':{'type':kind}});return ident
 def test_no_origin_with_token(self):self.assertIsNone(self.req())
 def test_no_token_rejected(self):
  with self.assertRaises(urllib.error.HTTPError) as e:self.req(token=False)
  self.assertEqual(e.exception.code,403)
 def test_web_origin_rejected(self):
  with self.assertRaises(urllib.error.HTTPError) as e:self.req(origin='https://example.com')
  self.assertEqual(e.exception.code,403)
 def test_lease_blocks_second_task_and_result_is_idempotent(self):
  first=self.queue();self.assertEqual(self.req()['id'],first);second=self.queue();self.assertIsNone(self.req())
  result={'id':first,'result':{'ok':True,'data':[]}};self.req('/result',result);self.req('/result',result);self.assertEqual(self.req()['id'],second)
  with self.assertRaises(urllib.error.HTTPError) as e:self.req('/result',{'id':first,'result':{'ok':False}})
  self.assertEqual(e.exception.code,409)
 def test_missing_result_rejected(self):
  ident=self.queue();self.req()
  with self.assertRaises(urllib.error.HTTPError) as e:self.req('/result',{'id':ident})
  self.assertEqual(e.exception.code,400)
 def test_send_locked(self):
  ident=self.queue('run');self.assertIsNone(self.req());self.assertFalse(json.loads((b.RUNTIME/(ident+'.result.json')).read_text(encoding='utf-8'))['result']['ok'])
 def test_expired_task_not_delivered(self):
  ident=self.queue();p=b.RUNTIME/(ident+'.command.json');value=json.loads(p.read_text());value['expiresAt']=0;b.save(p,value)
  self.assertIsNone(self.req());self.assertTrue((b.RUNTIME/(ident+'.expired.json')).exists())
 def test_stale_lease_remains_blocked_with_diagnostics(self):
  ident=self.queue();p=b.RUNTIME/(ident+'.command.json');data=json.loads(p.read_text());data['expiresAt']=time.time()-1;b.save(p,data)
  p.rename(b.RUNTIME/(ident+'.leased.json'))
  blocked=b.blocked_tasks(b.RUNTIME);self.assertEqual(len(blocked),1);self.assertEqual(blocked[0]['id'],ident)
  self.assertTrue(blocked[0]['deadlinePassed']);self.assertIsNone(self.req())
  self.assertTrue((b.RUNTIME/(ident+'.leased.json')).exists())
 def test_extension_origin_allowed(self):self.assertIsNone(self.req(origin='chrome-extension://test-extension'))
 def test_concurrent_conflicting_results(self):
  ident=self.queue();self.req();barrier=threading.Barrier(2)
  def post(value):
   barrier.wait()
   try:self.req('/result',{'id':ident,'result':{'ok':True,'data':value}});return 200
   except urllib.error.HTTPError as e:return e.code
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(post,[1,2]))
  self.assertEqual(sorted(results),[200,409])
 def test_malformed_result_bodies_get_json_400_and_do_not_stop_server(self):
  ident=self.queue();self.req()
  for payload in ['null','[]','1','{"id":null}','{"id":[],"result":{"ok":true}}',json.dumps({'id':ident,'result':{'ok':True,'data':float('nan')}})]:
   conn=http.client.HTTPConnection('127.0.0.1',b.PORT,timeout=2)
   conn.request('POST','/result',body=payload,headers={'Authorization':'Bearer '+self.config['token']})
   response=conn.getresponse();self.assertEqual(response.status,400,payload);json.loads(response.read());conn.close()
  self.assertFalse((b.RUNTIME/(ident+'.result.json')).exists())
  self.req('/result',{'id':ident,'result':{'ok':True}})
  self.assertIsNone(self.req())
 def test_bad_lengths_rejected_without_a_server_exception(self):
  for length,expected in [('garbage',400),('-1',400),('0',400),('8000001',413)]:
   conn=http.client.HTTPConnection('127.0.0.1',b.PORT,timeout=2)
   conn.request('POST','/result',headers={'Authorization':'Bearer '+self.config['token'],'Content-Length':length})
   response=conn.getresponse();self.assertEqual(response.status,expected);json.loads(response.read());conn.close()
 def test_delivery_follows_creation_time_instead_of_uuid_sort(self):
  older='ffffffff-ffff-4fff-afff-ffffffffffff';newer='00000000-0000-4000-a000-000000000000'
  for ident,age in [(older,2),(newer,1)]:
   path=b.RUNTIME/(ident+'.command.json');b.save(path,{'id':ident,'expiresAt':time.time()+45,'command':{'type':'state'}})
   os.utime(path,(time.time()-age,time.time()-age))
  self.assertEqual(self.req()['id'],older)
 def test_nonfinite_missing_and_boolean_deadlines_are_never_dispatched(self):
  for expiry in [None,True,float('nan'),float('inf')]:
   ident=self.queue();path=b.RUNTIME/(ident+'.command.json');value=json.loads(path.read_text());value['expiresAt']=expiry
   path.write_text(json.dumps(value),encoding='utf-8')
   self.assertIsNone(self.req());self.assertTrue((b.RUNTIME/(ident+'.expired.json')).exists())
if __name__=='__main__':unittest.main()

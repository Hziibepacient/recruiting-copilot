"""Isolated local HTTP tests; temporary runtime only, no browser or production permit."""
import importlib.util, pathlib, json, time, uuid, unittest, threading, concurrent.futures
spec=importlib.util.spec_from_file_location('acceptance_bridge_base',pathlib.Path(__file__).with_name('test_bridge.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
b=base.b
class AcceptanceBridgeTests(unittest.TestCase):
 setUp=base.BridgeTests.setUp
 tearDown=base.BridgeTests.tearDown
 req=base.BridgeTests.req
 def arm(self,**overrides):
  p={'state':'armed','permitId':str(uuid.uuid4()),'expiresAt':time.time()+120,'account':'DEMO_ACCOUNT','candidateId':'IndependentCandidate02','usercId':'b'*32,'jobId':'10000000','greeting':'你好~我这里有个职位很适合你，待遇优厚，了解一下吗？期待回复！','digest':'a'*64,'batchId':'test-batch'}
  p.update(overrides);(b.RUNTIME/'permits').mkdir(exist_ok=True);b.save(b.permit_path(b.RUNTIME,p['permitId']),p);return p
 def enqueue(self,p):
  ident=str(uuid.uuid4());b.save(b.RUNTIME/(ident+'.command.json'),{'id':ident,'expiresAt':time.time()+45,'command':{'type':'run','permitId':p['permitId'],'candidateId':p['candidateId']}});return ident
 def test_consume_durable_and_different_command_cannot_reuse(self):
  p=self.arm();first=self.enqueue(p);delivered=self.req();self.assertEqual(delivered['id'],first)
  path=b.permit_path(b.RUNTIME,p['permitId']);saved=json.loads(path.read_text(encoding='utf-8'));self.assertEqual(saved['state'],'consumed');self.assertEqual(saved['commandId'],first)
  self.assertEqual(delivered['command']['_permit']['commandId'],first)
  self.req('/result',{'id':first,'result':{'ok':False,'error':'test interruption'}})
  second=self.enqueue(p);self.assertIsNone(self.req());self.assertTrue((b.RUNTIME/(second+'.blocked.json')).exists())
  self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['commandId'],first)
 def test_wrong_userc_rejected_before_dispatch(self):
  p=self.arm(usercId='wrong');ident=self.enqueue(p);self.assertIsNone(self.req());self.assertTrue((b.RUNTIME/(ident+'.blocked.json')).exists())
 def test_concurrent_poll_only_one_dispatch(self):
  p=self.arm();self.enqueue(p);self.enqueue(p);barrier=threading.Barrier(2)
  def poll(_):barrier.wait();return self.req()
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(poll,range(2)))
  self.assertEqual(sum(r is not None for r in results),1)
 def test_restart_keeps_consumed(self):
  p=self.arm();ident=self.enqueue(p);self.req();self.req('/result',{'id':ident,'result':{'ok':False,'error':'simulated interruption'}})
  self.server.shutdown();self.server.server_close();b.PORT=0;self.server=b.make_server();b.PORT=self.server.server_address[1];self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  ident2=self.enqueue(p);self.assertIsNone(self.req());self.assertTrue((b.RUNTIME/(ident2+'.blocked.json')).exists())
 def test_path_traversal_rejected(self):
  with self.assertRaises(ValueError):b.permit_path(b.RUNTIME,'../../acceptance')
 def test_read_only_server_never_consumes_a_send_permit(self):
  self.server.shutdown();self.server.server_close();b.PORT=0
  self.server=b.make_server(read_only=True);b.PORT=self.server.server_address[1]
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  p=self.arm();ident=self.enqueue(p)
  self.assertIsNone(self.req())
  self.assertEqual(json.loads(b.permit_path(b.RUNTIME,p['permitId']).read_text(encoding='utf-8'))['state'],'armed')
  self.assertTrue((b.RUNTIME/(ident+'.blocked.json')).exists())
if __name__=='__main__':unittest.main()

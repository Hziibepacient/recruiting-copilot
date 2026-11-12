"""Recovery/receipt tests use temporary storage and never contact a browser."""
import importlib.util, pathlib, tempfile, unittest, uuid, json, types, sys, io, contextlib, multiprocessing, time
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]))
import ledger, permits
spec=importlib.util.spec_from_file_location('reliable_operator',pathlib.Path(__file__).parents[1]/'outreach_operator.py')
op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)


def add_pending(root, cid, queue):
    record={'platform':'liepin','account_id':'test','candidate_id':cid,'job_id':'1','status':'pending','authorization_confirmed':True,'source_url':'https://example.test','detail_evidence':'local-test','greeting':'test'}
    config={'required_gate_keys':[],'daily_limit':60,'greeting':{'mode':'custom'}}
    try:ledger.append_record(pathlib.Path(root),record,config);queue.put('saved')
    except ValueError:queue.put('blocked')


class ReliabilityTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
  op.ROOT=self.root/'project';op.RUNTIME=op.ROOT/'.runtime';op.ledger=lambda:ledger
  self.ident=str(uuid.uuid4());self.command=str(uuid.uuid4());self.attempt=op.RUNTIME/'attempts'/self.ident
  self.p={**permits.SCOPE,'state':'consumed','permitId':self.ident,'commandId':self.command,'candidateId':'IndependentCandidate02','usercId':'b'*32}
  self.config={'required_gate_keys':[],'daily_limit':60,'greeting':{'mode':'platform_default','expected_default_text':permits.SCOPE['greeting']}}
  self.record={'platform':'liepin','account_id':permits.SCOPE['account'],'job_id':permits.SCOPE['jobId'],'candidate_id':self.p['candidateId'],'permit_id':self.ident,'detail_evidence':str(self.root/'evidence'/'screening.json'),'source_url':'https://example.test','greeting':permits.SCOPE['greeting'],'authorization_confirmed':True,'status':'pending'}
  op.save(self.attempt/'record.json',self.record);op.save(self.attempt/'config.json',self.config);op.save(permits.permit_path(op.RUNTIME,self.ident),self.p)
  self.lr=op.RUNTIME/'ledger';ledger.append_record(self.lr,self.record,self.config)
 def tearDown(self):self.tmp.cleanup()
 def finish(self,body):
  file=self.root/'result.json';op.save(file,{'id':self.command,'result':{'ok':True,'data':body}})
  with contextlib.redirect_stdout(io.StringIO()) as output:op.finish(types.SimpleNamespace(permit_id=self.ident,result=str(file)))
  return json.loads(output.getvalue())
 def success(self):return {'verified':True,'candidateId':self.p['candidateId'],'usercId':self.p['usercId'],'receipt':'same candidate now contacted'}
 def test_finish_is_idempotent_and_rejects_conflict(self):
  first=self.finish(self.success());before=[p.read_bytes() for p in self.lr.glob('*.jsonl')]
  repeated=self.finish(self.success());self.assertEqual(first['status'],'verified');self.assertTrue(repeated['duplicate'])
  self.assertEqual(before,[p.read_bytes() for p in self.lr.glob('*.jsonl')])
  with self.assertRaisesRegex(ValueError,'Conflicting'):self.finish({**self.success(),'receipt':'different receipt'})
  self.assertEqual(before,[p.read_bytes() for p in self.lr.glob('*.jsonl')])
 def test_unbound_not_sent_stays_uncertain(self):
  self.assertEqual(self.finish({'notSent':True,'error':'old vague error'})['status'],'uncertain')
 def test_bound_preflight_no_click_can_release_pending(self):
  self.assertEqual(self.finish({'notSent':True,'submitted':False,'phase':'preflight','candidateId':self.p['candidateId'],'usercId':self.p['usercId'],'error':'already contacted before send'})['status'],'not_sent')
 def test_truthy_verified_is_not_verified(self):
  self.assertEqual(self.finish({**self.success(),'verified':'true'})['status'],'uncertain')
 def test_empty_receipt_is_not_verified(self):
  self.assertEqual(self.finish({**self.success(),'receipt':''})['status'],'uncertain')
 def test_missing_receipt_is_not_verified(self):
  self.assertEqual(self.finish({**self.success(),'receipt':None})['status'],'uncertain')
 def test_unsubmitted_receipt_is_not_verified(self):
  self.assertEqual(self.finish({**self.success(),'submitted':False})['status'],'uncertain')
 def test_contradictory_send_flags_stay_uncertain(self):
  self.assertEqual(self.finish({**self.success(),'notSent':True,'submitted':False,'phase':'preflight'})['status'],'uncertain')
 def test_result_evidence_is_saved_inside_runtime_even_with_legacy_evidence_path(self):
  self.finish(self.success())
  self.assertTrue((self.attempt/'send-result.json').exists())
  self.assertFalse((self.root/'evidence').exists())
 def test_preparing_permit_can_be_cancelled_after_crash(self):
  p={k:v for k,v in self.p.items() if k!='commandId'};p['state']='preparing';op.save(permits.permit_path(op.RUNTIME,self.ident),p)
  a=types.SimpleNamespace(permit_id=self.ident)
  result=op._recover_arm(a);self.assertEqual(result['status'],'not_sent')
  self.assertEqual(op.read(permits.permit_path(op.RUNTIME,self.ident))['state'],'cancelled_before_dispatch')
  self.assertTrue(op._recover_arm(a)['duplicate'])
 def test_consumed_or_armed_permit_cannot_use_arm_recovery(self):
  for state in ('armed','consumed'):
   op.save(permits.permit_path(op.RUNTIME,self.ident),{**self.p,'state':state})
   with self.assertRaises(ValueError):op._recover_arm(types.SimpleNamespace(permit_id=self.ident))
 def test_leased_preparing_permit_cannot_release_pending(self):
  p={k:v for k,v in self.p.items() if k!='commandId'};p['state']='preparing';op.save(permits.permit_path(op.RUNTIME,self.ident),p)
  op.save(op.RUNTIME/(self.command+'.leased.json'),{'command':{'permitId':self.ident}})
  with self.assertRaisesRegex(ValueError,'Leased'):op._recover_arm(types.SimpleNamespace(permit_id=self.ident))
 def test_wrong_permit_cannot_resolve_pending(self):
  bad={**self.record,'permit_id':str(uuid.uuid4()),'status':'verified','receipt':'wrong permit'}
  with self.assertRaisesRegex(ValueError,'pending permit'):ledger.append_record(self.lr,bad,self.config)
 def test_nonfinite_expiry_rejected(self):
  p={**self.p,'state':'armed','digest':'a'*64,'batchId':'test'};request={'permitId':self.ident,'candidateId':p['candidateId']}
  for expiry in [float('nan'),float('inf'),float('-inf'),True]:
   with self.assertRaises(ValueError):permits.validate_permit({**p,'expiresAt':expiry},request)
 def test_concurrent_processes_cannot_both_add_pending(self):
  target=self.root/'parallel-ledger';ctx=multiprocessing.get_context('spawn');q=ctx.Queue()
  processes=[ctx.Process(target=add_pending,args=(str(target),'candidate'+str(i),q)) for i in range(2)]
  for process in processes:process.start()
  for process in processes:process.join(10);self.assertEqual(process.exitcode,0)
  self.assertEqual(sorted([q.get(timeout=2),q.get(timeout=2)]),['blocked','saved'])
  self.assertEqual(len(ledger.read_events(target)),1)
 def arm_inputs(self):
  op.ROOT=self.root/'arm-area'/'project';op.RUNTIME=op.ROOT/'.runtime'
  quote='synthetic project evidence';digest=op.hashlib.sha256(quote.encode()).hexdigest()
  cid='SyntheticCandidate001';gates={key:{'state':'pass','quote':quote} for key in ['education','backend','expected_city','agent','delivery']}
  decision={**permits.SCOPE,'candidateId':cid,'digest':digest,'direction':'通用','approved':True,'gates':gates}
  prep={**permits.SCOPE,'candidateId':cid,'digest':digest,'batchId':'batch-test','usercId':'b'*32,'ready':True,'preparedAt':op.dt.datetime.now(op.dt.timezone.utc).isoformat()}
  snapshot={'candidateId':cid,'text':quote,'digest':digest,'complete':True,'url':'https://example.test'}
  state={'config':{**permits.SCOPE,'jobTitle':'test','dailyLimit':60,'batchLimit':20,'switchAfter':10},'run':{'batchId':'batch-test'},'events':[],'historyAccount':permits.SCOPE['account'],'queue':[decision],'preparedReview':prep}
  paths={}
  for key,value in [('decision',decision),('prepare',prep),('snapshot',snapshot),('state',state)]:
   path=self.root/(key+'.json');op.save(path,value);paths[key]=str(path)
  return types.SimpleNamespace(**paths,keyword='test',tab_id=1)
 def test_failed_promotion_after_pending_cancels_without_send(self):
  args=self.arm_inputs()
  original=op.save
  def fail_promotion(path,value):
   if path.parent.name=='permits' and value.get('state')=='armed':raise OSError('simulated disk error before atomic promotion')
   return original(path,value)
  op.save=fail_promotion
  try:
   with self.assertRaisesRegex(OSError,'simulated disk'):op.arm(args)
  finally:op.save=original
  events=ledger.read_events(op.RUNTIME/'ledger')
  attempt_events=[e for e in events if e.get('candidate_id')==op.read(args.decision)['candidateId']]
  self.assertEqual([e['status'] for e in attempt_events],['pending','not_sent'])
  saved=next((op.RUNTIME/'permits').glob('*.json'))
  self.assertEqual(op.read(saved)['state'],'cancelled_before_dispatch')
 def test_future_preparation_is_rejected_before_any_permit_or_evidence_write(self):
  args=self.arm_inputs();prep=op.read(args.prepare);state=op.read(args.state)
  prep['preparedAt']=(op.dt.datetime.now(op.dt.timezone.utc)+op.dt.timedelta(hours=1)).isoformat();state['preparedReview']=prep
  op.save(pathlib.Path(args.prepare),prep);op.save(pathlib.Path(args.state),state)
  with self.assertRaisesRegex(ValueError,'future-dated'):op.arm(args)
  self.assertFalse(op.RUNTIME.exists())
 def test_synthetic_arm_http_consume_finish_chain_is_confined_to_project(self):
  import bridge, threading, urllib.request
  from unittest.mock import patch
  args=self.arm_inputs()
  with contextlib.redirect_stdout(io.StringIO()) as output:op.arm(args)
  armed=json.loads(output.getvalue());ident=armed['permitId'];command=str(uuid.uuid4())
  self.assertTrue(pathlib.Path(armed['evidence']).is_relative_to(op.RUNTIME))
  (op.ROOT/'extension').mkdir()
  with patch.multiple(bridge,ROOT=op.ROOT,RUNTIME=op.RUNTIME,PORT=0):
   server=bridge.make_server();bridge.PORT=server.server_address[1]
   thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   config=bridge.init();headers={'Authorization':'Bearer '+config['token'],'X-TTC-Client':'direct-1'}
   try:
    request=op.read(armed['requestFile'])
    bridge.save(op.RUNTIME/(command+'.command.json'),{'id':command,'expiresAt':time.time()+45,'command':request})
    with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{bridge.PORT}/next',headers=headers)) as response:leased=json.load(response)
    permit=leased['command']['_permit'];self.assertEqual(permit['state'],'consumed')
    # The extension response is synthetic; no platform or real browser is used.
    envelope={'id':command,'result':{'ok':True,'data':{'verified':True,'candidateId':permit['candidateId'],'usercId':permit['usercId'],'receipt':'synthetic same-candidate receipt'}}}
    with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{bridge.PORT}/result',data=json.dumps(envelope).encode(),headers=headers)) as response:self.assertEqual(response.status,200)
    with contextlib.redirect_stdout(io.StringIO()) as finished:
     op.finish(types.SimpleNamespace(permit_id=ident,result=str(op.RUNTIME/(command+'.result.json'))))
    self.assertEqual(json.loads(finished.getvalue())['status'],'verified')
    events=ledger.read_events(op.RUNTIME/'ledger');self.assertEqual([e['status'] for e in events],['pending','verified'])
    self.assertTrue(pathlib.Path(events[-1]['receipt_file']).is_relative_to(op.RUNTIME))
    self.assertFalse((op.ROOT.parent/'output').exists())
   finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()

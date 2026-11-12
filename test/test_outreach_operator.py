"""Rejection paths must not publish receipts or mutate ledgers."""
import importlib.util, pathlib, tempfile, unittest, uuid, json, types, sys
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]))
spec=importlib.util.spec_from_file_location('tested_outreach_operator',pathlib.Path(__file__).parents[1]/'outreach_operator.py')
op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)

class FinishRejectionTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();op.ROOT=pathlib.Path(self.tmp.name);op.RUNTIME=op.ROOT/'.runtime'
  self.ident=str(uuid.uuid4());self.command=str(uuid.uuid4());self.calls=[]
  op.ledger=lambda:types.SimpleNamespace(append_record=lambda *args:self.calls.append(args))
  self.p={**op.SCOPE,'state':'consumed','permitId':self.ident,'commandId':self.command,'candidateId':'IndependentCandidate02','usercId':'b'*32}
  self.attempt=op.RUNTIME/'attempts'/self.ident
  self.record={'permit_id':self.ident,'candidate_id':self.p['candidateId'],'detail_evidence':str(op.ROOT/'evidence'/'screening.json'),'status':'pending'}
  op.save(self.attempt/'record.json',self.record);op.save(self.attempt/'config.json',{})
 def tearDown(self):self.tmp.cleanup()
 def reject(self,envelope):
  op.save(op.permit_path(op.RUNTIME,self.ident),self.p);path=op.ROOT/'input-result.json';op.save(path,envelope)
  before={str(p.relative_to(op.ROOT)):p.read_bytes() for p in op.ROOT.rglob('*') if p.is_file()}
  with self.assertRaises(ValueError):op.finish(types.SimpleNamespace(permit_id=self.ident,result=str(path)))
  after={str(p.relative_to(op.ROOT)):p.read_bytes() for p in op.ROOT.rglob('*') if p.is_file() and p.name!='transaction.lock'}
  self.assertEqual(before,after);self.assertEqual(self.calls,[])
 def test_wrong_result_id_has_no_writes(self):
  self.reject({'id':str(uuid.uuid4()),'result':{'ok':True,'data':{'verified':True,'candidateId':self.p['candidateId'],'usercId':self.p['usercId'],'receipt':'wrong command'}}})
 def test_unconsumed_not_sent_has_no_writes(self):
  self.p['state']='armed';self.reject({'id':self.command,'result':{'ok':True,'data':{'notSent':True,'error':'test'}}})
if __name__=='__main__':unittest.main()

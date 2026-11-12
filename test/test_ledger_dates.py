"""Cross-day accounting is a read projection, never a historical rewrite."""
import unittest, tempfile, pathlib, datetime as dt, json, sys
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]))
import ledger

class CrossDayTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
  self.day1=dt.datetime(2026,10,28,23,58,tzinfo=ledger.TZ)
  self.day2=dt.datetime(2026,10,29,9,0,tzinfo=ledger.TZ)
  self.config={'required_gate_keys':[],'daily_limit':60,'greeting':{'mode':'custom'}}
  self.record={'platform':'liepin','account_id':'synthetic','candidate_id':'candidate-a','job_id':'1','permit_id':'permit-a','status':'pending','authorization_confirmed':True,'source_url':'https://example.test','detail_evidence':'synthetic','greeting':'test'}
 def tearDown(self):self.tmp.cleanup()
 def test_cross_day_pending_then_verified_credits_attempt_day(self):
  ledger.append_record(self.root,self.record,self.config,now=self.day1)
  ledger.append_record(self.root,{**self.record,'status':'uncertain'},self.config,now=self.day2)
  today=ledger.summary(self.root,'2026-10-29')
  self.assertEqual(today['conservative_used_today'],0)
  self.assertEqual(len(today['unresolved_all_dates']),1)
  self.assertEqual(today['unresolved_all_dates'][0]['date'],'2026-10-28')
  with self.assertRaisesRegex(ValueError,'unresolved ledger'):
   ledger.append_record(self.root,{**self.record,'candidate_id':'candidate-b','permit_id':'permit-b'},self.config,now=self.day2)
  ledger.append_record(self.root,{**self.record,'status':'verified','receipt':'same candidate receipt'},self.config,now=self.day2)
  prior,today=ledger.summary(self.root,'2026-10-28'),ledger.summary(self.root,'2026-10-29')
  self.assertEqual(prior['counts']['verified'],1);self.assertEqual(prior['counts']['pending'],0)
  self.assertEqual(prior['conservative_used_today'],1);self.assertEqual(today['conservative_used_today'],0)
  self.assertEqual(today['counts']['verified'],0);self.assertEqual(today['unresolved_all_dates'],[])
  terminal=ledger.read_events(self.root)[-1]
  self.assertEqual(terminal['attempt_day'],'2026-10-28');self.assertEqual(terminal['time'],self.day2.isoformat())
  self.assertEqual(terminal['_date'],'2026-10-29');self.assertIsNone(today['platform_remaining'])
 def test_legacy_same_permit_infers_original_day_without_rewriting(self):
  key=ledger.identity_key(self.record)
  pending={**self.record,'key':key,'time':self.day1.isoformat()}
  final={**self.record,'key':key,'status':'verified','receipt':'legacy receipt','time':self.day2.isoformat()}
  for date,value in [('2026-10-28',pending),('2026-10-29',final)]:
   (self.root/(date+'.jsonl')).write_text(json.dumps(value)+'\n',encoding='utf-8')
  before={p.name:p.read_bytes() for p in self.root.glob('*.jsonl')}
  self.assertEqual(ledger.summary(self.root,'2026-10-28')['counts']['verified'],1)
  self.assertEqual(ledger.summary(self.root,'2026-10-29')['counts']['verified'],0)
  self.assertEqual(before,{p.name:p.read_bytes() for p in self.root.glob('*.jsonl')})
 def test_attempt_day_cannot_be_moved_by_terminal_record(self):
  ledger.append_record(self.root,self.record,self.config,now=self.day1)
  ledger.append_record(self.root,{**self.record,'status':'verified','receipt':'test','attempt_day':'1999-01-01'},self.config,now=self.day2)
  self.assertEqual(ledger.read_events(self.root)[-1]['attempt_day'],'2026-10-28')
 def test_pending_uses_shanghai_day_even_when_caller_passes_utc(self):
  utc=dt.datetime(2026,10,28,17,0,tzinfo=dt.timezone.utc)
  ledger.append_record(self.root,self.record,self.config,now=utc)
  event=ledger.read_events(self.root)[0]
  self.assertEqual(event['_date'],'2026-10-29');self.assertEqual(event['attempt_day'],'2026-10-29')

if __name__=='__main__':unittest.main()

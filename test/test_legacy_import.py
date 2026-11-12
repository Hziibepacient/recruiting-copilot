import importlib.util, json, pathlib, tempfile, unittest
spec=importlib.util.spec_from_file_location('legacy_import',pathlib.Path(__file__).parents[1]/'tools'/'import-legacy-ledger.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ImportTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
  self.src=self.root/'old';self.src.mkdir();self.dst=self.root/'project'/'.runtime'/'ledger'
  self.file=self.src/'2026-10-30.jsonl'
  self.file.write_text(json.dumps({'key':'fixture|test|candidate|1','status':'verified'})+'\n',encoding='utf-8')
 def tearDown(self):self.temp.cleanup()
 def test_copy_is_exact_idempotent_and_never_changes_source(self):
  original=self.file.read_bytes();first=mod.import_ledger(self.src,self.dst)
  self.assertEqual(first['copied'],1);self.assertTrue(first['sourceUnchanged'])
  self.assertEqual((self.dst/self.file.name).read_bytes(),original);self.assertEqual(self.file.read_bytes(),original)
  self.assertEqual(mod.import_ledger(self.src,self.dst)['copied'],0)
 def test_conflicting_destination_is_preserved(self):
  self.dst.mkdir(parents=True);target=self.dst/self.file.name;target.write_bytes(b'existing')
  with self.assertRaisesRegex(ValueError,'conflict'):mod.import_ledger(self.src,self.dst)
  self.assertEqual(target.read_bytes(),b'existing')
 def test_invalid_source_never_creates_destination(self):
  self.file.write_text('invalid')
  with self.assertRaises(ValueError):mod.import_ledger(self.src,self.dst)
  self.assertFalse(self.dst.exists())

import importlib.util
from pathlib import Path
import tempfile, unittest, zipfile
spec=importlib.util.spec_from_file_location('public_build',Path(__file__).parents[1]/'build.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class PublicBuildTests(unittest.TestCase):
 def test_private_files_excluded_and_source_unchanged(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'project';(root/'extension').mkdir(parents=True)
   for name,body in {'extension/manifest.json':'{}','extension/bridge-config.json':'SECRET','history-verified.json':'PRIVATE','开发与独立审核记录.md':'PRIVATE','extension/core.mjs':'DEMO_ACCOUNT 10000000','extension/outreach-scope.json':'PRIVATE'}.items():(root/name).write_text(body,encoding='utf-8')
   (root/'.runtime').mkdir();(root/'.runtime'/'test.json').write_text('SECRET')
   before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
   target=Path(tmp)/'result.zip';b.build(target,root)
   self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})
   with zipfile.ZipFile(target) as archive:
    payload=b'\n'.join(archive.read(n) for n in archive.namelist())
    for forbidden in [b'SECRET',b'PRIVATE']:
     if forbidden not in (b'DEMO_ACCOUNT',b'10000000'):self.assertNotIn(forbidden,payload)
    self.assertIn(b'DEMO_ACCOUNT',payload)
if __name__=='__main__':unittest.main()

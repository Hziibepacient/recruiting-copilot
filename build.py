"""Build a shareable archive without personal runtime data or credentials."""
import argparse, hashlib, json, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
PUBLIC_DIRS={'extension','test','demo','tools','docs'}
PUBLIC_ROOTS={'README.md','使用说明.md','build.py','bridge.py','permits.py','outreach_operator.py','ledger.py','.gitignore','package.json'}
SUFFIXES={'.js','.mjs','.html','.css','.md','.py','.ps1','.json'}
EXCLUDED={'bridge-config.json','history-verified.json','outreach-scope.json'}
def selected_files(root=ROOT):
 for path in sorted(root.rglob('*')):
  if not path.is_file():continue
  rel=path.relative_to(root)
  if any((part.startswith('.') and part!='.gitignore') or part=='__pycache__' for part in rel.parts):continue
  if path.name in EXCLUDED or '2026-10-30' in path.name:continue
  if (rel.parts[0] in PUBLIC_DIRS and path.suffix in SUFFIXES) or (len(rel.parts)==1 and path.name in PUBLIC_ROOTS):yield path,rel.as_posix()
def build(target,root=ROOT):
 target=Path(target);target.parent.mkdir(parents=True,exist_ok=True);entries=[]
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
  for path,name in selected_files(root):
   body=path.read_text(encoding='utf-8-sig')
   archive.writestr(name,body);entries.append({'path':name,'sha256':hashlib.sha256(body.encode()).hexdigest()})
  archive.writestr('PUBLIC-BUILD.md','# 脱敏源码包\n\n账号及职位替换为演示值，未配置生产发送。未包含真实简历、台账、浏览器配置或令牌。演示入口 demo/index.html 不调用AI或招聘平台。\n')
  archive.writestr('MANIFEST.sha256.json',json.dumps(entries,indent=2))
 with zipfile.ZipFile(target) as archive:
  assert archive.testzip() is None
  assert 'extension/manifest.json' in archive.namelist()
  assert not any('bridge-config.json' in n or '.runtime' in n or 'history-verified' in n for n in archive.namelist())
 return {'archive':str(target),'files':len(entries)+2,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'profile':'public-source-allowlist'}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',default=str(ROOT/'release'/('TTC-Recruiting-Copilot-'+json.loads((ROOT/'extension'/'manifest.json').read_text(encoding='utf-8'))['version']+'-source.zip')))
 print(json.dumps(build(p.parse_args().output),ensure_ascii=False))

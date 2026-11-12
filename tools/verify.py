"""Run isolated tests; never operates the user's browser or production ledger."""
import datetime as dt, json, os, re, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def run(args):
 start=time.perf_counter()
 result=subprocess.run(args,cwd=ROOT,env={**os.environ,'PYTHONIOENCODING':'utf-8'},capture_output=True,text=True,encoding='utf-8',errors='replace')
 return {'exitCode':result.returncode,'seconds':round(time.perf_counter()-start,3),'output':result.stdout+result.stderr}
def main():
 groups={'node':run(['node','--test','--test-reporter=tap',*[str(p) for p in sorted((ROOT/'test').glob('*.test.mjs'))]]),'python':run([sys.executable,'-m','unittest','discover','-s','test','-p','test_*.py','-v'])}
 for kind,item in groups.items():
  m=re.search(r'^# tests (\d+)' if kind=='node' else r'Ran (\d+) tests?',item['output'],re.M);item['total']=int(m.group(1)) if m else None
 report={'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'release':json.loads((ROOT/'extension'/'manifest.json').read_text(encoding='utf-8'))['version'],'node':subprocess.check_output(['node','--version'],text=True).strip(),'python':sys.version.split()[0],'groups':{k:{a:b for a,b in v.items() if a!='output'} for k,v in groups.items()},'allPassed':all(v['exitCode']==0 for v in groups.values()),'scope':'Synthetic fixtures and isolated localhost services. No real candidates or messages.'}
 (ROOT/'docs'/'test-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 local=ROOT/'.runtime'/'test-results';local.mkdir(parents=True,exist_ok=True)
 for k,v in groups.items():(local/(k+'.log')).write_text(v['output'],encoding='utf-8')
 print(json.dumps(report,ensure_ascii=False,indent=2))
 if not report['allPassed']:
  for v in groups.values():
   if v['exitCode']:print(v['output'][-12000:])
  return 1
 return 0
if __name__=='__main__':raise SystemExit(main())

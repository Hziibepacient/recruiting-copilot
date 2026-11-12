"""Check tracked source or a release archive without printing sensitive matches."""
import argparse, json, re, subprocess, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PRIVATE={'bridge-config.json','outreach-scope.json','history-verified.json'}

def inspect(entries, private_values=()):
 findings=[]
 for name,body in entries:
  parts=Path(name).parts
  if any(part in {'.runtime','__pycache__','.git','node_modules'} or part.startswith('backup') for part in parts) or Path(name).name in PRIVATE or Path(name).suffix in {'.log','.jsonl','.har'}:
   findings.append({'path':name,'reason':'private artifact'})
  text=body.decode('utf-8',errors='replace')
  if any(value and value in text for value in private_values):findings.append({'path':name,'reason':'local account or job identifier'})
  if re.search(r'(?<!\d)1[3-9]\d{9}(?!\d)',text):findings.append({'path':name,'reason':'possible phone number'})
  if re.search(r'(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)',text):findings.append({'path':name,'reason':'possible credential'})
 return findings

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--archive',type=Path);args=parser.parse_args()
 values=[];scope=ROOT/'extension'/'outreach-scope.json'
 if scope.exists():
  value=json.loads(scope.read_text(encoding='utf-8-sig'));values=[value.get('account'),value.get('jobId')]
 bridge=ROOT/'extension'/'bridge-config.json'
 if bridge.exists():values.append(json.loads(bridge.read_text(encoding='utf-8-sig')).get('token'))
 if args.archive:
  with zipfile.ZipFile(args.archive) as archive:entries=[(name,archive.read(name)) for name in archive.namelist()]
 else:
  names=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
  entries=[(name,(ROOT/name).read_bytes()) for name in names if name]
 result={'scope':'archive' if args.archive else 'tracked source','files':len(entries),'findings':inspect(entries,values),'limitation':'Pattern checks and local account/job matching; manual review is still required for candidate prose and new secret formats.'}
 print(json.dumps(result,ensure_ascii=False,indent=2))
 return 1 if result['findings'] else 0
if __name__=='__main__':raise SystemExit(main())

"""Copy an existing ledger into private project storage without modifying its source."""
import argparse, hashlib, json, sys, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from ledger import read_events, file_lock

def import_ledger(source, destination):
 source=Path(source).resolve();destination=Path(destination).resolve()
 if source==destination:raise ValueError('Source and destination must differ')
 paths=sorted(source.glob('????-??-??.jsonl'))
 if not paths:raise ValueError('No dated ledger files found')
 bodies={p.name:p.read_bytes() for p in paths}
 events=read_events(source)  # Reject damaged history before copying anything.
 if any(p.read_bytes()!=bodies[p.name] for p in paths):raise ValueError('Source changed during validation')
 with file_lock(destination/'.ledger.lock'):
  for name,body in bodies.items():
   target=destination/name
   if target.exists() and target.read_bytes()!=body:raise ValueError('Destination conflict: '+name)
  copied=0
  for name,body in bodies.items():
   target=destination/name
   if not target.exists():
    temp=destination/(name+'.'+uuid.uuid4().hex+'.tmp');temp.write_bytes(body);temp.replace(target);copied+=1
   if hashlib.sha256(target.read_bytes()).digest()!=hashlib.sha256(body).digest():raise OSError('Copy verification failed')
 return {'files':len(bodies),'copied':copied,'events':len(events),'sourceUnchanged':all(p.read_bytes()==bodies[p.name] for p in paths),'sha256':{name:hashlib.sha256(body).hexdigest() for name,body in bodies.items()}}

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True)
 args=parser.parse_args();print(json.dumps(import_ledger(args.source,ROOT/'.runtime'/'ledger'),indent=2))

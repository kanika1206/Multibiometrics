"""Remove build/test-only wheel contents from staging and candidate, preserving models/code."""
from pathlib import Path
import json,hashlib,csv,io
from production_exclusions import excluded
ROOT=Path(__file__).resolve().parents[1]
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def prune(runtime):
 site=runtime/'Lib/site-packages';removed=[]
 for p in sorted(site.rglob('*')):
  if p.is_file() and excluded(p.relative_to(site).as_posix()):
   removed.append({'path':p.relative_to(runtime).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)});p.unlink()
 for p in sorted(site.rglob('*'),key=lambda p:len(p.parts),reverse=True):
  if p.is_dir() and not any(p.iterdir()):p.rmdir()
 for record in site.glob('*.dist-info/RECORD'):
  rows=list(csv.reader(io.StringIO(record.read_text())));kept=[]
  for row in rows:
   target=(site/row[0]).resolve()
   if target.is_relative_to(runtime.resolve()) and not target.is_file():continue
   kept.append(row)
  if rows!=kept:
   out=io.StringIO();csv.writer(out,lineterminator='\n').writerows(kept);record.write_text(out.getvalue())
 inv=runtime/'runtime-inventory.json'
 if inv.exists():
  rows=json.loads(inv.read_text());rows=[r for r in rows if (runtime/r['path']).is_file()]
  for row in rows:
   p=runtime/row['path'];row['sha256']=sha(p);row['bytes']=p.stat().st_size
   if p.name=='RECORD':row['packaging_note']='RECORD filtered to shipped files; upstream wheel unchanged in provisioning'
  inv.write_text(json.dumps(rows,indent=2)+'\n')
 return removed
if __name__=='__main__':
 roots=[ROOT/'provisioning/windows/runtime',ROOT/'packaging/target-run/payload/runtime'];reports={str(p.relative_to(ROOT)):prune(p) for p in roots}
 candidate=ROOT/'packaging/target-run/payload';manifest=candidate/'candidate-inventory.json'
 rows=json.loads(manifest.read_text());rows=[r for r in rows if (candidate/r['path']).is_file()]
 for row in rows:
  p=candidate/row['path'];row['sha256']=sha(p);row['bytes']=p.stat().st_size
 manifest.write_text(json.dumps(rows,indent=2)+'\n')
 history=ROOT/'evidence/build-tool-removal.json'
 if history.exists():
  prior=json.loads(history.read_text())
  for key,rows in prior.items():reports[key]=rows+reports.get(key,[])
 history.write_text(json.dumps(reports,indent=2)+'\n')
 print({k:{'files':len(v),'bytes':sum(r['bytes'] for r in v)} for k,v in reports.items()})

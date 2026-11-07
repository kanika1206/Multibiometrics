"""Audit the actual final ZIP, not a dependency lock or build environment."""
from pathlib import Path
import zipfile,json,collections,hashlib
from production_exclusions import excluded
ROOT=Path(__file__).resolve().parents[1]
forbidden={'torch','speechbrain','torchaudio','torchvision','pytest','setuptools','wheel','pip','onnxscript','onnxoptimizer'}
with zipfile.ZipFile(ROOT/'packaging/windows-target-run.zip') as z:
 rows=json.loads(z.read('payload/runtime/runtime-inventory.json'));owners={r['path']:r['name'] for r in rows}
 groups=collections.defaultdict(lambda:{'compressed_bytes':0,'raw_bytes':0});bad=[];dists=[]
 for entry in z.infolist():
  n=entry.filename
  if n.startswith('payload/runtime/Lib/site-packages/'):
   rel=n.removeprefix('payload/runtime/Lib/site-packages/')
   first=rel.split('/')[0]
   if first.endswith('.dist-info'):dists.append(first)
   if first.lower() in forbidden or any(first.lower().startswith(x+'-') and first.endswith('.dist-info') for x in forbidden) or excluded(rel):bad.append(n)
  if any(x in n.split('/') for x in ('export-env','.venv','wheelhouse','ecapa-source')):bad.append(n)
  if n.startswith('payload/assets/face/'):group='Face models (detector + recognizer)'
  elif n.startswith('payload/assets/windows-tools/'):group='Windows FFmpeg + ffprobe'
  elif n.startswith('payload/assets/vosk-'):group='Vosk ASR model'
  elif n=='payload/assets/ecapa-waveform.onnx':group='ECAPA ONNX model'
  elif n.endswith('inventory.json'):group='Inventory metadata'
  elif n.startswith('payload/runtime/'):group=owners.get(n.removeprefix('payload/runtime/'),'Runtime configuration')
  else:group='Application and acceptance pack'
  groups[group]['compressed_bytes']+=entry.compress_size;groups[group]['raw_bytes']+=entry.file_size
 inventory=json.loads(z.read('pack-inventory.json'))
 assert set(z.namelist())=={r['path'] for r in inventory['files']}|{'pack-inventory.json'}
 for row in inventory['files']:
  with z.open(row['path']) as f:assert hashlib.file_digest(f,'sha256').hexdigest()==row['sha256'],row['path']
 metrics=json.loads((ROOT/'packaging/windows-target-run.metrics.json').read_text())
 report={'status':'PASS' if not bad else 'FAIL','forbidden_entries':bad,'distributions':sorted(set(dists)),'top_components':sorted([{'component':k,**v} for k,v in groups.items()],key=lambda r:-r['compressed_bytes'])[:10],'archive_bytes':metrics['bytes'],'archive_sha256':metrics['sha256'],'qualification':'STATIC_ONLY; Windows remains unverified','runtime_retained':'ONNX required by ArcFace onnx.load; numpy._pytesttester and scipy._lib._testutils are eagerly imported runtime API scaffolding, not pytest installation. WHEEL metadata is not the wheel build package.'}
 (ROOT/'evidence/final-production-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='distributions'},indent=2));assert not bad

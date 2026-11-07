"""Attach precise per-file provenance to the already assembled candidate inventory."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[1];payload=ROOT/'packaging/target-run/payload'
manifest=json.loads((payload/'candidate-inventory.json').read_text())
provenance={r['path']:r for r in json.loads((ROOT/'provisioning-manifest.json').read_text())['files']}
codec=json.loads((ROOT/'provisioning/windows/ffmpeg-upstream.json').read_text())
for row in manifest:
 relative=row['path'];p=payload/relative
 with p.open('rb') as f:row['sha256']=hashlib.file_digest(f,'sha256').hexdigest()
 row['bytes']=p.stat().st_size;row['required']=True;row['missing_error']='ASSET_MISSING';row['corrupt_error']='ASSET_INVALID';row['local_load_path']=relative
 if relative.startswith(('app/','core/')) or relative.endswith('.cmd') or relative=='CANDIDATE-NOT-QUALIFIED.txt':
  row.update(source='local offline-prototype/'+relative,version='Phase 1 source; SHA-256 identity',license='Project source')
 elif relative in provenance:
  original=provenance[relative]
  for key in ('name','version','source'):row[key]=original[key]
 elif relative.startswith('assets/windows-tools/'):
  row.update(name='FFmpeg/ffprobe',version='8.1 branch; pinned archive/file SHA-256',source=codec['browser_download_url'],license='LGPL; bundled LICENSE.txt')
 elif relative=='assets/release-manifest.json':row.update(source='local packaging/stage_windows.py',version='P1 CANDIDATE manifest',license='Project metadata')
 elif relative=='runtime/runtime-inventory.json':row.update(source='local packaging/stage_windows.py',version='P1 Windows runtime inventory',license='Project metadata')
(payload/'candidate-inventory.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(len(manifest))

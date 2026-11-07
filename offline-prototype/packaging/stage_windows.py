"""Offline assembly from already acquired archives/wheels. No network or target execution."""
from pathlib import Path
import json,hashlib,shutil,zipfile,importlib.metadata as md
ROOT=Path(__file__).resolve().parents[1];src=ROOT/'provisioning/windows';runtime=src/'runtime'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
if runtime.exists():raise SystemExit('New runtime staging directory required')
# Exclude package/build tools, headers, static link libraries, tests and bytecode.
def ignore(directory,names):
 excluded={'__pycache__','include','libs','test','tests','idlelib','ensurepip'}
 if Path(directory).name=='site-packages':excluded.update(n for n in names if n=='pip' or n.startswith('pip-') or n=='bin')
 return set(names)&excluded
shutil.copytree(src/'python',runtime,ignore=ignore)
from prune_build_tools import prune
prune(runtime) # persist production-only policy for future builds
# Python isolated import path: no user site, environment path or external caches.
(runtime/'python312._pth').write_text('.\nDLLs\nLib\nLib/site-packages\nimport site\n')
python_prov=json.loads((src/'python-upstream.json').read_text())
vc=src/'vclibs.appx'
if sha(vc)!='b56a9101f706f9d95f815f5b7fa6efbac972e86573d378b96a07cff5540c5961':raise ValueError('Microsoft archive hash mismatch')
vcfiles=['msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll','msvcp140_codecvt_ids.dll','vcruntime140_1.dll','concrt140.dll','vcomp140.dll']
with zipfile.ZipFile(vc) as z:
 for name in vcfiles:(runtime/name).write_bytes(z.read(name))
(runtime/'MICROSOFT-RUNTIME-NOTICE.txt').write_text('Microsoft Visual C++ Desktop Runtime 14.0.33321.0. App-local DLLs from https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx ; archive SHA256 '+sha(vc)+'. Microsoft copyright/redistribution terms apply. No global installation.\n')
owners={}
for d in md.distributions(path=[str(runtime/'Lib/site-packages')]):
 for f in d.files or []:
  p=Path(d.locate_file(f)).resolve()
  if p.is_file() and p.is_relative_to(runtime):owners[p]=(d.metadata['Name'],d.version,f'https://pypi.org/project/{d.metadata["Name"]}/{d.version}/',d.metadata.get('License-Expression') or d.metadata.get('License') or 'See distribution license files')
rows=[]
for p in sorted(runtime.rglob('*')):
 if not p.is_file():continue
 if p.name in vcfiles:name,version,source,license='Microsoft VCLibs Desktop','14.0.33321.0','https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx','Microsoft runtime redistribution terms'
 elif p in owners:name,version,source,license=owners[p]
 else:name,version,source,license='CPython standalone','3.12.16+20261026',python_prov['browser_download_url'],'PSF and bundled dependency notices'
 if p.name in ('python312._pth','MICROSOFT-RUNTIME-NOTICE.txt'):name,version,source,license='Offline package runtime configuration','P1','local packaging/stage_windows.py','project source'
 rows.append({'path':p.relative_to(runtime).as_posix(),'name':name,'version':version,'source':source,'license':license,'sha256':sha(p),'bytes':p.stat().st_size,'platform':'win_amd64'})
(runtime/'runtime-inventory.json').write_text(json.dumps(rows,indent=2)+'\n')
# Select exactly the runtime models used by the unchanged inference adapter.
dev=json.loads((ROOT/'assets/development-manifest.json').read_text());assetrows=[];copyrows=[]
for r in dev['files']:
 if r['id'] in ('face_detector','face_recognizer','speaker_waveform') or r['path'].startswith('vosk-model-small-en-us-0.15/'):
  p=ROOT/'assets'/r['path']
  if sha(p)!=r['sha256']:raise ValueError('Model changed')
  assetrows.append(r);copyrows.append({'path':'assets/'+r['path'],'destination':r['path'],'sha256':r['sha256']})
codecroot=src/'ffmpeg/ffmpeg-n8.1-latest-win64-lgpl-8.1';upstream=json.loads((src/'ffmpeg-upstream.json').read_text())
for name in ('ffmpeg','ffprobe'):
 p=codecroot/'bin'/(name+'.exe');dest='windows-tools/'+name+'.exe'
 assetrows.append({'id':name,'path':dest,'sha256':sha(p),'bytes':p.stat().st_size})
 copyrows.append({'path':p.relative_to(ROOT).as_posix(),'destination':dest,'sha256':sha(p)})
p=codecroot/'LICENSE.txt';copyrows.append({'path':p.relative_to(ROOT).as_posix(),'destination':'windows-tools/LICENSE.txt','sha256':sha(p)})
assetrows.append({'id':'codec_license','path':'windows-tools/LICENSE.txt','sha256':sha(p),'bytes':p.stat().st_size})
manifest={k:dev[k] for k in ('speaker_contract','vosk_model_dir','model_hashes')};manifest.update(status='CANDIDATE',platform='win_amd64',parity_status='PENDING_TARGET',files=assetrows,codec_source=upstream['browser_download_url'],qualification='UNVERIFIED-ON-TARGET; evaluation entry point only')
p=src/'release-manifest.json';p.write_text(json.dumps(manifest,indent=2)+'\n');copyrows.append({'path':p.relative_to(ROOT).as_posix(),'destination':'release-manifest.json','sha256':sha(p)})
(ROOT/'assets/windows-candidate-manifest.json').write_text(json.dumps({'platform':'win_amd64','files':copyrows},indent=2)+'\n')
archives=[]
for p in sorted(src.rglob('*')):
 if not p.is_file() or not (p.suffix in ('.whl','.appx') or p.name in ('python-windows.tar.gz','ffmpeg-btbn.zip')):continue
 source=python_prov['browser_download_url'] if p.name=='python-windows.tar.gz' else upstream['browser_download_url'] if p.name=='ffmpeg-btbn.zip' else 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx' if p.suffix=='.appx' else 'https://pypi.org/project/'+p.name.split('-')[0]+'/'+p.name.split('-')[1]+'/'
 archives.append({'path':p.relative_to(ROOT).as_posix(),'source':source,'sha256':sha(p),'bytes':p.stat().st_size})
(src/'archive-inventory.json').write_text(json.dumps(archives,indent=2)+'\n')
print(json.dumps({'runtime_files':len(rows),'runtime_bytes':sum(r['bytes'] for r in rows),'asset_files':len(assetrows)}))

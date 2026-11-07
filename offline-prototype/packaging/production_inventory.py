"""Measure only selected production inputs. Missing Windows closure is explicit."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1]
def main():
 manifest=json.loads((ROOT/'assets/development-manifest.json').read_text())
 provenance={r['path']:r for r in json.loads((ROOT/'provisioning-manifest.json').read_text())['files']}
 selected=[]
 for row in manifest['files']:
  if row['id'] in ('face_detector','face_recognizer','speaker_waveform') or row['path'].startswith('vosk-model-small-en-us-0.15/'):
   selected.append(('assets/'+row['path'],'models'))
 for folder in ('core','app'):
  selected.extend((p.relative_to(ROOT).as_posix(),'application') for p in (ROOT/folder).rglob('*.py'))
 out=ROOT/'packaging/target-run';out.mkdir(exist_ok=True)
 rows=[];totals={}
 # Actual deflate archive; excludes Windows runtime/codecs, never called an installer.
 with zipfile.ZipFile(out/'production-inputs.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
  for relative,category in sorted(selected):
   path=ROOT/relative;data=path.read_bytes();archive.writestr(relative,data)
   info=archive.getinfo(relative);prov=provenance.get(relative,{})
   row={'path':relative,'category':category,'bytes':len(data),'deflated_bytes':info.compress_size,'sha256':hashlib.sha256(data).hexdigest(),'name':prov.get('name',path.name),'version':prov.get('version','Phase 1 source SHA-256'),'source':prov.get('source','local offline-prototype source')}
   row.update(purpose=('local inference asset' if category=='models' else 'application source'),platform=('platform-independent model bytes' if category=='models' else 'Windows application / Python source'),license='PENDING redistribution review; source provenance recorded',required=True,local_load_path=relative,dependencies=('Windows inference runtime' if category=='models' else 'Windows Python/Tk and core runtime'),missing_error='ASSET_MISSING',corrupt_error='ASSET_INVALID')
   rows.append(row);group=relative.split('/')[1] if category=='models' else category
   bucket=totals.setdefault(group,{'bytes':0,'deflated_bytes':0})
   for key in bucket:bucket[key]+=row[key]
 size=(out/'production-inputs.zip').stat().st_size
 result={'status':'INCOMPLETE_PRODUCTION_INPUTS_NOT_INSTALLER','files':rows,'groups':totals,'archive_bytes':size,'installer_limit_bytes':300000000,'headroom_before_windows_dependencies_bytes':300000000-size,'missing':['Windows Python with Tk/Tcl and standard library','Windows inference/native dependency closure','Windows ffmpeg/ffprobe and their dependency closure','redistribution notices and installer overhead'],'excludes':['export-env','.venv','wheelhouse','ECAPA training/source checkpoints','unused buffalo_l age/landmark models','Linux codecs','tests','participant data'],'policy':'No selected inference model substituted or quantized. ZIP size is measured, not an estimate of a final installer.'}
 (out/'production-inventory.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items() if k!='files'},indent=2))
if __name__=='__main__':main()

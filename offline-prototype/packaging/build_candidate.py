"""Build a relocatable candidate from a separately provisioned Windows runtime.
Never marks qualification complete, runs installers, contacts networks or writes outside package.
"""
import argparse,hashlib,json,shutil,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--runtime',required=True);p.add_argument('--output',required=True);a=p.parse_args()
runtime=Path(a.runtime).resolve();out=Path(a.output).resolve()
if not runtime.is_relative_to(ROOT) or not out.is_relative_to(ROOT):p.error('All paths must be inside offline-prototype')
if out.exists():p.error('Output must be new; no overwrites')
if out.is_relative_to(runtime) or runtime.is_relative_to(out):p.error('Runtime and output must be disjoint')
if any((ROOT/n).is_relative_to(out) or out.is_relative_to(ROOT/n) for n in ('app','core','assets')):p.error('Output must be separate from source inputs')
if not (runtime/'python.exe').is_file():p.error('Missing separately provisioned Windows Python runtime')
if not (ROOT/'assets/windows-candidate-manifest.json').is_file():p.error('Windows assets/dependency inventory absent; candidate blocked')
manifest=json.loads((ROOT/'assets/windows-candidate-manifest.json').read_text())
if manifest.get('platform')!='win_amd64':p.error('Not a Windows asset manifest')
# Windows dependency inventory must cover the entire runtime, not just models.
try: runtime_rows=json.loads((runtime/'runtime-inventory.json').read_text())
except (OSError,ValueError):p.error('Windows runtime inventory absent')
listed=set()
for row in runtime_rows:
 source=(runtime/row['path']).resolve()
 if not source.is_relative_to(runtime) or not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=row['sha256']:p.error('Invalid runtime inventory')
 if not all(row.get(k) for k in ('name','version','source')):p.error('Runtime provenance missing')
 if source in listed:p.error('Duplicate runtime path')
 listed.add(source)
actual={f.resolve() for f in runtime.rglob('*') if f.is_file() and f.name!='runtime-inventory.json'}
if listed!=actual or any(f.is_symlink() for f in runtime.rglob('*')):p.error('Runtime inventory not exhaustive or contains links')
# Reject incomplete inputs before creating output.
destinations=set()
for item in manifest['files']:
 destination=(out/'assets'/item['destination']).resolve()
 if not destination.is_relative_to(out/'assets') or destination in destinations:p.error('Unsafe or duplicate asset destination')
 destinations.add(destination)
 source=(ROOT/item['path']).resolve()
 if not source.is_relative_to(ROOT) or not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=item['sha256']:p.error('Invalid input inventory')
out.mkdir();shutil.copytree(runtime,out/'runtime')
for name in ['core','app']:shutil.copytree(ROOT/name,out/name,ignore=shutil.ignore_patterns('__pycache__'))
for item in manifest['files']:
 source=ROOT/item['path'];target=out/'assets'/item['destination']
 if not target.resolve().is_relative_to(out):raise ValueError('Invalid destination')
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
(out/'launch.cmd').write_text('@echo off\r\nset PYTHONDONTWRITEBYTECODE=1\r\nset TCL_LIBRARY=%~dp0runtime\\tcl\\tcl8.6\r\nset TK_LIBRARY=%~dp0runtime\\tcl\\tk8.6\r\n"%~dp0runtime\\python.exe" -B "%~dp0app\\shell.py"\r\n')
for filename,script in [('launch-acceptance.cmd','acceptance_shell.py'),('target-preflight.cmd','target_preflight.py')]:
 (out/filename).write_text('@echo off\r\nset PYTHONDONTWRITEBYTECODE=1\r\nset TCL_LIBRARY=%~dp0runtime\\tcl\\tcl8.6\r\nset TK_LIBRARY=%~dp0runtime\\tcl\\tk8.6\r\n"%~dp0runtime\\python.exe" -B "%~dp0app\\'+script+'"\r\n')
(out/'CANDIDATE-NOT-QUALIFIED.txt').write_text('UNVERIFIED-ON-TARGET. No release manifest synthesized. Complete model parity and target acceptance before qualification.\n')
runtime_provenance={r['path']:r for r in runtime_rows}
rows=[];seen_case=set()
for f in sorted(out.rglob('*')):
 if not f.is_file():continue
 relative=f.relative_to(out).as_posix()
 if relative.lower() in seen_case:raise ValueError('Windows case collision')
 seen_case.add(relative.lower())
 details=runtime_provenance.get(relative.removeprefix('runtime/'),{}) if relative.startswith('runtime/') else {}
 rows.append({'path':relative,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size,'name':details.get('name',f.name),'version':details.get('version','P1; exact SHA-256'),'source':details.get('source','offline-prototype production source / model asset provenance'),'license':details.get('license','See upstream notices and model provenance'),'platform':'win_amd64'})
(out/'candidate-inventory.json').write_text(json.dumps(rows,indent=2));print('Candidate assembled; not qualified')

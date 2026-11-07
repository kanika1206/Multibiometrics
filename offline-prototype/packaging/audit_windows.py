"""Linux-side static Windows closure audit. Never executes Windows binaries."""
from pathlib import Path
import subprocess,json,importlib.metadata as md
from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
ROOT=Path(__file__).resolve().parents[1];runtime=ROOT/'provisioning/windows/runtime'
env=default_environment();env.update(os_name='nt',sys_platform='win32',platform_system='Windows',platform_machine='AMD64',python_version='3.12',python_full_version='3.12.16',extra='')
dists=list(md.distributions(path=[str(runtime/'Lib/site-packages')]));versions={canonicalize_name(d.metadata['Name']):d.version for d in dists};missing=[]
for d in dists:
 for raw in d.requires or []:
  req=Requirement(raw)
  if req.marker and not req.marker.evaluate(env):continue
  v=versions.get(canonicalize_name(req.name))
  if not v or v not in req.specifier:missing.append({'parent':d.metadata['Name'],'requirement':raw,'installed':v})
files=[p for p in runtime.rglob('*') if p.suffix.lower() in ('.dll','.pyd','.exe')];available={p.name.lower() for p in files};imports={};unresolved={};unparsed=[]
for p in files:
 result=subprocess.run(['objdump','-p',str(p)],capture_output=True,text=True)
 if result.returncode:unparsed.append(p.relative_to(runtime).as_posix());continue
 output=result.stdout
 names=[line.split('DLL Name:',1)[1].strip().lower() for line in output.splitlines() if 'DLL Name:' in line]
 imports[p.relative_to(runtime).as_posix()]=names
 for n in names:
  if n not in available:unresolved.setdefault(n,[]).append(p.relative_to(runtime).as_posix())
report={'status':'STATIC_ONLY_NOT_WINDOWS_EXECUTION','metadata_missing':missing,'distributions':versions,'imports':imports,'not_in_runtime':unresolved,'unparsed':unparsed,'limitation':'OS DLLs are not expected in payload. Delay/dynamic loads and loader search paths still require Windows execution.'}
(ROOT/'evidence/windows-static-closure.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'metadata_missing':missing,'not_in_runtime':sorted(unresolved),'unparsed':unparsed},indent=2))

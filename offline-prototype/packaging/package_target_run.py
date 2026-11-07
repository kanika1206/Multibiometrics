"""Create complete offline Windows installer/run ZIP and measure actual bytes."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1];pack=ROOT/'packaging/target-run'
SKIP={'production-inputs.zip','production-inputs-lzma.zip','production-inventory.json','lossless-size-check.json','SIZE-BUDGET.md','pack-inventory.json'}
files=[p for p in sorted(pack.rglob('*')) if p.is_file() and (p.relative_to(pack).parts[0]=='payload' or p.name not in SKIP)]
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
rows=[{'path':p.relative_to(pack).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size} for p in files]
(pack/'pack-inventory.json').write_text(json.dumps({'status':'WINDOWS_CANDIDATE_UNVERIFIED_ON_TARGET','files':rows},indent=2)+'\n');files.append(pack/'pack-inventory.json')
out=ROOT/'packaging/windows-target-run.zip';breakdown={}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in files:
  relative=p.relative_to(pack).as_posix();z.write(p,relative)
  key='runtime' if relative.startswith('payload/runtime/') else 'models_and_codecs' if relative.startswith('payload/assets/') else 'application_and_run_pack'
  group=breakdown.setdefault(key,{'raw_bytes':0,'compressed_bytes':0});group['raw_bytes']+=p.stat().st_size;group['compressed_bytes']+=z.getinfo(relative).compress_size
size=out.stat().st_size
report={'artifact':out.name,'sha256':sha(out),'bytes':size,'limit_bytes':300000000,'under_target':size<300000000,'over_target_bytes':max(size-300000000,0),'breakdown':breakdown,'candidate_inventory_sha256':sha(pack/'payload/candidate-inventory.json'),'status':'ASSEMBLED_UNVERIFIED_ON_TARGET','compression':'ZIP DEFLATE level 9','notes':'Complete offline install/run bundle, including Windows runtime/Tk/VC/native dependencies/models/codecs/scripts. No model substitution or quantization.'}
(ROOT/'packaging/windows-target-run.metrics.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))

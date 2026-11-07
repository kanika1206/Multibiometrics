"""Exercise real inference with removed build/test namespaces forbidden on Linux."""
import sys,importlib.abc,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/"packaging"))
from production_exclusions import EXCLUDED_PREFIXES,EXCLUDED_FILES
blocked=tuple(p.rstrip('/').replace('/','.') for p in EXCLUDED_PREFIXES)+tuple(p.removesuffix('.py').replace('/','.') for p in EXCLUDED_FILES)
class RejectBuildTools(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  if any(fullname==prefix or fullname.startswith(prefix+'.') for prefix in blocked):raise RuntimeError('PRODUCTION_BUILD_TOOL_IMPORT: '+fullname)
sys.meta_path.insert(0,RejectBuildTools())
runpy.run_path(str(ROOT/'tools/model_smoke.py'),run_name='__main__')

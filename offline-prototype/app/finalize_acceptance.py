"""Archive/delete an interrupted evaluation run. Cannot address production state."""
import sys,os,argparse
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from core.security import deny_network
deny_network()
if os.name!='nt':raise SystemExit('Windows required')
p=argparse.ArgumentParser(description=__doc__);p.add_argument('run_id');g=p.add_mutually_exclusive_group(required=True);g.add_argument('--archive',action='store_true');g.add_argument('--destroy',action='store_true');a=p.parse_args()
from core.acceptance import finish_run
finish_run(a.run_id,a.archive)
print('Evaluation state archived' if a.archive else 'Evaluation state destroyed')

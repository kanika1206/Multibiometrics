"""Resume an interrupted ACTIVE evaluation run for restart tests; no production mode."""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from core.security import deny_network
deny_network()
if os.name!='nt' or len(sys.argv)!=2:raise SystemExit('Windows evaluation run ID required')
from core.acceptance import open_run
from app.acceptance_ui import run_acceptance
open_run(sys.argv[1],ROOT) # validates namespace, active status and unchanged candidate
run_acceptance(sys.argv[1])

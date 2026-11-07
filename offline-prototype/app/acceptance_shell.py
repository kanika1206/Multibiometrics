"""Acceptance-only new-run entry point. No production mode or state override."""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from core.security import deny_network
deny_network()
if os.name!='nt' or len(sys.argv)!=1:raise SystemExit('Windows acceptance entry point takes no options')
from core.acceptance import create_run
from app.acceptance_ui import run_acceptance
run_acceptance(create_run(ROOT))

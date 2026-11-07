"""Production-only entry point. No acceptance mode."""
import os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from core.security import deny_network
from core.transport import PipeClient
deny_network()
if os.name!='nt':raise SystemExit('NOT_READY: Windows desktop required')
from app.ui import run_shell
run_shell(PipeClient(Path(__file__).with_name('worker.py')),'Multimodal Offline — Phase 1')

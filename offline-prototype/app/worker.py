"""Production worker; no acceptance flag or IPC operation."""
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from core.security import deny_network
deny_network()
from core.worker_loop import serve
from core.runtime import Runtime
serve(lambda:Runtime(ROOT))

"""Fixed acceptance worker. Its sole argument is an existing evaluation run ID."""
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from core.security import deny_network
deny_network()
if len(sys.argv)!=2:raise SystemExit('Acceptance run ID required')
from core.acceptance import AcceptanceRuntime
from core.worker_loop import serve
serve(lambda:AcceptanceRuntime(ROOT,sys.argv[1]))

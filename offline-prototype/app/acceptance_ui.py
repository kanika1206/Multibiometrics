"""Shared UI invocation for new/resumed evaluation runs; never production state."""
from pathlib import Path
from tkinter import messagebox
from core.acceptance import finish_run,run_directory
from core.transport import PipeClient
from app.ui import run_shell

def run_acceptance(run_id):
    print('ACCEPTANCE ONLY. Disposable run evidence:',run_directory(run_id),flush=True)
    def finish(root):
        archive=messagebox.askyesno('Finish acceptance run','Archive disposable state as evidence?\nYES retains encrypted templates/content and any consented plaintext recordings.\nNO destroys disposable state. Neither choice touches production state.',parent=root)
        finish_run(run_id,archive)
    run_shell(PipeClient(Path(__file__).with_name('acceptance_worker.py'),arguments=(run_id,)),
              'ACCEPTANCE ONLY — disposable evaluation session',finish)

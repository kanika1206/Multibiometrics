"""Fixed evaluation-only policy. Never selects production state or grants it access."""
import hashlib,json,re,secrets,shutil
from pathlib import Path
from datetime import datetime,timezone
from .assets import Assets
from .paths import windows_state_root,prepare_state
from .security import restrict_windows_directory,WindowsStateLock
from .runtime import Runtime

def digest(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def verify_candidate(package):
    package=Path(package).resolve();inventory=package/'candidate-inventory.json'
    rows=json.loads(inventory.read_text());seen=set()
    for row in rows:
        p=(package/row['path']).resolve()
        if not p.is_relative_to(package) or p in seen or not p.is_file() or digest(p)!=row['sha256']:raise RuntimeError('ASSET_INVALID: candidate inventory')
        seen.add(p)
    actual={p.resolve() for p in package.rglob('*') if p.is_file() and p!=inventory}
    if seen!=actual:raise RuntimeError('ASSET_INVALID: candidate closure')
    return digest(inventory)

def run_directory(run_id):
    if not re.fullmatch('[0-9a-f]{32}',run_id):raise ValueError('IPC_INVALID')
    base=windows_state_root();evidence=base/'acceptance-evidence';root=evidence/'runs'
    path=root/run_id
    for p in (base,evidence,root,path):
        if p.is_symlink() or (hasattr(p,'is_junction') and p.is_junction()):raise RuntimeError('STORAGE_ERROR')
    return path

def create_run(package):
    payload=verify_candidate(package);run_id=secrets.token_hex(16);path=run_directory(run_id)
    path.mkdir(parents=True,exist_ok=False);restrict_windows_directory(path)
    record={'id':run_id,'status':'ACTIVE','candidate_inventory_sha256':payload,'started_utc':datetime.now(timezone.utc).isoformat(),'production_access':False}
    (path/'run.json').write_text(json.dumps(record,indent=2))
    prepare_state(path/'state',restrict_windows_directory)
    return run_id

def open_run(run_id,package):
    path=run_directory(run_id);record=json.loads((path/'run.json').read_text())
    if record.get('id')!=run_id or record.get('status')!='ACTIVE' or record.get('candidate_inventory_sha256')!=verify_candidate(package):raise RuntimeError('NOT_READY: inactive or mismatched acceptance run')
    return path/'state'

def finish_run(run_id,archive):
    path=run_directory(run_id);record=json.loads((path/'run.json').read_text())
    if record.get('id')!=run_id or record.get('status')!='ACTIVE':raise RuntimeError('NOT_READY: inactive acceptance run')
    state=path/'state'
    if state.is_symlink() or (hasattr(state,'is_junction') and state.is_junction()):raise RuntimeError('STORAGE_ERROR')
    # Worker must already be stopped; lifetime lock catches live workers.
    lock=WindowsStateLock(state);lock.close()
    if archive:state.rename(path/'archived-state')
    else:shutil.rmtree(state)
    record.update(status='ARCHIVED' if archive else 'DESTROYED',ended_utc=datetime.now(timezone.utc).isoformat())
    (path/'run.json').write_text(json.dumps(record,indent=2))

class CandidateAssets(Assets):
    def __init__(self,root):
        self.root=Path(root).resolve()
        self.manifest=json.loads((self.root/'release-manifest.json').read_text())
        if self.manifest.get('status') not in ('CANDIDATE','QUALIFIED') or self.manifest.get('platform')!='win_amd64':raise RuntimeError('ASSET_INVALID: candidate manifest')
        self.development=False;self._verify_files()
    def require_parity(self):
        # Evaluates the unchanged candidate, without asserting qualification.
        if self.manifest.get('parity_status') not in ('PENDING_TARGET','PASSED'):raise RuntimeError('ASSET_INVALID: candidate parity status')

class AcceptanceRuntime(Runtime):
    def __init__(self,package,run_id):
        self.evaluation_state=open_run(run_id,package)
        super().__init__(package)
    def load_assets(self,package):return CandidateAssets(Path(package)/'assets')
    def state_root(self):return self.evaluation_state

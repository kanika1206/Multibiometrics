import hashlib,json
from pathlib import Path
class Assets:
    def __init__(self,root,*,development=False):
        self.root=Path(root).resolve()
        try:self.manifest=json.loads((self.root/('development-manifest.json' if development else 'release-manifest.json')).read_text())
        except (OSError,ValueError) as e:raise RuntimeError('ASSET_MISSING: qualified offline release manifest') from e
        required_status='DEVELOPMENT_SYNTHETIC_ONLY' if development else 'QUALIFIED'
        if self.manifest.get('status')!=required_status:raise RuntimeError('NOT_READY: package is not qualified')
        if not development:
            try:
                record=self.manifest['target_acceptance']
                proof=(self.root/record['path']).resolve()
                if not proof.is_relative_to(self.root):raise ValueError('path')
                raw=proof.read_bytes()
                if hashlib.sha256(raw).hexdigest()!=record['sha256']:raise ValueError('hash')
                evidence=json.loads(raw)
                payload=hashlib.sha256(json.dumps(self.manifest['files'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
                if evidence.get('status')!='PASSED' or evidence.get('payload_sha256')!=payload:raise ValueError('acceptance')
                if not all(evidence.get(key) is True for key in ('fresh_install','dpapi','capture','lifecycle','egress_blocked','interfaces_disabled','zero_socket_attempts')):raise ValueError('coverage')
            except (KeyError,OSError,ValueError,TypeError) as exc:
                raise RuntimeError('NOT_READY: target acceptance evidence absent or invalid') from exc
        self.development=development
        self._verify_files()
    def require_parity(self):
        if self.manifest.get("parity_status")!="PASSED" and not self.development:raise RuntimeError("NOT_READY: model parity evidence absent")
    def _verify_files(self):
        self.paths={}
        for item in self.manifest['files']:
            p=(self.root/item['path']).resolve()
            if not p.is_relative_to(self.root) or not p.is_file():raise RuntimeError('ASSET_MISSING')
            if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('ASSET_INVALID')
            self.paths[item['id']]=p
    def require(self,key):
        if key not in self.paths:raise RuntimeError('ASSET_MISSING: '+key)
        return self.paths[key]

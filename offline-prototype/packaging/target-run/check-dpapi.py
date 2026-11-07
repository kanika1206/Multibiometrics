"""Run with candidate Windows Python. No authentication, test keys only."""
import sys,os,json,secrets,argparse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--installed-package',required=True);a=p.parse_args()
if os.name!='nt':raise SystemExit('UNVERIFIED-ON-TARGET: Windows required')
sys.path.insert(0,str(Path(a.installed_package).resolve()))
from core.security import deny_network,DPAPI
from core.paths import windows_state_root
deny_network();plain=secrets.token_bytes(32);dp=DPAPI();wrapped=dp.wrap(plain)
if dp.unwrap(wrapped)!=plain:raise SystemExit('DPAPI round-trip failed')
bad=bytearray(wrapped);bad[len(bad)//2]^=1
try:dp.unwrap(bytes(bad))
except Exception:tamper_rejected=True
else:tamper_rejected=False
print(json.dumps({'test':'DPAPI smoke only','round_trip':True,'tamper_rejected':tamper_rejected,'state_root':str(windows_state_root()),'cross_user_key_loss_acl':'NOT_RUN'}))
if not tamper_rejected:raise SystemExit(1)

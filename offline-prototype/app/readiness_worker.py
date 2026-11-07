import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from core.security import deny_network
from core.ipc import read,write
from core.assets import Assets
deny_network();seen=set()
while True:
    req=read(sys.stdin.buffer)
    if req is None:break
    try:
        if req['id'] in seen:raise ValueError('IPC_REPLAY')
        seen.add(req['id'])
        if len(seen)>10000:raise ValueError('IPC_SESSION_LIMIT')
        if req.get('operation')!='readiness':raise ValueError('NOT_READY: authentication pipeline not qualified')
        Assets(Path(__file__).resolve().parents[1]/'assets')
        result={'status':'NOT_READY','error':'Windows inference integration not yet qualified'}
    except Exception as e:result={'status':'NOT_READY','error':str(e)[:256]}
    write(sys.stdout.buffer,{'id':req['id'],**result})

import sys,contextlib
from .ipc import read,write
from .errors import diagnostic
def serve(factory):
    runtime=None;seen=set()
    while True:
        try:req=read(sys.stdin.buffer)
        except Exception:break
        if req is None:break
        try:
            if req['id'] in seen or len(seen)>=10000:raise ValueError('IPC_INVALID')
            seen.add(req['id'])
            with contextlib.redirect_stdout(sys.stderr):
                if runtime is None:runtime=factory()
                result=runtime.dispatch(req)
        except Exception as exc:result={**diagnostic(exc),'decision':'REJECT'}
        write(sys.stdout.buffer,{'id':req['id'],**result})
    
    if runtime is not None:
        runtime.close()

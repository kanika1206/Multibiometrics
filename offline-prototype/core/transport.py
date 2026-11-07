"""Serialized inherited-pipe client. Timeout/cancellation kills worker and descendants."""
import subprocess,sys,json,threading,queue,secrets,os
from pathlib import Path
from .ipc import read
class PipeClient:
    def __init__(self,script,timeout=90,arguments=()):self.script=str(script);self.timeout=timeout;self.arguments=tuple(arguments);self.process=None;self.lock=threading.Lock()
    def close(self):
        p=self.process;self.process=None
        if p and p.poll() is None:
            if os.name=='nt':
                subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
                if p.poll() is None:p.kill()
            else:p.kill()
            p.wait(timeout=10)
        if p:
            for f in [p.stdin,p.stdout]:
                if f:f.close()
    def call(self,operation,**fields):
        with self.lock:
            if self.process is None or self.process.poll() is not None:
                self.process=subprocess.Popen([sys.executable,'-B',self.script,*self.arguments],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
            p=self.process;identifier=secrets.token_hex(16);q=queue.Queue(1)
            def exchange():
                try:
                    raw=(json.dumps({'id':identifier,'operation':operation,**fields})+'\n').encode()
                    if len(raw)>65536:raise ValueError('IPC_INVALID')
                    p.stdin.write(raw);p.stdin.flush();q.put(read(p.stdout))
                except Exception:q.put(None)
            threading.Thread(target=exchange,daemon=True).start()
            try:response=q.get(timeout=self.timeout)
            except queue.Empty:self.close();raise TimeoutError('INFERENCE_TIMEOUT')
            if not response or response.get('id')!=identifier:self.close();raise ValueError('CANCELLED')
            return response

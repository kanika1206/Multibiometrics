"""Trusted pipe endpoint. No arbitrary file paths or model/score injection verbs."""
import os,secrets
from pathlib import Path
from .assets import Assets
from .paths import windows_state_root,prepare_state
from .security import DPAPI,WindowsStateLock,restrict_windows_directory
from .challenges import Challenges
from .vault import Vault
from .content import Content
from .service import Service
from .capture import WindowsCapture
from .inference import LocalInference
from .research import ResearchCapture
class Runtime:
    def load_assets(self,package):return Assets(Path(package)/"assets")
    def state_root(self):return windows_state_root()
    def __init__(self,package):
        if os.name!='nt':raise RuntimeError('NOT_READY: Windows required')
        self.assets=self.load_assets(package)
        self.root=self.state_root()
        paths=prepare_state(self.root,restrict_windows_directory)
        self.state_lock=WindowsStateLock(self.root)
        self.transient=paths['transient']
        os.environ.update(TMP=str(self.transient),TEMP=str(self.transient),TMPDIR=str(self.transient))
        # Clean only our own transient media; never user-supplied paths.
        for p in self.transient.glob('*.mkv'):p.unlink()
        self.inference=LocalInference(self.assets,self.transient)
        protector=DPAPI()
        self.challenges=Challenges(paths['vault']/'attempts.db')
        models={k:self.assets.manifest['model_hashes'][k] for k in ['face','voice']}
        self.vault=Vault(paths['vault']/'vault.db',protector,models)
        self.content=Content(paths['vault']/'content.db',protector)
        self.service=Service(self.challenges,self.vault,self.inference,self.content)
        self.capture=WindowsCapture(self.assets.require('ffmpeg'),self.assets.require('ffprobe'),self.transient)
        self.research=ResearchCapture(self.root/'research-capture',True)
        self.current=None
    def dispatch(self,request):
        op=request['operation']
        if op=='lock':
            self.capture.cancel();self.current=None;self.service.cancel();return {'status':'LOCKED'}
        if op=='content':return self.service.protected_content()
        if op=='save':self.service.save_content(request['text']);return {'status':'SAVED'}
        identity=request.get('identity','')
        if not isinstance(identity,str) or not identity or len(identity)>128:raise ValueError('IDENTITY_UNKNOWN')
        if op=='enroll':self.service.begin_enrollment(identity);return {'status':'ENROLLMENT_STARTED'}
        if op=='delete':self.service.delete(identity);return {'status':'DELETED'}
        if op=='start':
            if self.current:raise ValueError('CAPTURE_BUSY')
            aid,digits=self.service.issue(identity)
            try:handle=self.capture.start(request['camera'],request['microphone'])
            except Exception:self.challenges.finish(aid,False);raise
            self.current=(identity,aid,handle,request.get('consent') is True)
            return {'status':'RECORDING','digits':digits}
        if op=='stop':
            current=self.current
            if not current or current[0]!=identity:raise ValueError('CAPTURE_INVALID')
            self.current=None
            try:
                handle,metadata=self.capture.stop()
                if handle!=current[2]:raise ValueError('CAPTURE_INVALID')
                self.research.retain(handle,current[3])
                state=self.service.enrollment
                if state and state['identity']==identity and not state.get('generation'):
                    self.challenges.consume(current[1],identity)
                    result=self.service.enrollment_sample(identity,handle)
                    self.challenges.finish(current[1],False) # sample is not authentication
                    return {'status':result}
                self.service.bind_capture(current[1],identity,handle)
                return self.service.verify(current[1],identity)
            except Exception:
                self.challenges.finish(current[1],False)
                raise
            finally:self.inference.cleanup(current[2])
        raise ValueError('IPC_INVALID')

    def close(self):
        self.capture.cancel();self.service.cancel();self.challenges.close()
        self.vault.close();self.content.close();self.state_lock.close()

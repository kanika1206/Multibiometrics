"""Single-process service. Inference adapter receives media, never expected digits."""
import threading
from .contracts import scores,verdict,fuse,aggregate
from .asr import accept
from .errors import code,diagnostic
from .security import network_attempts
class Service:
    def __init__(self,challenges,vault,inference,content=None):
        self.content=content
        self.challenges=challenges;self.vault=vault;self.inference=inference
        self.lock=threading.RLock();self.session=None;self.enrollment=None;self.captures={}
    def issue(self,identity):
        with self.lock:
            self.session=None
            return self.challenges.issue(identity)
    def bind_capture(self,attempt,identity,handle):
        # Called only by trusted capture adapter, not exposed as an IPC file-upload verb.
        with self.lock:
            if attempt not in self.challenges.memory or self.challenges.memory[attempt][0]!=identity:raise ValueError('CAPTURE_INVALID')
            if attempt in self.captures:raise ValueError('CAPTURE_INVALID')
            self.captures[attempt]=(identity,handle)
    def verify(self,attempt,identity):
        with self.lock:
            self.session=None
            try:
                binding=self.captures.pop(attempt)
                if binding[0]!=identity:raise ValueError('CAPTURE_INVALID')
                expected=self.challenges.consume(attempt,identity)
                pending=self.enrollment
                generation=pending['generation'] if pending and pending['identity']==identity and pending.get('generation') else None
                enrolled=self.vault.load(identity,generation)
                probe,candidates=self.inference.extract(binding[1],enrollment=False)
                if network_attempts():raise ValueError('NETWORK_FORBIDDEN')
                fs,vs=scores(enrolled,probe)
                ok=fuse(verdict(fs,.35),verdict(vs,.30),accept(candidates,expected))
                self.inference.cleanup(binding[1])
                if not self.challenges.finish(attempt,ok):return {'decision':'REJECT','status':'AUTHENTICATION_FAILED'}
                if generation:
                    self.vault.activate(identity,generation,replace=pending['replace'])
                    self.enrollment=None
                self.session=(identity,attempt)
                return {'decision':'ACCEPT','identity':identity,'attempt':attempt,'status':'LOCAL_SESSION_OPEN'}
            except Exception as exc:
                self.challenges.finish(attempt,False)
                if 'binding' in locals():
                    try:self.inference.cleanup(binding[1])
                    except Exception:pass
                return {'decision':'REJECT',**diagnostic(exc)}
    def begin_enrollment(self,identity):
        with self.lock:
            replace=self.vault.exists(identity)
            if replace and (not self.session or self.session[0]!=identity):raise ValueError('REAUTHENTICATION_REQUIRED')
            self.session=None
            if self.enrollment and self.enrollment.get('generation'):self.vault.discard(self.enrollment['generation'])
            self.enrollment={'identity':identity,'replace':replace,'samples':[]}
    def enrollment_sample(self,identity,handle):
        with self.lock:
            state=self.enrollment
            if not state or state['identity']!=identity or state.get('generation'):raise ValueError('ENROLLMENT_STATE')
            try:template,_=self.inference.extract(handle,enrollment=True)
            finally:self.inference.cleanup(handle)
            state['samples'].append(template)
            if len(state['samples'])==3:
                state['generation']=self.vault.stage(identity,aggregate(state.pop('samples')))
                return 'CONFIRM_WITH_FRESH_VERIFICATION'
            return 'NEXT_SAMPLE'
    def protected_content(self):
        if not self.session:raise ValueError('SESSION_LOCKED')
        identity,_=self.session
        self.vault.load(identity) # fail if deleted, corrupted or keys lost
        return {'identity':identity,'content':self.content.load(identity) if self.content else '', 'message':'Protected local session; no network credential.'}
    def save_content(self,text):
        if not self.session:raise ValueError('SESSION_LOCKED')
        identity,_=self.session
        self.vault.load(identity)
        if self.content is None:raise ValueError('NOT_READY')
        self.content.save(identity,text)
    def delete(self,identity):
        with self.lock:
            if not self.session or self.session[0]!=identity:raise ValueError('REAUTHENTICATION_REQUIRED')
            self.session=None;self.challenges.invalidate_identity(identity)
            if self.content:self.content.delete(identity)
            self.vault.delete(identity)
    def lock_session(self):self.session=None

    def cancel(self):
        with self.lock:
            self.session=None
            self.challenges.suspend()
            for _,handle in self.captures.values():self.inference.cleanup(handle)
            self.captures.clear()
            if self.enrollment and self.enrollment.get('generation'):self.vault.discard(self.enrollment['generation'])
            self.enrollment=None

import unittest,tempfile,sqlite3,json,sys,subprocess
from pathlib import Path
from core.asr import combine_segments,accept
from core.contracts import State
from core.content import Content
from core.research import ResearchCapture
from core.transport import PipeClient
from test_core import TestProtector,template,Clock
from core.vault import Vault
from core.service import Service
from core.challenges import Challenges
class Continuation(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory(dir='tmp');self.p=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def test_segments(self):
        parts=[{'text':'zero one'},{'text':'two three four'}]
        self.assertIs(accept(combine_segments(parts),'01234'),State.PASS)
        parts[1]={'alternatives':[{'text':'two three four'},{'text':'two three five'}]}
        self.assertIs(accept(combine_segments(parts),'01234'),State.FAIL)
        self.assertIs(accept(combine_segments([{'text':'zero one two three four'}]*2),'01234'),State.FAIL)
    def test_segment_limit(self):
        with self.assertRaisesRegex(ValueError,'ASR_AMBIGUOUS'):combine_segments([{'alternatives':[{'text':'one'},{'text':'two'}]}]*13)
    def test_content(self):
        c=Content(self.p/'c.db',TestProtector());c.save('a','private note');self.assertEqual(c.load('a'),'private note');self.assertEqual(c.load('b'),'')
        self.assertNotIn(b'private note',(self.p/'c.db').read_bytes());c.db.execute("UPDATE content SET identity='b'")
        with self.assertRaisesRegex(ValueError,'TEMPLATE_INVALID'):c.load('b')
        c.delete('b');self.assertEqual(c.load('b'),'');c.close()
    def test_consent(self):
        source=self.p/'source.mkv';source.write_bytes(b'research')
        r=ResearchCapture(self.p/'research',True);self.assertIsNone(r.retain(source,False));self.assertFalse(r.directory.exists())
        name=r.retain(source,True);self.assertEqual((r.directory/name).read_bytes(),b'research')
    def test_timeout(self):
        script=self.p/'slow.py';script.write_text('import time\ntime.sleep(30)\n')
        client=PipeClient(script,timeout=.1)
        with self.assertRaisesRegex(TimeoutError,'INFERENCE_TIMEOUT'):client.call('readiness')
        self.assertIsNone(client.process)
    def test_enrollment_content_lifecycle(self):
        c=Challenges(self.p/'attempts',Clock());v=Vault(self.p/'vault',TestProtector(),{'face':'a','voice':'b'});content=Content(self.p/'content',TestProtector())
        class Inference:
            text=[]
            def extract(self,h,enrollment=False):return template(),self.text
            def cleanup(self,h):pass
        inf=Inference();s=Service(c,v,inf,content)
        s.begin_enrollment('a')
        for i in range(3):s.enrollment_sample('a','internal')
        self.assertFalse(v.exists('a'))
        a,d=s.issue('a');inf.text=[' '.join(d)];s.bind_capture(a,'a','internal');self.assertEqual(s.verify(a,'a')['decision'],'ACCEPT')
        s.save_content('secret');self.assertEqual(s.protected_content()['content'],'secret')
        s.begin_enrollment('a');self.assertIsNone(s.session)
        for i in range(3):s.enrollment_sample('a','internal')
        a,d=s.issue('a');inf.text=[' '.join(d)];s.bind_capture(a,'a','internal');self.assertEqual(s.verify(a,'a')['decision'],'ACCEPT')
        self.assertEqual(s.protected_content()['content'],'secret');s.delete('a');self.assertFalse(v.exists('a'));self.assertEqual(content.load('a'),'')
        c.close();v.close();content.close()
    def test_specific_error(self):
        c=Challenges(self.p/'a',Clock());v=Vault(self.p/'v',TestProtector(),{})
        class Inf:
            def cleanup(self,h):pass
        s=Service(c,v,Inf());a,d=s.issue('missing');s.bind_capture(a,'missing','internal')
        self.assertEqual(s.verify(a,'missing')['status'],'IDENTITY_UNKNOWN');c.close();v.close()
    def test_cleanup_failure_never_accepts(self):
        c=Challenges(self.p/'a',Clock());v=Vault(self.p/'v',TestProtector(),{})
        gen=v.stage('a',template());v.activate('a',gen)
        class Inf:
            text=[]
            def extract(self,h,enrollment=False):return template(),self.text
            def cleanup(self,h):raise OSError('cleanup failed')
        inf=Inf();s=Service(c,v,inf);a,d=s.issue('a');inf.text=[' '.join(d)];s.bind_capture(a,'a','internal')
        self.assertEqual(s.verify(a,'a')['decision'],'REJECT');self.assertIsNone(s.session);c.close();v.close()
    def test_failed_confirmation_does_not_activate(self):
        c=Challenges(self.p/'a',Clock());v=Vault(self.p/'v',TestProtector(),{})
        class Inf:
            def extract(self,h,enrollment=False):return template(),[]
            def cleanup(self,h):pass
        s=Service(c,v,Inf());s.begin_enrollment('a')
        for _ in range(3):s.enrollment_sample('a','internal')
        a,d=s.issue('a');s.bind_capture(a,'a','internal');self.assertEqual(s.verify(a,'a')['decision'],'REJECT');self.assertFalse(v.exists('a'))
        s.cancel();self.assertEqual(v.db.execute('SELECT count(*) FROM vault').fetchone()[0],0);c.close();v.close()

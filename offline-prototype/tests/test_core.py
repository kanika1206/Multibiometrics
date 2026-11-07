import unittest,tempfile,itertools,math,threading,concurrent.futures,sqlite3,json
from pathlib import Path
import numpy as np
from core.contracts import *
from core.challenges import Challenges
from core.asr import accept,normalize,LocalASR
from core.vault import Vault
from core.service import Service
from core.assets import Assets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
class Clock:
    def __init__(self):self.t=[100.,1000.]
    def __call__(self):return tuple(self.t)
    def advance(self,n):self.t=[x+n for x in self.t]
class TestProtector:
    # Explicit test-only cryptographic wrapper; never production fallback.
    def __init__(self):self.a=AESGCM(b'x'*32)
    def wrap(self,key):return self.a.encrypt(b'0'*12,key,b'test')
    def unwrap(self,key):return self.a.decrypt(b'0'*12,key,b'test')
def template():
    f=[1.]+[0.]*511;v=[1.]+[0.]*191
    return {'version':2,'face':{'embedding':f,'frames':[f]*12,'n_frames':12},'voice':{'embedding':v,'model':'ecapa-voxceleb','n_samples':16000}}
class Core(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory(dir='tmp');self.p=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def test_truth_table(self):self.assertEqual(sum(fuse(*x) for x in itertools.product(State,repeat=3)),1);self.assertFalse(fuse(True,True,True))
    def test_thresholds(self):
        for t in [.35,.30]:
            self.assertIs(verdict(t,t),State.PASS);self.assertIs(verdict(math.nextafter(t,-math.inf),t),State.FAIL);self.assertIs(verdict(math.nextafter(t,math.inf),t),State.PASS)
        self.assertIs(verdict(float('nan'),.35),State.ERROR)
    def test_scores_and_invalid(self):
        self.assertEqual(scores(template(),template()),(1.,1.))
        for x in [[0.]*192,[float('inf')]+[0.]*191,[1.]*191]:
            with self.assertRaises(ValueError):vector(x,192)
    def test_aggregate(self):self.assertEqual(aggregate([template()]*3)['face']['n_frames'],36)
    def test_asr(self):
        self.assertIs(accept(['zero one two three four'],'01234'),State.PASS)
        for alts in [[],['oh one two three four'],['okay zero one two three four'],['zero one two three'],['zero one two three five','zero one two three four'],['zero one two three four','zero one two three five']]:self.assertIs(accept(alts,'01234'),State.FAIL)
        self.assertIs(accept(['zero one two three four'],'01234',False),State.FAIL)
    def test_missing_model(self):
        with self.assertRaises(RuntimeError):LocalASR(self.p/'absent')
        with self.assertRaises(RuntimeError):Assets(self.p)
    def challenges(self):self.clock=Clock();return Challenges(self.p/'attempts.db',self.clock)
    def test_replay_and_storage(self):
        c=self.challenges();a,d=c.issue('alice');self.assertEqual(len(d),5);self.assertEqual(c.consume(a,'alice'),d)
        with self.assertRaises(ValueError):c.consume(a,'alice')
        self.assertTrue(c.finish(a,True));self.assertFalse(c.finish(a,True));self.assertNotIn(d,(self.p/'attempts.db').read_bytes().decode('latin1'));c.close()
    def test_concurrency(self):
        c=self.challenges();a,d=c.issue('alice')
        def call(_):
            try:c.consume(a,'alice');return True
            except ValueError:return False
        with concurrent.futures.ThreadPoolExecutor(8) as pool:self.assertEqual(sum(pool.map(call,range(16))),1)
        c.close()
    def test_expiry_and_backwards(self):
        c=self.challenges();a,_=c.issue('a');self.clock.advance(300)
        with self.assertRaises(ValueError):c.consume(a,'a')
        a,_=c.issue('a');self.clock.t[1]-=1
        with self.assertRaises(ValueError):c.consume(a,'a')
        c.close()
    def test_restart(self):
        c=self.challenges();a,_=c.issue('a');c.db.close() # simulate process termination without close hook
        c=Challenges(self.p/'attempts.db',self.clock)
        with self.assertRaises(ValueError):c.consume(a,'a')
        self.assertEqual(c.db.execute('select status from attempts').fetchone()[0],'INVALIDATED');c.close()
    def test_finish_expiry_and_suspend(self):
        c=self.challenges();a,_=c.issue('a');c.consume(a,'a');self.clock.advance(300);self.assertFalse(c.finish(a,True))
        a,_=c.issue('a');c.suspend()
        with self.assertRaises(ValueError):c.consume(a,'a')
        c.close()
    def vault(self):return Vault(self.p/'vault.db',TestProtector(),{'face':'a'*64,'voice':'b'*64})
    def test_vault_atomic_replace(self):
        v=self.vault();g=v.stage('a',template());self.assertFalse(v.exists('a'));v.activate('a',g);self.assertEqual(v.load('a'),template())
        g2=v.stage('a',template())
        with self.assertRaises(ValueError):v.activate('a',g2)
        self.assertTrue(v.exists('a'));v.activate('a',g2,True);self.assertEqual(v.db.execute('select count(*) from vault').fetchone()[0],1)
        v.delete('a');self.assertFalse(v.exists('a'));v.close()
    def test_vault_tamper(self):
        v=self.vault();g=v.stage('a',template());v.activate('a',g);v.db.execute("update vault set metadata=x'00'")
        with self.assertRaises(ValueError):v.load('a')
        v.close()
    def test_vault_key_loss(self):
        v=self.vault();g=v.stage('a',template());v.activate('a',g);v.db.execute("update vault set wrapped=x'00'")
        with self.assertRaisesRegex(ValueError,'KEY_UNAVAILABLE'):v.load('a')
        v.close()
    def test_service(self):
        c=self.challenges();v=self.vault();g=v.stage('a',template());v.activate('a',g)
        class Fake:
            candidates=[]
            def extract(self,handle,enrollment=False):return template(),self.candidates
            def cleanup(self,handle):pass
        f=Fake();s=Service(c,v,f);a,d=s.issue('a');f.candidates=[' '.join(d)];s.bind_capture(a,'a','internal');self.assertEqual(s.verify(a,'a')['decision'],'ACCEPT');self.assertEqual(s.protected_content()['identity'],'a')
        self.assertEqual(s.verify(a,'a')['decision'],'REJECT')
        with self.assertRaises(ValueError):s.protected_content()
        c.close();v.close()
if __name__=='__main__':unittest.main()

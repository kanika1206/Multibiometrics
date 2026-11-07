import unittest,subprocess,sys,tempfile,json,math
from pathlib import Path
from core.contracts import scores,verdict,State
from test_core import template
class Compatibility(unittest.TestCase):
    def test_pinned_matchers(self):
        with tempfile.TemporaryDirectory(dir='tmp') as d:
            r=Path(d)/'reg.json';p=Path(d)/'probe.json';r.write_text(json.dumps(template()))
            for threshold,dimension,branch,script in [(.35,512,'face','matchFaceTemplate.py'),(.30,192,'voice','matchVoiceTemplate.py')]:
                for x in [threshold-.01,math.nextafter(threshold,0),threshold,math.nextafter(threshold,1),threshold+.01]:
                    t=template();v=[x,math.sqrt(1-x*x)]+[0.]*(dimension-2)
                    if branch=='face':t['face']['frames']=[v]*12
                    else:t['voice']['embedding']=v
                    p.write_text(json.dumps(t));s=scores(template(),t)[0 if branch=='face' else 1]
                    result=subprocess.run([sys.executable,'-B','tests/reference/'+script,str(r),str(p)],capture_output=True,timeout=10)
                    self.assertIn(result.returncode,[0,1]);self.assertEqual(result.returncode==0,verdict(s,threshold) is State.PASS,(branch,x,s))

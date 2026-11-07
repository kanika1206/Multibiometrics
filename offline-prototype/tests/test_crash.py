import unittest,tempfile,subprocess,sys
from pathlib import Path
from core.challenges import Challenges
class CrashRecovery(unittest.TestCase):
    def test_process_death_boundaries(self):
        with tempfile.TemporaryDirectory(dir='tmp') as base:
            for stage in ['before_issue','after_issue','after_consume','after_failure','after_success']:
                db=Path(base)/(stage+'.db')
                source='''import os,sys
from core.challenges import Challenges
c=Challenges(sys.argv[1]);stage=sys.argv[2]
if stage=='before_issue':os._exit(17)
a,d=c.issue('identity')
if stage=='after_issue':os._exit(17)
c.consume(a,'identity')
if stage=='after_consume':os._exit(17)
c.finish(a,stage=='after_success')
os._exit(17)
'''
                p=subprocess.run([sys.executable,'-B','-c',source,str(db),stage],capture_output=True,timeout=10)
                self.assertEqual(p.returncode,17,p.stderr)
                c=Challenges(db)
                for aid,status in c.db.execute('SELECT id,status FROM attempts'):
                    self.assertNotIn(status,['ISSUED','CONSUMED'])
                    with self.assertRaises(ValueError):c.consume(aid,'identity')
                c.close()

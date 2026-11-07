import unittest,tempfile,json,hashlib
from pathlib import Path
from core.assets import Assets
class AssetTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory(dir='tmp');self.p=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def manifest(self,status='DEVELOPMENT_SYNTHETIC_ONLY',path='model',digest=None):
        (self.p/'model').write_bytes(b'model')
        doc={'status':status,'files':[{'id':'x','path':path,'sha256':digest or hashlib.sha256(b'model').hexdigest()}]}
        (self.p/'development-manifest.json').write_text(json.dumps(doc));return doc
    def test_development_never_release(self):
        self.manifest();self.assertEqual(Assets(self.p,development=True).require('x').read_bytes(),b'model')
        with self.assertRaises(RuntimeError):Assets(self.p)
        (self.p/'release-manifest.json').write_text((self.p/'development-manifest.json').read_text())
        with self.assertRaises(RuntimeError):Assets(self.p)
    def test_corrupt(self):
        self.manifest(digest='0'*64)
        with self.assertRaisesRegex(RuntimeError,'ASSET_INVALID'):Assets(self.p,development=True)
    def test_escape(self):
        self.manifest(path='../model')
        with self.assertRaisesRegex(RuntimeError,'ASSET_MISSING'):Assets(self.p,development=True)

import unittest,io,json,subprocess,sys
from core.ipc import read,write
class IPC(unittest.TestCase):
    def test_roundtrip(self):
        b=io.BytesIO();write(b,{'id':'x','operation':'readiness'});b.seek(0);self.assertEqual(read(b)['id'],'x')
    def test_invalid(self):
        for data in [b'{}\n',b'a'*65537,b'{"id":"a"}']:
            with self.assertRaises((ValueError,json.JSONDecodeError)):read(io.BytesIO(data))
    def test_worker_missing_assets(self):
        p=subprocess.run([sys.executable,'-B','app/readiness_worker.py'],input=b'{"id":"x","operation":"readiness"}\n',capture_output=True,timeout=10)
        r=json.loads(p.stdout);self.assertEqual(r['id'],'x');self.assertEqual(r['status'],'NOT_READY');self.assertIn('ASSET_MISSING',r['error'])
    def test_network_hook(self):
        p=subprocess.run([sys.executable,'-B','-c','from core.security import deny_network; deny_network(); import socket; socket.socket()'],capture_output=True)
        self.assertNotEqual(p.returncode,0);self.assertIn(b'NETWORK_FORBIDDEN',p.stderr)
    def test_requests_import_has_no_socket_probe(self):
        source='from core.security import deny_network,network_attempts; deny_network(); import requests; assert not network_attempts(), network_attempts()'
        p=subprocess.run([sys.executable,'-B','-c',source],capture_output=True,timeout=10)
        self.assertEqual(p.returncode,0,p.stderr.decode())

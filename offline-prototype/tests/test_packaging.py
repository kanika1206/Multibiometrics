import unittest,tempfile,json,hashlib
from pathlib import Path
from core.paths import prepare_state,NAMES
from core.assets import Assets
class PackagingTests(unittest.TestCase):
 def test_state_names_and_acl(self):
  with tempfile.TemporaryDirectory(dir='tmp') as d:
   root=Path(d).resolve()/'MultimodalOffline';seen=[]
   paths=prepare_state(root,lambda p:seen.append(p))
   self.assertEqual(set(paths),set(NAMES));self.assertEqual(len(seen),6)
   self.assertTrue(all(p.is_dir() for p in paths.values()))
 def test_symlink_state_rejected(self):
  with tempfile.TemporaryDirectory(dir='tmp') as d:
   base=Path(d).resolve();(base/'actual').mkdir();(base/'link').symlink_to(base/'actual',target_is_directory=True)
   with self.assertRaisesRegex(RuntimeError,'STORAGE_ERROR'):prepare_state(base/'link',lambda p:None)
 def test_qualified_label_without_target_proof_rejected(self):
  with tempfile.TemporaryDirectory(dir='tmp') as d:
   p=Path(d);(p/'release-manifest.json').write_text(json.dumps({'status':'QUALIFIED','files':[]}))
   with self.assertRaisesRegex(RuntimeError,'target acceptance'):Assets(p)
 def test_acceptance_binds_payload_and_all_conditions(self):
  with tempfile.TemporaryDirectory(dir='tmp') as d:
   p=Path(d);(p/'model').write_bytes(b'model')
   files=[{'id':'model','path':'model','sha256':hashlib.sha256(b'model').hexdigest()}]
   proof={'status':'PASSED','payload_sha256':hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
   proof.update({k:True for k in ('fresh_install','dpapi','capture','lifecycle','egress_blocked','interfaces_disabled','zero_socket_attempts')})
   def write():
    raw=json.dumps(proof).encode();(p/'proof.json').write_bytes(raw)
    (p/'release-manifest.json').write_text(json.dumps({'status':'QUALIFIED','files':files,'target_acceptance':{'path':'proof.json','sha256':hashlib.sha256(raw).hexdigest()}}))
   write();self.assertEqual(Assets(p).require('model').read_bytes(),b'model')
   proof['interfaces_disabled']=False;write()
   with self.assertRaisesRegex(RuntimeError,'target acceptance'):Assets(p)
   proof['interfaces_disabled']=True;proof['payload_sha256']='0'*64;write()
   with self.assertRaisesRegex(RuntimeError,'target acceptance'):Assets(p)

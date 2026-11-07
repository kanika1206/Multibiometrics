import unittest,tempfile,json,hashlib
from pathlib import Path
from unittest.mock import patch
from core.acceptance import CandidateAssets,verify_candidate,open_run,finish_run,run_directory
from core.assets import Assets
class AcceptanceTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory(dir='tmp');self.p=Path(self.tmp.name).resolve()
 def tearDown(self):self.tmp.cleanup()
 def candidate(self):
  (self.p/'assets').mkdir();(self.p/'assets/model').write_bytes(b'model')
  doc={'status':'CANDIDATE','platform':'win_amd64','parity_status':'PENDING_TARGET','files':[{'id':'model','path':'model','sha256':hashlib.sha256(b'model').hexdigest()}]}
  (self.p/'assets/release-manifest.json').write_text(json.dumps(doc))
  rows=[{'path':f.relative_to(self.p).as_posix(),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in self.p.rglob('*') if f.is_file()]
  (self.p/'candidate-inventory.json').write_text(json.dumps(rows))
 def test_same_manifest_candidate_load_production_denies(self):
  self.candidate();raw=(self.p/'assets/release-manifest.json').read_bytes()
  assets=CandidateAssets(self.p/'assets');assets.require_parity()
  self.assertEqual(assets.require('model').read_bytes(),b'model')
  with self.assertRaisesRegex(RuntimeError,'not qualified'):Assets(self.p/'assets')
  self.assertEqual(raw,(self.p/'assets/release-manifest.json').read_bytes())
 def test_payload_tamper_and_extra_file(self):
  self.candidate();verify_candidate(self.p)
  (self.p/'extra').write_bytes(b'bad')
  with self.assertRaisesRegex(RuntimeError,'closure'):verify_candidate(self.p)
  (self.p/'extra').unlink();(self.p/'assets/model').write_bytes(b'changed')
  with self.assertRaisesRegex(RuntimeError,'inventory'):verify_candidate(self.p)
 def test_run_location_cannot_select_production(self):
  with patch('core.acceptance.windows_state_root',return_value=self.p):
   expected=self.p/'acceptance-evidence/runs'/('a'*32)
   self.assertEqual(run_directory('a'*32),expected)
   for invalid in ['../vault','production','a'*31,'C:\\vault']:
    with self.assertRaises(ValueError):run_directory(invalid)
 def test_finalize_archive_and_destroy_never_touch_production(self):
  production=self.p/'vault';production.mkdir();(production/'keep').write_text('unchanged')
  with patch('core.acceptance.windows_state_root',return_value=self.p),patch('core.acceptance.WindowsStateLock'):
   for run_id,archive in [('a'*32,True),('b'*32,False)]:
    directory=run_directory(run_id);state=directory/'state';state.mkdir(parents=True);(state/'data').write_text('evaluation')
    (directory/'run.json').write_text(json.dumps({'id':run_id,'status':'ACTIVE'}))
    finish_run(run_id,archive)
    self.assertFalse(state.exists());self.assertEqual((directory/'archived-state').exists(),archive)
    with self.assertRaises(RuntimeError):finish_run(run_id,archive)
  self.assertEqual((production/'keep').read_text(),'unchanged')
 def test_completed_run_cannot_reopen(self):
  with patch('core.acceptance.windows_state_root',return_value=self.p):
   run_id='c'*32;directory=run_directory(run_id);directory.mkdir(parents=True)
   (directory/'run.json').write_text(json.dumps({'id':run_id,'status':'ARCHIVED'}))
   with self.assertRaisesRegex(RuntimeError,'inactive'):open_run(run_id,self.p)

 def test_redirected_evidence_parent_rejected(self):
  outside=self.p/'other';outside.mkdir()
  (self.p/'acceptance-evidence').symlink_to(outside,target_is_directory=True)
  with patch('core.acceptance.windows_state_root',return_value=self.p):
   with self.assertRaisesRegex(RuntimeError,'STORAGE_ERROR'):run_directory('d'*32)

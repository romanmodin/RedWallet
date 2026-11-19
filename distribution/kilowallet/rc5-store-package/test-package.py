import importlib.util,json,shutil,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).parent
spec=importlib.util.spec_from_file_location('verify',ROOT/'verify-package.py');v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
class IntegrityTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  for name in ['manifest.json','review-notes.txt','kilowallet-rc5-store-receive.png']:shutil.copy(ROOT/name,self.root/name)
 def change(self,fn):
  p=self.root/'manifest.json';m=json.loads(p.read_text());fn(m);p.write_text(json.dumps(m))
 def test_valid_package_never_authorizes_writes(self):self.assertFalse(v.verify(self.root)['appleWriteAuthorized'])
 def test_other_app(self):
  self.change(lambda m:m.update(appId='6817118871'))
  with self.assertRaises(ValueError):v.verify(self.root)
 def test_forged_privacy_confirmation(self):
  self.change(lambda m:m['privacyPolicy'].update(questionnaireVerified=True))
  with self.assertRaises(ValueError):v.verify(self.root)
 def test_changed_candidate(self):
  self.change(lambda m:m['candidate'].update(build='16'))
  with self.assertRaises(ValueError):v.verify(self.root)
 def test_changed_notes_even_with_updated_manifest_hash(self):
  p=self.root/'review-notes.txt';p.write_text('Changed notes')
  self.change(lambda m:m.update(reviewNotesSha256=v.hashlib.sha256(p.read_bytes()).hexdigest()))
  with self.assertRaises(ValueError):v.verify(self.root)
 def test_changed_image(self):
  with (self.root/'kilowallet-rc5-store-receive.png').open('ab') as f:f.write(b'changed')
  with self.assertRaises(ValueError):v.verify(self.root)
if __name__=='__main__':unittest.main()

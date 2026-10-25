import copy,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("qualify",Path(__file__).with_name("verify-kilowallet-upload.py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class UploadQualification(unittest.TestCase):
 def fixture(self):
  repo={"full_name":m.REPO}
  r={"repository":repo,"head_repository":repo,"id":m.RUN,"head_sha":m.HEAD,"head_branch":"main","event":"workflow_dispatch","path":".github/workflows/build-kilowallet.yml","status":"completed","conclusion":"success","run_attempt":1}
  jobs=[{"name":n,"status":"completed","conclusion":"success","run_attempt":1} for n in ["verify","qualify","certificate","sign"]]
  return r,jobs
 def test_successful_exact_upload(self):
  m.validate_run(*self.fixture())
 def test_wrong_source_or_repo_or_attempt_never_qualifies(self):
  r,j=self.fixture()
  for field,value in [("head_sha","other"),("run_attempt",2),("event","pull_request"),("conclusion","failure")]:
   d=copy.deepcopy(r);d[field]=value
   with self.assertRaises(RuntimeError):m.validate_run(d,j)
  r["head_repository"]={"full_name":"other/repo"}
  with self.assertRaises(RuntimeError):m.validate_run(r,j)
 def test_missing_or_stale_protected_job_never_qualifies(self):
  r,j=self.fixture()
  with self.assertRaises(RuntimeError):m.validate_run(r,j[:-1])
  j[-1]["run_attempt"]=2
  with self.assertRaises(RuntimeError):m.validate_run(r,j)
 def test_duplicate_jobs_are_not_evidence(self):
  r,j=self.fixture()
  with self.assertRaises(RuntimeError):m.validate_run(r,j+[j[0]])
 def test_artifact_expiration_and_foreign_source_rejected_before_unpack(self):
  d={"id":m.ARTIFACT,"expired":True,"workflow_run":{"id":m.RUN,"head_sha":m.HEAD}}
  with self.assertRaises(RuntimeError):m.validate_artifact(d,b"")
  d["expired"]=False;d["workflow_run"]["head_sha"]="foreign"
  with self.assertRaises(RuntimeError):m.validate_artifact(d,b"")
 def test_zip_tampering_rejected(self):
  d={"id":m.ARTIFACT,"expired":False,"workflow_run":{"id":m.RUN,"head_sha":m.HEAD},"digest":"sha256:"+m.ZIP_SHA}
  with self.assertRaises(RuntimeError):m.validate_artifact(d,b"tampered")
if __name__=="__main__":unittest.main()

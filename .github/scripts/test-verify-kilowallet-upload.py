import copy,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("qualify",Path(__file__).with_name("verify-kilowallet-upload.py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from unittest.mock import patch
class UploadQualification(unittest.TestCase):
 def fixture(self):
  repo={"full_name":m.REPO}
  r={"repository":repo,"head_repository":repo,"id":m.RUN,"head_sha":m.HEAD,"head_branch":"main","event":"workflow_dispatch","path":".github/workflows/build-kilowallet.yml","status":"completed","conclusion":"success","run_attempt":1}
  jobs=[{"name":n,"status":"completed","conclusion":"success","run_attempt":1} for n in ["verify","qualify","certificate","sign"]]
  return r,jobs
 def receipts(self):
  gate=lambda i,n:dict(id=i,sourceCommit=m.SOURCE,runAttempt=1,jobs={n:51},checkouts={n:{"tree":"a"*40,"checkoutCommit":m.SOURCE}})
  gates=dict(sourceCommit=m.SOURCE,gates=[gate(m.IOS_RUN,"native"),gate(m.SCREEN_RUN,"verify")])
  gates["gates"][0]["requiredSteps"]={"Build Release for iphoneos without signing":21}
  shared=dict(sourceCommit=m.SOURCE,ipaSha256=m.IPA,runId=str(m.RUN),runAttempt="1",build=m.BUILD_NUMBER)
  p=dict(shared,bundle="com.kilombino.kilowallet",team="PPG9C98EY9",version=m.VERSION,signature="verified",sdk=m.SDK,orchestrationCommit=m.HEAD,usesNonExemptEncryption=False,qualification=copy.deepcopy(gates))
  a=dict(shared,app="6824331953",appleBuildId=m.BUILD,marketingVersion=m.VERSION,platform="IOS",processing="VALID",usesNonExemptEncryption=False)
  t=dict(shared,app="6824331953",bundle=p["bundle"],mode="GET-only",territories=["USA"],availableInNewTerritories=False)
  return p,a,gates,copy.deepcopy(p),t
 def test_v1_compares_uploaded_and_rechecked_checkout_and_step_evidence(self):
  args=self.receipts();self.assertTrue(m.validate_receipts(*args)["uploadVerified"])
  self.assertIs(m.validate_receipts(*args)["usesNonExemptEncryption"],False)
  for key,value in [("checkouts",{}),("requiredSteps",{}),("runAttempt",3),("jobs",{"native":52})]:
   x=copy.deepcopy(args);x[2]["gates"][0][key]=value
   with self.subTest(key=key),self.assertRaises(RuntimeError):m.validate_receipts(*x)
 def test_receipt_identity_scope_and_strict_encryption_flags(self):
  changes=[(0,"sourceCommit","other"),(0,"sdk","iphoneos25"),(1,"platform","MAC_OS"),(1,"appleBuildId","other"),(1,"processing","PROCESSING"),(3,"sourceCommit","other"),(4,"territories",["USA","FRA"]),(4,"availableInNewTerritories",True),(4,"ipaSha256","other"),(4,"mode","write"),(4,"app","other")]
  changes += [(i,"usesNonExemptEncryption",v) for i in (0,1,3) for v in (True,None,0,"false")]
  for i,key,value in changes:
   x=copy.deepcopy(self.receipts());x[i][key]=value
   with self.subTest(i=i,key=key,value=value),self.assertRaises(RuntimeError):m.validate_receipts(*x)
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

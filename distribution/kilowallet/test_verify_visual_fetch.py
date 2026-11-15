import copy
import unittest
from fetch_verified_visual import REPO, validate_remote
from verify_visual import ARTIFACT, ARTIFACT_SHA256, ATTEMPT, RUN, SOURCE

class FetchTests(unittest.TestCase):
    def setUp(self):
        self.run = {"id":RUN,"run_attempt":ATTEMPT,"head_sha":SOURCE,
            "repository":{"full_name":REPO},"head_repository":{"full_name":REPO},
            "path":".github/workflows/ios.yml","event":"pull_request",
            "status":"completed","conclusion":"success"}
        self.artifact = {"id":ARTIFACT,"name":"screenshots","expired":False,
            "digest":"sha256:"+ARTIFACT_SHA256,"workflow_run":{"id":RUN,"head_sha":SOURCE}}
        self.receipt = {"run":RUN,"attempt":ATTEMPT,"sourceCommit":SOURCE,
            "artifact":{"id":ARTIFACT,"sha256":ARTIFACT_SHA256}}
    def test_valid(self): self.assertTrue(validate_remote(self.run,self.artifact,self.receipt))
    def test_reject_wrong_run(self):
        values = [("id",0),("run_attempt",2),("head_sha","bad"),("path","bad"),
                  ("event","workflow_dispatch"),("status","in_progress"),("conclusion","failure"),
                  ("repository",{"full_name":"foreign"}),("head_repository",{"full_name":"foreign"})]
        for key,bad in values:
            run=copy.deepcopy(self.run);run[key]=bad
            with self.subTest(key=key),self.assertRaises(AssertionError): validate_remote(run,self.artifact,self.receipt)
    def test_reject_wrong_artifact(self):
        values=[("id",2),("name","other"),("expired",True),("digest","sha256:wrong"),
                ("workflow_run",{"id":0,"head_sha":SOURCE}),("workflow_run",{"id":RUN,"head_sha":"wrong"})]
        for key,bad in values:
            artifact=copy.deepcopy(self.artifact);artifact[key]=bad
            with self.subTest(key=key),self.assertRaises(AssertionError): validate_remote(self.run,artifact,self.receipt)
    def test_reject_wrong_receipt(self):
        for key,bad in [("run",0),("attempt",2),("sourceCommit","wrong")]:
            receipt=copy.deepcopy(self.receipt);receipt[key]=bad
            with self.subTest(key=key),self.assertRaises(AssertionError): validate_remote(self.run,self.artifact,receipt)
        for key,bad in [("id",0),("sha256","wrong")]:
            receipt=copy.deepcopy(self.receipt);receipt["artifact"][key]=bad
            with self.subTest(key=key),self.assertRaises(AssertionError): validate_remote(self.run,self.artifact,receipt)

if __name__ == "__main__": unittest.main()

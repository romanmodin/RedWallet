import unittest,copy
from verify_visual import validate_manual,SOURCE,RUN,HARNESS
class ManualGate(unittest.TestCase):
 def good(self):return {"sourceCommit":SOURCE,"run":RUN,"attempt":1,"harnessCommit":HARNESS,"imageHashes":{"a":"0"*64},"allImagesReviewed":True,"glyphsComplete":True,"sameProcessReentryReviewed":True,"approvedForSigning":True,"reviewedAt":"2026-11-06T00:00:00Z"}
 def test_complete(self):validate_manual(self.good(),{"a":"0"*64})
 def test_missing_each_field(self):
  for k in self.good():
   v=self.good();del v[k]
   with self.assertRaises((AssertionError,KeyError)):validate_manual(v,{"a":"0"*64})
 def test_changed_artifact(self):
  with self.assertRaises(AssertionError):validate_manual(self.good(),{"a":"1"*64})
 def test_unreviewed_rejected(self):
  for k in ["allImagesReviewed","glyphsComplete","sameProcessReentryReviewed","approvedForSigning"]:
   v=self.good();v[k]=False
   with self.assertRaises(AssertionError):validate_manual(v,{"a":"0"*64})
 def test_wrong_source_run_attempt_or_harness(self):
  for k in ["sourceCommit","run","attempt","harnessCommit"]:
   v=self.good();v[k]="wrong"
   with self.assertRaises(AssertionError):validate_manual(v,{"a":"0"*64})
if __name__=="__main__":unittest.main()

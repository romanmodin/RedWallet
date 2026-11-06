import copy,unittest
from fetch_verified_visual import validate_remote,REPO
from verify_visual import RUN,HARNESS,SOURCE
class FetchTests(unittest.TestCase):
 def setUp(self):
  self.r={'id':RUN,'run_attempt':1,'head_sha':HARNESS,'repository':{'full_name':REPO},'head_repository':{'full_name':REPO},'path':'.github/workflows/ios.yml','event':'workflow_dispatch','status':'completed','conclusion':'success'}
  self.a={'id':1,'name':'candidate-lnd-frame-evidence','expired':False,'digest':'sha256:abc','workflow_run':{'id':RUN,'head_sha':HARNESS}}
  self.p={'artifact':{'id':1,'sha256':'abc'},'expectedAppSource':SOURCE}
 def test_valid(self):self.assertTrue(validate_remote(self.r,self.a,self.p))
 def test_reject_wrong_run(self):
  for key,value in [('id',0),('run_attempt',2),('head_sha','bad'),('path','bad'),('event','pull_request'),('status','in_progress'),('conclusion','failure'),('repository',{'full_name':'foreign'}),('head_repository',{'full_name':'foreign'})]:
   with self.subTest(key=key):
    r=copy.deepcopy(self.r);r[key]=value
    with self.assertRaises(AssertionError):validate_remote(r,self.a,self.p)
 def test_reject_wrong_artifact(self):
  for key,value in [('id',2),('name','other'),('expired',True),('digest','sha256:wrong'),('workflow_run',{'id':0,'head_sha':HARNESS}),('workflow_run',{'id':RUN,'head_sha':'wrong'})]:
   with self.subTest(key=key,value=value):
    a=copy.deepcopy(self.a);a[key]=value
    with self.assertRaises(AssertionError):validate_remote(self.r,a,self.p)
 def test_reject_wrong_app(self):
  p=copy.deepcopy(self.p);p['expectedAppSource']='wrong'
  with self.assertRaises(AssertionError):validate_remote(self.r,self.a,p)

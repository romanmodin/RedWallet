"""Offline tests for the boundary between delivered, processed, and installable."""
import copy
import hashlib
import importlib.util
import io
import json
import unittest
import zipfile
from pathlib import Path

path = Path(__file__).with_name("verify-kilowallet-rc7-beta.py")
spec = importlib.util.spec_from_file_location("rc7beta", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
UID = "978ff8c6-ad0e-47a2-95ba-370cab94b47d"  # synthetic, never a release pin
NOW = "2026-11-18T03:10:12Z"

def report():
    return {"appId":m.APP,"app":{"id":m.APP,"bundleId":m.BUNDLE},"mode":"read-only",
            "observedAt":NOW,"inspectionComplete":True,"errors":[],"rc7Processing":{
                "id":UID,"found":True,"expired":False,"usesNonExemptEncryption":False,"testerMembershipVerified":False,
                "build":"30","version":"1.0.0","platform":"IOS","processingState":"VALID"}}

def step(result="success"):
    return {"started_at":"2026-11-18T03:10:11Z","completed_at":"2026-11-18T03:10:15Z","conclusion":result}

def fixtures():
    run = dict(id=114, repository={"full_name":m.original.REPO}, head_repository={"full_name":m.original.REPO},
               head_branch="main",head_sha="a"*40,event="workflow_dispatch",path=".github/workflows/kilowallet-preflight.yml",
               run_attempt=1,status="completed",conclusion="success")
    jobs = [dict(name=n,run_id=114,head_sha=run["head_sha"],run_attempt=1,status="completed",conclusion="success") for n in ("verify","inspect")]
    jobs[1]["steps"] = [dict(number=n,name=name,status="completed",**step()) for n,name in ((2,m.CHECKOUT),(4,m.READ_STEP),(5,m.SAVE))]
    return run,jobs

class SignedExport(unittest.TestCase):
    def test_archive_and_export_have_separately_pinned_executables(self):
        a={"executableSha256":"7a2ea330877f32425611b4f2752236d1889243a1e039097cb973c1f5f73a00bf","build":"30","profileUuid":"fixture"}
        p={**a,"ipaSha256":m.original.IPA,"executableSha256":"31c476027a21ca4bb4a366dc797fb90330e981caaa90c4e27da356cc0bde8450"}
        m.bind_archive(p,a)
        for altered, archived in ((dict(p,executableSha256=a["executableSha256"]),a),(p,dict(a,executableSha256=p["executableSha256"])),
                                 (dict(p,ipaSha256="0"*64),a),(dict(p,profileUuid="other"),a),(p,dict(a,build="21"))):
            with self.assertRaises(RuntimeError): m.bind_archive(altered,archived)

class Apple(unittest.TestCase):
    def test_valid_does_not_claim_tester_membership(self):
        p=report()
        self.assertEqual(m.valid_apple(p,step()), UID)
        self.assertIs(p["rc7Processing"]["testerMembershipVerified"],False)

    def test_missing_or_other_build_cannot_supply_processing(self):
        for k,v in (("found",False),("id","wrong"),("id","00000000-0000-0000-0000-000000000000"),
                    ("build","21"),("version","1.0.1"),("platform","MAC_OS"),
                    ("processingState","PROCESSING"),("processingState","FAILED"),
                    ("expired",True),("usesNonExemptEncryption",None),("testerMembershipVerified",True)):
            with self.subTest(k=k,v=v):
                p=report(); p["rc7Processing"][k]=v
                with self.assertRaises((RuntimeError,ValueError)): m.valid_apple(p,step())

    def test_no_mail_or_invite_or_other_app(self):
        for p in ({"delivery":"successful"}, {"inviteStatus":200}, dict(report(),app={"id":m.APP,"bundleId":"wrong"}),dict(report(),writes=["POST"]),dict(report(),failure={"stage":"identity"})):
            with self.assertRaises((RuntimeError,KeyError)): m.valid_apple(p,step())

    def test_unrelated_listing_denial_requires_its_matching_failed_step(self):
        p=report(); p.update(inspectionComplete=False,errors=[{"resource":"publicReview","httpStatus":401,"kind":"HTTPError"}])
        self.assertEqual(m.valid_apple(p,step("failure")),UID)
        with self.assertRaises(RuntimeError): m.valid_apple(p,step())
        for resource,code in (("rc7Processing",401),("publicReview",500),("betaGroups",403)):
            bad=copy.deepcopy(p);bad["errors"][0].update(resource=resource,httpStatus=code)
            with self.assertRaises(RuntimeError): m.valid_apple(bad,step("failure"))

    def test_time_bound_to_exact_protected_read(self):
        for observed in ("2026-11-17T22:25:30Z","2026-11-18T03:09:12Z","2026-11-18T03:20:12Z"):
            with self.assertRaises(RuntimeError): m.valid_apple(dict(report(),observedAt=observed),step())

class Provenance(unittest.TestCase):
    def test_main_run_and_reviewed_inspector_required(self):
        run,jobs=fixtures()
        self.assertEqual(m.inspector_provenance(114,run,jobs,m.INSPECTOR)["name"],m.READ_STEP)
        for k,v in (("head_branch","topic"),("head_repository",{"full_name":"other/x"}),("event","pull_request"),
                    ("run_attempt",2),("path",".github/workflows/other.yml"),("status","in_progress")):
            with self.assertRaises(RuntimeError): m.inspector_provenance(114,dict(run,**{k:v}),jobs,m.INSPECTOR)
        for p in m.INSPECTOR:
            with self.assertRaises(RuntimeError): m.inspector_provenance(114,run,jobs,{**m.INSPECTOR,p:"0"*40})

    def test_mixed_attempt_failed_checkout_and_missing_archive_rejected(self):
        run,jobs=fixtures()
        for idx,key,value in ((0,"run_attempt",2),(0,"head_sha","b"*40),(1,"run_id",115),(0,"conclusion","failure")):
            bad=copy.deepcopy(jobs);bad[idx][key]=value
            with self.assertRaises(RuntimeError): m.inspector_provenance(114,run,bad,m.INSPECTOR)
        for index in (0,2):
            bad=copy.deepcopy(jobs);bad[1]["steps"][index]["conclusion"]="failure"
            with self.assertRaises(RuntimeError): m.inspector_provenance(114,run,bad,m.INSPECTOR)

    def test_other_failure_and_false_success_rejected(self):
        run,jobs=fixtures();run["conclusion"]="failure";jobs[1]["conclusion"]="failure"
        with self.assertRaises(RuntimeError): m.inspector_provenance(114,run,jobs,m.INSPECTOR)
        jobs[1]["steps"][1]["conclusion"]="failure"
        self.assertEqual(m.inspector_provenance(114,run,jobs,m.INSPECTOR)["conclusion"],"failure")
        bad=copy.deepcopy(jobs);bad[1]["steps"] += [dict(number=9,name="Post Run example",status="completed",conclusion="failure")]
        with self.assertRaises(RuntimeError): m.inspector_provenance(114,run,bad,m.INSPECTOR)

    def test_archive_tied_to_run_digest_and_exact_member(self):
        run,_=fixtures()
        def archive(extra=False):
            s=io.BytesIO()
            with zipfile.ZipFile(s,"w") as z:
                z.writestr("kilowallet-apple-preflight.json",json.dumps(report()))
                if extra:z.writestr("other.json","{}")
            raw=s.getvalue()
            meta={"id":123,"name":"kilowallet-apple-preflight","expired":False,"workflow_run":{"id":run["id"],"head_sha":run["head_sha"]},"digest":"sha256:"+hashlib.sha256(raw).hexdigest()}
            return meta,raw
        meta,raw=archive()
        self.assertEqual(m.unpack(meta,raw,run)[0],report())
        for changed,data in ((dict(meta,expired=True),raw),(dict(meta,workflow_run={"id":115,"head_sha":run["head_sha"]}),raw),(meta,raw+b"."),archive(True)):
            with self.assertRaises(RuntimeError): m.unpack(changed,data,run)

if __name__ == "__main__":
    unittest.main()

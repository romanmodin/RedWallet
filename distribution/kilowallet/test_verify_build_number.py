import copy
import unittest
from pathlib import Path
from verify_build_number import APP, BUNDLE, inspect

class BuildPreflightTests(unittest.TestCase):
    def setUp(self):
        self.page={"data":[{"type":"builds","id":"old","attributes":{"version":"21","processingState":"VALID"},"relationships":{"app":{"data":{"type":"apps","id":APP}},"preReleaseVersion":{"data":{"type":"preReleaseVersions","id":"train"}}}}],
                   "included":[{"type":"preReleaseVersions","id":"train","attributes":{"version":"1.0.0","platform":"IOS"}}],"links":{}}
        self.app={"data":{"id":APP,"attributes":{"bundleId":BUNDLE}}}
    def read(self,path):
        return self.app if path=="/v1/apps/"+APP else self.page
    def test_new_build_read_only(self):
        result=inspect(self.read,"30","1.0.0")
        self.assertTrue(result["duplicateAbsent"]);self.assertEqual(result["writes"],[])
        self.assertEqual(result["existingBuilds"][0]["build"],"21")
    def test_existing_higher_or_numerically_equal_fails(self):
        for existing in ("30","31","30.0","030"):
            self.page["data"][0]["attributes"]["version"]=existing
            with self.subTest(existing=existing),self.assertRaises(ValueError):
                inspect(self.read,"30","1.0.0")
    def test_pending_failed_expired_build_numbers_cannot_be_reused(self):
        for state in ("PROCESSING","FAILED","INVALID","VALID"):
            self.page["data"][0]["attributes"].update(version="30",processingState=state,expired=True)
            with self.subTest(state=state),self.assertRaises(ValueError):inspect(self.read,"30","1.0.0")
    def test_foreign_app_train_and_missing_data_fail(self):
        for mutation in ("app","train","missing","duplicate","shape"):
            p=copy.deepcopy(self.page)
            if mutation=="app":p["data"][0]["relationships"]["app"]["data"]["id"]="other"
            if mutation=="train":p["included"][0]["attributes"]["version"]="2.0"
            if mutation=="missing":p["included"]=[]
            if mutation=="duplicate":p["data"]*=2
            if mutation=="shape":p["data"]=None
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):
                inspect(lambda path:self.app if path=="/v1/apps/"+APP else p,"30","1.0.0")
        self.app["data"]["attributes"]["bundleId"]="other"
        with self.assertRaises(ValueError):inspect(self.read,"30","1.0.0")
    def test_untrusted_or_scope_changed_pagination_fails(self):
        for path in ("https://evil.invalid/v1/builds","/v1/builds?filter%5Bapp%5D=other",
                     "https://user@api.appstoreconnect.apple.com/v1/builds","/v1/apps/other/builds"):
            self.page["links"]["next"]=path
            with self.subTest(path=path),self.assertRaises(ValueError):inspect(self.read,"30","1.0.0")
    def test_next_page_collision_is_not_missed(self):
        calls=[]
        def read(path):
            calls.append(path)
            if path=="/v1/apps/"+APP:return self.app
            p=copy.deepcopy(self.page)
            if "cursor=next" not in path:
                p["links"]["next"]="https://api.appstoreconnect.apple.com"+path+"&cursor=next"
            else:p["data"][0].update(id="new",attributes={"version":"30","processingState":"PROCESSING"})
            return p
        with self.assertRaisesRegex(ValueError,"already exists"):inspect(read,"30","1.0.0")
        self.assertEqual(len(calls),3)
    def test_cycle_and_malformed_numbers_fail(self):
        def read(path):
            if path=="/v1/apps/"+APP:return self.app
            return {"data":[],"links":{"next":path}}
        with self.assertRaisesRegex(ValueError,"Cyclic"):inspect(read,"30","1.0.0")
        for value in ("","x","-1","1.2.3.4",None):
            with self.subTest(value=value),self.assertRaises(ValueError):inspect(self.read,value,"1.0.0")
    def test_workflow_guards_signing_and_upload(self):
        w=(Path(__file__).resolve().parents[2]/".github/workflows/build-kilowallet.yml").read_text()
        pre=w.split("  preflight:\n")[1].split("  certificate:\n")[0]
        self.assertIn("needs: qualify",pre);self.assertIn("environment: ios-upload",pre)
        self.assertIn("verify_build_number.py before-signing",pre)
        self.assertIn("  certificate:\n    needs: preflight",w)
        sign=w.split("  sign:\n")[1]
        self.assertLess(sign.index("verify_build_number.py before-upload"),sign.index("- name: Upload Kilowallet"))
if __name__=="__main__":unittest.main()

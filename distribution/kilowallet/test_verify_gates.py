import copy
import unittest
from verify_gates import REPOSITORY, validate

class GatesTest(unittest.TestCase):
    def setUp(self):
        self.source = "a" * 40
        self.workflow = ".github/workflows/ios.yml"
        self.run = {"id":1,"repository":{"full_name":REPOSITORY},
                    "head_repository":{"full_name":REPOSITORY},"head_sha":self.source,
                    "path":self.workflow,"status":"completed","conclusion":"success",
                    "event":"pull_request","run_attempt":2,"html_url":"https://example.invalid/run"}
        self.jobs = [{"id":2,"name":"native","status":"completed","conclusion":"success","run_attempt":2}]
    def check(self, run=None, jobs=None):
        return validate(run or self.run, jobs if jobs is not None else self.jobs, self.source,self.workflow,{"native"})
    def test_exact_current_success(self):
        self.assertEqual(2,self.check()["runAttempt"])
    def test_mismatched_repository_source_workflow_and_event(self):
        for key,value in [("head_sha","b"*40),("path","wrong.yml"),("event","schedule"),
                          ("repository",{"full_name":"other/repo"}),("head_repository",{"full_name":"other/repo"})]:
            with self.subTest(key=key):
                run=copy.deepcopy(self.run);run[key]=value
                with self.assertRaises(RuntimeError): self.check(run=run)
    def test_incomplete_or_failed_gate(self):
        for key,value in [("status","in_progress"),("conclusion","failure"),("conclusion","skipped")]:
            run=copy.deepcopy(self.run);run[key]=value
            with self.assertRaises(RuntimeError): self.check(run=run)
    def test_stale_missing_ambiguous_or_failed_job(self):
        for jobs in [[], self.jobs+self.jobs,
                     [dict(self.jobs[0],run_attempt=1)],
                     [dict(self.jobs[0],conclusion="failure")],
                     [dict(self.jobs[0],status="in_progress")]]:
            with self.assertRaises(RuntimeError): self.check(jobs=jobs)
if __name__ == "__main__": unittest.main()

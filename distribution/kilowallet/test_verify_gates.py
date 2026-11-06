import copy
import unittest
from verify_gates import REPOSITORY, validate, checkout_sha, verify_tree

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
    def test_combined_native_job_requires_both_builds_and_real_simulator_tests(self):
        from verify_gates import NATIVE_STEPS, verify_native_steps
        steps = [dict(name=n, number=i, status="completed", conclusion="success") for i,n in enumerate(NATIVE_STEPS,1)]
        self.assertEqual(set(verify_native_steps({"steps":steps})), set(NATIVE_STEPS))
        for i in range(len(steps)):
            for sub in ([], [dict(steps[i],conclusion="skipped")], [steps[i],steps[i]]):
                with self.assertRaises(RuntimeError):
                    verify_native_steps({"steps":steps[:i]+sub+steps[i+1:]})

    def test_rc4_async_and_engine_checks_cannot_be_skipped_before_signing(self):
        from verify_gates import NATIVE_STEPS, verify_native_steps
        critical = {
            "Require asynchronous round and signed reservation regressions",
            "Fetch the Lightning engine (Lndmobile.xcframework, checked against lnd-engine/ENGINE)",
            "Fetch the Ark engine (KilombinoArk.xcframework, checked against ark-engine/ENGINE)",
            "Fetch the Tor engine (KilombinoTor.xcframework, checked against tor-engine/ENGINE)",
        }
        self.assertTrue(critical.issubset(NATIVE_STEPS))
        successful = [dict(name=n, number=i, status="completed", conclusion="success")
                      for i,n in enumerate(NATIVE_STEPS, 1)]
        for name in critical:
            with self.subTest(step=name):
                # Overall workflow success alone must not allow a skipped safety check.
                skipped = [dict(step, conclusion="skipped") if step["name"] == name else step
                           for step in successful]
                with self.assertRaises(RuntimeError):
                    verify_native_steps({"steps": skipped})
                missing = [step for step in successful if step["name"] != name]
                with self.assertRaises(RuntimeError):
                    verify_native_steps({"steps": missing})

    def test_exact_current_success(self):
        self.assertEqual(2,self.check()["runAttempt"])
    def test_mismatched_repository_source_workflow_and_event(self):
        for key,value in [("head_sha","b"*40),("path","wrong.yml"),("event","schedule"),
                          ("repository",{"full_name":"other/repo"}),("head_repository",{"full_name":"other/repo"})]:
            with self.subTest(key=key):
                run=copy.deepcopy(self.run);run[key]=value
                with self.assertRaises(RuntimeError): self.check(run=run)
    def test_checkout_log_and_equivalent_merge_tree(self):
        head,merge,tree="a"*40,"b"*40,"c"*40
        log="2026-11-03T12:00:00Z [command]/opt/homebrew/bin/git log -1 --format=%H\n2026-11-03T12:00:01Z "+merge+"\n"
        self.assertEqual(merge, checkout_sha(log))
        for bad in ["",log+log,log.replace(merge, "branch")]:
            with self.assertRaises(RuntimeError): checkout_sha(bad)
        commit={"sha":merge,"tree":{"sha":tree},"parents":[{"sha":head}]}
        self.assertEqual(tree,verify_tree(head,tree,merge,commit,"pull_request")["tree"])
        for bad,event in [(dict(commit,tree={"sha":"d"*40}),"pull_request"),(dict(commit,parents=[]),"pull_request"),(commit,"workflow_dispatch")]:
            with self.assertRaises(RuntimeError): verify_tree(head,tree,merge,bad,event)

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

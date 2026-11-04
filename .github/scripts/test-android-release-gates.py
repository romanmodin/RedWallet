#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("guard", Path(__file__).with_name("verify-android-release-gates.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
SOURCE = "a" * 40


class GateTests(unittest.TestCase):
    def fixture(self):
        run = {"id": 123, "repository": {"full_name": guard.REPOSITORY},
               "head_repository": {"full_name": guard.REPOSITORY},
               "head_sha": SOURCE, "path": ".github/workflows/e2e-android.yml",
               "event": "pull_request", "status": "completed", "conclusion": "success",
               "run_attempt": 2, "html_url": "https://github.com/romanmodin/RedWallet/actions/runs/123"}
        jobs = [{"name": name, "run_id": 123, "run_attempt": 2, "head_sha": SOURCE,
                 "status": "completed", "conclusion": "success"} for name in ["build", "test"]]
        return run, jobs

    def validate(self, run, jobs, source=SOURCE):
        return guard.validate_gate(run, jobs, source, ".github/workflows/e2e-android.yml",
                                   {"build", "test"}, "pull_request")

    def test_current_successful_attempt(self):
        self.assertEqual(self.validate(*self.fixture())["runAttempt"], 2)

    def test_rejects_wrong_repository_source_workflow_event_or_attempt(self):
        for field, value in [("repository", {"full_name": "attacker/RedWallet"}),
                             ("head_repository", {"full_name": "attacker/RedWallet"}),
                             ("head_sha", "b" * 40), ("path", ".github/workflows/e2e-ios.yml"),
                             ("event", "push"), ("run_attempt", 0)]:
            run, jobs = self.fixture()
            run[field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.validate(run, jobs)

    def test_rejects_pending_failed_skipped_or_cancelled_run(self):
        for status, conclusion in [("in_progress", None), ("completed", "failure"),
                                   ("completed", "skipped"), ("completed", "cancelled")]:
            run, jobs = self.fixture()
            run.update(status=status, conclusion=conclusion)
            with self.subTest(status=status, conclusion=conclusion), self.assertRaises(RuntimeError):
                self.validate(run, jobs)

    def test_rejects_old_attempt_wrong_run_or_source_jobs(self):
        for field, value in [("run_attempt", 1), ("run_id", 122), ("head_sha", "b" * 40)]:
            run, jobs = self.fixture()
            jobs[1][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.validate(run, jobs)

    def test_rejects_missing_duplicate_or_nonpassing_required_jobs(self):
        for kind in ["missing", "duplicate", "pending", "skipped", "failed"]:
            run, jobs = self.fixture()
            if kind == "missing":
                jobs.pop()
            elif kind == "duplicate":
                jobs.append(copy.deepcopy(jobs[1]))
            else:
                jobs[1].update(status="in_progress" if kind == "pending" else "completed",
                               conclusion={"pending": None, "skipped": "skipped", "failed": "failure"}[kind])
            with self.subTest(kind=kind), self.assertRaises(RuntimeError):
                self.validate(run, jobs)

    def test_rejects_invalid_source(self):
        with self.assertRaises(RuntimeError):
            self.validate(*self.fixture(), source="short")

    def test_android_gates_require_funded_manual_run_and_both_jobs(self):
        self.assertEqual(guard.GATES[2], ("FUNDED_ANDROID_RUN_ID",
                         ".github/workflows/native-bip84-rbf-android.yml",
                         {"build", "Native android (rbf)"}, "workflow_dispatch"))


if __name__ == "__main__":
    unittest.main()

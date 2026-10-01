#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("source_guard", Path(__file__).with_name("verify-ios-source-run.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
REPO = "romanmodin/RedWallet"
SHA = "a" * 40


class SourceValidationTests(unittest.TestCase):
    def source(self, mode="release"):
        return {
            "repository": {"full_name": REPO}, "head_repository": {"full_name": REPO},
            "path": ".github/workflows/" + ("build-ios-release-pullrequest.yml" if mode == "release" else "e2e-ios.yml"),
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_branch": "main", "head_sha": SHA,
        }

    def test_accepts_same_commit_approved_release(self):
        self.assertEqual(guard.validate_source(self.source(), "release", REPO, "main", SHA), SHA)

    def test_rejects_fork_even_when_run_repository_matches(self):
        for mode in ("release", "simulator"):
            source = self.source(mode)
            source["head_repository"]["full_name"] = "someone/RedWallet"
            with self.assertRaisesRegex(AssertionError, "Fork"):
                guard.validate_source(source, mode, REPO, "main", SHA)

    def test_rejects_pr_wrong_branch_workflow_status_and_commit(self):
        for field, value in (("event", "pull_request"), ("head_branch", "feature"),
                             ("path", ".github/workflows/other.yml"), ("status", "in_progress"),
                             ("conclusion", "failure"), ("head_sha", "b" * 40), ("head_sha", "malformed")):
            source = copy.deepcopy(self.source())
            source[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(AssertionError):
                guard.validate_source(source, "release", REPO, "main", SHA)

    def test_simulator_accepts_completed_source_pending_only_app_diff_validation(self):
        source = self.source("simulator")
        source["head_sha"] = "b" * 40
        source["conclusion"] = "failure"  # Its build job is checked separately; tests may have failed.
        self.assertEqual(guard.validate_source(source, "simulator", REPO, "main", SHA), "b" * 40)


if __name__ == "__main__":
    unittest.main()

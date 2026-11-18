#!/usr/bin/env python3
import copy
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch


module = runpy.run_path(str(Path(__file__).with_name("link-ios-upload-receipt.py")))
link = module["link_receipts"]


class UploadHandoffTests(unittest.TestCase):
    def setUp(self):
        self.source, self.orchestration = "a" * 40, "b" * 40
        self.package = {
            "ipaSha256": "c" * 64, "sourceCommit": self.source, "publicSourceCommit": self.source,
            "orchestrationCommit": self.orchestration, "productionTreeSha256": "d" * 64,
            "productionPathCount": 25, "signatureVerification": "passed", "sourceMappingVerification": "passed",
            "lightningNetwork": "mainnet", "bundles": [{"bundleId": "com.example.fixture", "build": "41"}],
            "qualification": {"sourceCommit": self.source, "gates": [{"id": 31, "runAttempt": 2}], "verifiedAt": "later"},
        }
        self.signed = copy.deepcopy(self.package)
        self.signed["sourceRunId"] = "71"
        self.signed["sourceRunAttempt"] = 2
        self.signed["qualification"]["verifiedAt"] = "earlier"

    def verify(self, signing="71", upload="72", upload_attempt=1):
        return link(self.signed, self.package, signing, upload, self.source, self.orchestration, 2, upload_attempt)

    def test_separate_and_combined_dispatches_record_actual_runs(self):
        for upload in ("71", "72"):
            with self.subTest(upload=upload):
                attempt = 2 if upload == "71" else 1
                result = self.verify(upload=upload, upload_attempt=attempt)
                self.assertEqual((result["sourceRunId"], result["uploadRunId"]), ("71", upload))
                self.assertEqual((result["sourceRunAttempt"], result["uploadRunAttempt"]), (2, attempt))
                self.assertEqual(result["qualification"], self.package["qualification"])

    def test_refuses_wrong_run_and_different_package(self):
        with self.assertRaisesRegex(ValueError, "different run"):
            self.verify(signing="70")
        for field, wrong in (("ipaSha256", "e" * 64), ("sourceCommit", "e" * 40),
                             ("orchestrationCommit", "f" * 40), ("bundles", []), ("lightningNetwork", "regtest")):
            other = {**self.signed, field: wrong}
            with self.subTest(field=field), self.assertRaises(ValueError):
                link(other, self.package, "71", "72", self.source, self.orchestration, 2, 1)

    def test_stale_signing_receipt_is_rejected(self):
        self.signed["sourceRunAttempt"] = 1
        with self.assertRaisesRegex(ValueError, "different attempt"):
            self.verify()

    def test_source_run_requires_successful_signing_and_skipped_upload(self):
        repo = {"full_name": "romanmodin/RedWallet"}
        run = {"id": 71, "html_url": "fixture", "repository": repo, "head_repository": repo,
               "event": "workflow_dispatch", "head_branch": "main", "head_sha": self.orchestration,
               "path": ".github/workflows/build-ios-approved-source.yml", "status": "completed",
               "conclusion": "success", "run_attempt": 2}
        build = {"name": "build", "status": "completed", "conclusion": "success"}
        upload = {"name": "testflight-upload", "status": "completed", "conclusion": "skipped"}
        verify = module["signing_attempt"]
        self.assertEqual(verify(run, [build, upload], "71", self.orchestration), 2)
        for jobs in ([build], [upload], [{**build, "conclusion": "skipped"}, upload],
                     [build, {**upload, "conclusion": "success"}]):
            with self.subTest(jobs=jobs), self.assertRaises((ValueError, RuntimeError)):
                verify(run, jobs, "71", self.orchestration)
        for change in ({"id": 72}, {"head_repository": {"full_name": "other/RedWallet"}},
                       {"path": "other.yml"}, {"head_sha": "f" * 40}, {"event": "pull_request"},
                       {"head_branch": "feature"}, {"status": "in_progress"}):
            with self.subTest(change=change), self.assertRaises((ValueError, RuntimeError)):
                verify({**run, **change}, [build, upload], "71", self.orchestration)

    def test_lookup_reads_jobs_from_the_selected_attempt_before_writing_output(self):
        endpoint = "repos/romanmodin/RedWallet/actions/runs/71"
        repo = {"full_name": "romanmodin/RedWallet"}
        run = {"id": 71, "repository": repo, "head_repository": repo, "html_url": "fixture",
               "path": ".github/workflows/build-ios-approved-source.yml", "event": "workflow_dispatch",
               "head_branch": "main", "head_sha": self.orchestration, "status": "completed",
               "conclusion": "success", "run_attempt": 2}
        jobs = [{"name": "build", "status": "completed", "conclusion": "success"},
                {"name": "testflight-upload", "status": "completed", "conclusion": "skipped"}]
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "github-output"
            env = {"SOURCE_RUN_ID": "71", "GITHUB_SHA": self.orchestration, "GITHUB_OUTPUT": str(out)}
            with patch.dict(os.environ, env), patch("subprocess.check_output", side_effect=[
                    json.dumps(run), json.dumps({"jobs": []}), json.dumps(run), json.dumps({"jobs": jobs})]) as api:
                with self.assertRaises(RuntimeError):
                    module["record_signing_attempt"]()
                self.assertFalse(out.exists())
                module["record_signing_attempt"]()
            self.assertEqual(out.read_text(), "attempt=2\n")
            self.assertEqual([c.args[0][-1] for c in api.call_args_list],
                             [endpoint, endpoint + "/attempts/2/jobs?per_page=100"] * 2)

    def test_combined_upload_retry_reuses_the_verified_build_from_attempt_one(self):
        self.signed["sourceRunAttempt"] = 1
        job = {"name": "build", "status": "completed", "conclusion": "success", "run_id": 71, "run_attempt": 1,
               "head_sha": self.orchestration, "steps": [{"name": "Save signing verification receipt", "conclusion": "success"}]}
        with patch("subprocess.check_output", return_value=json.dumps({"jobs": [job]})) as api:
            attempt = module["combined_signing_attempt"](self.signed, "71", 2, self.orchestration, "1")
        self.assertIn("/attempts/1/jobs?", api.call_args.args[0][-1])
        linked = link(self.signed, self.package, "71", "71", self.source, self.orchestration, attempt, 2)
        self.assertEqual((linked["sourceRunAttempt"], linked["uploadRunAttempt"]), (1, 2))
        for change in ({"conclusion": "skipped"}, {"head_sha": "f" * 40}, {"steps": []}, {"run_attempt": 2},
                       {"run_id": 99}, {"name": "testflight-upload"}):
            with self.subTest(change=change), patch("subprocess.check_output", return_value=json.dumps({"jobs": [{**job, **change}]})):
                with self.assertRaisesRegex(ValueError, "did not save"):
                    module["combined_signing_attempt"](self.signed, "71", 2, self.orchestration)

    def test_combined_upload_rejects_superseded_or_future_build_before_lookup(self):
        with patch("subprocess.check_output", side_effect=AssertionError("Unexpected network access")):
            with self.assertRaisesRegex(ValueError, "different build attempt"):
                module["combined_signing_attempt"](self.signed, "71", 3, self.orchestration, "3")
            with self.assertRaisesRegex(ValueError, "Invalid signing attempt"):
                module["combined_signing_attempt"](self.signed, "71", 1, self.orchestration)
            with self.assertRaisesRegex(ValueError, "Invalid signing attempt"):
                module["combined_signing_attempt"](self.signed, "73", 3, self.orchestration)

    def test_requalification_or_missing_proof_blocks_upload(self):
        self.package["qualification"]["gates"][0]["runAttempt"] = 3
        with self.assertRaisesRegex(ValueError, "gate attempts"):
            self.verify()
        self.package["qualification"]["gates"] = []
        self.signed["qualification"]["gates"] = []
        with self.assertRaisesRegex(ValueError, "gate attempts"):
            self.verify()
        del self.package["signatureVerification"]
        with self.assertRaises(KeyError):
            self.verify()


if __name__ == "__main__":
    unittest.main()

"""Offline release policy checks. No GitHub API calls or credentials."""
import runpy
import contextlib
import io
import json
import os
import sys
import tempfile
from unittest.mock import Mock, patch
import unittest
from pathlib import Path

verifier = runpy.run_path(str(Path(__file__).with_name("verify-ios-release-gates.py")))

class ReleaseGateTests(unittest.TestCase):
    def test_mainnet_requires_public_sync_and_funded_checks(self):
        gates = verifier["required_gates"](mainnet=True)
        self.assertEqual(gates[-1][2], {"regtest (wallet)", "regtest (payments)", "public-sync"})

    def test_mainnet_cannot_use_regtest_only_jobs(self):
        run = {"id": 1, "html_url": "fixture", "run_attempt": 1,
               "repository": {"full_name": "romanmodin/RedWallet"},
               "head_repository": {"full_name": "romanmodin/RedWallet"},
               "head_sha": "fixture", "path": ".github/workflows/xbt-lnd-ios.yml",
               "status": "completed", "conclusion": "success"}
        jobs = [{"name": name, "status": "completed", "conclusion": "success"}
                for name in ("regtest (wallet)", "regtest (payments)")]
        required = verifier["required_gates"](mainnet=True)[-1][2]
        with self.assertRaises(RuntimeError):
            verifier["validate_gate"](run, jobs, "fixture", run["path"], required)
        jobs.append({"name": "public-sync", "status": "completed", "conclusion": "failure"})
        with self.assertRaises(RuntimeError):
            verifier["validate_gate"](run, jobs, "fixture", run["path"], required)
        jobs[-1]["conclusion"] = "success"
        self.assertEqual(verifier["validate_gate"](run, jobs, "fixture", run["path"], required)["conclusion"], "success")

    def test_tor_release_rejects_missing_or_skipped_smoke_even_when_run_passed(self):
        gate = verifier["required_gates"](mainnet=True, tor_smoke=True)[-1]
        repo = {"full_name": "romanmodin/RedWallet"}
        run = {"id": 1, "html_url": "fixture", "run_attempt": 1,
               "repository": repo, "head_repository": repo, "head_sha": "fixture",
               "path": gate[1], "status": "completed", "conclusion": "success"}
        jobs = [{"name": name, "status": "completed", "conclusion": "success"}
                for name in ("regtest (wallet)", "regtest (payments)", "public-sync")]
        with self.assertRaisesRegex(RuntimeError, "Required gate jobs are missing"):
            verifier["validate_gate"](run, jobs, "fixture", run["path"], gate[2])
        tor = {"name": "tor-smoke", "status": "completed", "conclusion": "skipped"}
        with self.assertRaisesRegex(RuntimeError, "Required job did not pass: tor-smoke"):
            verifier["validate_gate"](run, jobs + [tor], "fixture", run["path"], gate[2])
        tor["conclusion"] = "success"
        self.assertEqual(verifier["validate_gate"](run, jobs + [tor], "fixture", run["path"], gate[2])["conclusion"], "success")

    def test_tor_release_cannot_select_the_regtest_only_policy(self):
        with self.assertRaisesRegex(RuntimeError, "Tor smoke qualification requires mainnet"):
            verifier["required_gates"](regtest=True, tor_smoke=True)

    def test_tor_fee_policy_is_opt_in_and_rejects_missing_or_nonpassing_job(self):
        base = verifier["required_gates"](mainnet=True, tor_smoke=True)[-1]
        gate = verifier["required_gates"](mainnet=True, tor_smoke=True, tor_fee_unit=True)[-1]
        self.assertEqual(gate[2] - base[2], {"tor-fee-unit"})
        repo = {"full_name": "romanmodin/RedWallet"}
        run = {"id": 1, "html_url": "fixture", "run_attempt": 2,
               "repository": repo, "head_repository": repo, "head_sha": "fixture",
               "path": gate[1], "status": "completed", "conclusion": "success"}
        jobs = [{"name": name, "status": "completed", "conclusion": "success"} for name in base[2]]
        with self.assertRaisesRegex(RuntimeError, "jobs are missing"):
            verifier["validate_gate"](run, jobs, "fixture", gate[1], gate[2])
        for status, conclusion in (("completed", "skipped"), ("completed", "failure"),
                                   ("completed", "cancelled"), ("in_progress", None)):
            job = {"name": "tor-fee-unit", "status": status, "conclusion": conclusion}
            with self.subTest(status=status, conclusion=conclusion), self.assertRaisesRegex(RuntimeError, "Required job did not pass"):
                verifier["validate_gate"](run, jobs + [job], "fixture", gate[1], gate[2])
        jobs.append({"name": "tor-fee-unit", "status": "completed", "conclusion": "success"})
        self.assertEqual(verifier["validate_gate"](run, jobs, "fixture", gate[1], gate[2])["runAttempt"], 2)

    def test_tor_fee_policy_requires_mainnet(self):
        with self.assertRaisesRegex(RuntimeError, "Tor fee qualification requires mainnet"):
            verifier["required_gates"](tor_fee_unit=True)

    def test_network_selection_is_explicit(self):
        with self.assertRaises(RuntimeError):
            verifier["required_gates"](mainnet=True, regtest=True)
        self.assertEqual(len(verifier["required_gates"]()), 3)


    def hardware_fixture(self):
        gate = verifier["required_gates"](standard_hardware=True)[-1]
        repo = {"full_name": "romanmodin/RedWallet"}
        run = {"id": 5, "html_url": "fixture", "run_attempt": 2,
               "repository": repo, "head_repository": repo,
               "head_sha": "a" * 40, "path": gate[1],
               "status": "completed", "conclusion": "success"}
        jobs = [{"name": name, "status": "completed", "conclusion": "success"} for name in gate[2]]
        return gate, run, jobs

    def test_standard_hardware_policy_is_opt_in_and_requires_both_jobs(self):
        self.assertEqual(len(verifier["required_gates"]()), 3)
        gate, run, jobs = self.hardware_fixture()
        self.assertEqual(gate[0], "HARDWARE_IOS_RUN_ID")
        self.assertEqual(gate[2], {"build", "Watch-only signing on iOS simulator"})
        result = verifier["validate_gate"](run, jobs, "a" * 40, gate[1], gate[2])
        self.assertEqual(result["conclusion"], "success")
        self.assertEqual(result["runAttempt"], 2)

    def test_hardware_release_rejects_missing_or_nonpassing_jobs_in_green_run(self):
        gate, run, jobs = self.hardware_fixture()
        for index, job in enumerate(jobs):
            with self.subTest(missing=job["name"]), self.assertRaisesRegex(RuntimeError, "jobs are missing"):
                verifier["validate_gate"](run, jobs[:index] + jobs[index + 1:], "a" * 40, gate[1], gate[2])
            for status, conclusion in (("completed", "skipped"), ("completed", "failure"),
                                       ("completed", "cancelled"), ("in_progress", None)):
                changed = [dict(item) for item in jobs]
                changed[index].update(status=status, conclusion=conclusion)
                with self.subTest(job=job["name"], status=status, conclusion=conclusion), self.assertRaisesRegex(RuntimeError, "Required job did not pass"):
                    verifier["validate_gate"](run, changed, "a" * 40, gate[1], gate[2])

    def test_hardware_release_rejects_wrong_source_workflow_repository_or_run_state(self):
        gate, run, jobs = self.hardware_fixture()
        for key, value in (("head_sha", "b" * 40), ("path", ".github/workflows/e2e-ios.yml"),
                           ("repository", {"full_name": "someone/RedWallet"}),
                           ("head_repository", {"full_name": "someone/RedWallet"}),
                           ("status", "in_progress"), ("conclusion", "failure")):
            changed = dict(run, **{key: value})
            with self.subTest(field=key), self.assertRaises(RuntimeError):
                verifier["validate_gate"](changed, jobs, "a" * 40, gate[1], gate[2])

    def test_invalid_release_flags_fail_before_network_access(self):
        for variable in ("REQUIRE_STANDARD_HARDWARE_IOS", "REQUIRE_XBT_TOR_SMOKE", "REQUIRE_XBT_TOR_FEE_UNIT"):
            with self.subTest(variable=variable), patch.dict(os.environ, {"SOURCE_COMMIT": "a" * 40, variable: "true"}, clear=True), \
                 patch.object(sys, "argv", ["verify-ios-release-gates.py"]), \
                 patch.dict(verifier["main"].__globals__, {"api": Mock(side_effect=AssertionError("Unexpected network access"))}), \
                 self.assertRaisesRegex(RuntimeError, variable + " must be 0 or 1"):
                verifier["main"]()

    def test_enabled_hardware_gate_is_verified_before_receipt_is_written(self):
        source = "a" * 40
        gates = verifier["required_gates"](mainnet=True, tor_smoke=True, standard_hardware=True, tor_fee_unit=True)
        env = {"SOURCE_COMMIT": source, "VERIFY_LND_MAINNET_IPA": "1",
               "REQUIRE_XBT_TOR_SMOKE": "1", "REQUIRE_STANDARD_HARDWARE_IOS": "1",
               "REQUIRE_XBT_TOR_FEE_UNIT": "1"}
        for index, gate in enumerate(gates, 1):
            env[gate[0]] = str(index)
        hardware_success = False
        calls = []
        def fake_api(path):
            calls.append(path)
            run_id = int(path.split("/runs/")[1].split("/")[0])
            gate = gates[run_id - 1]
            if "/attempts/" in path:
                self.assertIn("/attempts/2/jobs", path)
                jobs = [{"name": name, "status": "completed", "conclusion": "success"} for name in gate[2]]
                if gate[0] == "HARDWARE_IOS_RUN_ID" and not hardware_success:
                    for job in jobs:
                        if job["name"] == "Watch-only signing on iOS simulator":
                            job["conclusion"] = "skipped"
                return {"jobs": jobs}
            return {"id": run_id, "html_url": "fixture", "run_attempt": 2,
                    "repository": {"full_name": "romanmodin/RedWallet"},
                    "head_repository": {"full_name": "romanmodin/RedWallet"},
                    "head_sha": source, "path": gate[1], "status": "completed", "conclusion": "success"}
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "receipt.json"
            with patch.dict(os.environ, env, clear=True), patch.object(sys, "argv", ["verify-ios-release-gates.py", "--receipt", str(receipt)]), \
                 patch.dict(verifier["main"].__globals__, {"api": fake_api}), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, "Required job did not pass"):
                    verifier["main"]()
                self.assertFalse(receipt.exists())
                hardware_success = True
                verifier["main"]()
            result = json.loads(receipt.read_text())
            self.assertEqual(result["sourceCommit"], source)
            self.assertEqual(len(result["gates"]), 5)
            self.assertEqual(result["gates"][-1]["workflow"], ".github/workflows/standard-hardware-ios.yml")
            self.assertTrue(all(gate["runAttempt"] == 2 for gate in result["gates"]))
            self.assertEqual(len(calls), 20)

if __name__ == "__main__":
    unittest.main()

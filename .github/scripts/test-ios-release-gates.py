"""Offline release policy checks. No GitHub API calls or credentials."""
import runpy
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

    def test_network_selection_is_explicit(self):
        with self.assertRaises(RuntimeError):
            verifier["required_gates"](mainnet=True, regtest=True)
        self.assertEqual(len(verifier["required_gates"]()), 3)

if __name__ == "__main__":
    unittest.main()

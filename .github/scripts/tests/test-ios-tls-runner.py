import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import time
import unittest

runner = runpy.run_path(str(Path(__file__).resolve().parents[1] / "run-ios-tls.py"))
cases = runner["SCENARIOS"]


class TlsRunnerTest(unittest.TestCase):
    def test_all_original_certificate_cases_default_and_no_retry(self):
        self.assertEqual(len(cases), 7)
        self.assertEqual(sum(bool(c.get("accepted")) for c in cases), 2)
        self.assertEqual({c["id"] for c in cases}, {
            "private-ca", "server-certificate", "expired-trusted-server",
            "untrusted", "wrong-name", "expired", "replaced"})
        self.assertEqual(runner["selected_scenarios"]({"REDWALLET_TLS_CASE": "private-ca"}), cases)
        self.assertEqual([c["id"] for c in runner["selected_scenarios"](
            {"TLS_TRUSTED_CERT_RECHECK": "true"})], ["server-certificate"])
        self.assertEqual(runner["PROCESS_TIMEOUT_SECONDS"], 600)
        for case in cases:
            command = runner["detox_command"](case)
            self.assertEqual(command[command.index("--retries") + 1], "0")
            self.assertIn("tests/e2e/electrum-tls.spec.js", command)
            self.assertNotIn("--testNamePattern", command)

    def test_each_case_gets_a_distinct_process_and_exact_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "observations"
            receipt = Path(directory) / "receipt.json"
            script = (
                "import os,json,pathlib; "
                "p=pathlib.Path(os.environ['OBSERVATIONS']); "
                "p.open('a').write(json.dumps([os.environ['REDWALLET_TLS_CASE'],os.getpid()])+'\\n')"
            )
            result = runner["run_scenarios"](
                lambda case: [sys.executable, "-c", script],
                dict(os.environ, OBSERVATIONS=str(log)), cases, receipt, 5, 0.1)
            self.assertEqual(result, 0)
            observations = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual([row[0] for row in observations], [case["id"] for case in cases])
            self.assertEqual(len({row[1] for row in observations}), 7)
            report = json.loads(receipt.read_text())
            self.assertTrue(report["complete"])
            self.assertTrue(all(row["status"] == "success" for row in report["cases"]))

    def test_nonzero_exit_stops_remaining_cases_without_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "receipt.json"
            invoked = []
            def command(case):
                invoked.append(case["id"])
                return [sys.executable, "-c", "raise SystemExit(7)"]
            self.assertEqual(runner["run_scenarios"](command, os.environ, cases, receipt, 5, 0.1), 1)
            self.assertEqual(invoked, [cases[0]["id"]])
            report = json.loads(receipt.read_text())
            self.assertFalse(report["complete"])
            self.assertEqual(report["cases"][0]["exitCode"], 7)

    def test_timeout_kills_late_child_and_stops_the_matrix(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "receipt.json"
            child_started = Path(directory) / "started"
            late = Path(directory) / "late"
            child = (
                "import signal,time,pathlib;"
                "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
                f"pathlib.Path({str(child_started)!r}).write_text('ready');"
                "time.sleep(3);"
                f"pathlib.Path({str(late)!r}).write_text('must never happen');"
                "time.sleep(30)"
            )
            parent = (
                "import subprocess,sys,time;"
                f"subprocess.Popen([sys.executable,'-c',{child!r}]);"
                "time.sleep(30)"
            )
            invoked = []
            def command(case):
                invoked.append(case["id"])
                return [sys.executable, "-c", parent]
            started = time.monotonic()
            self.assertEqual(runner["run_scenarios"](command, os.environ, cases, receipt, 2, 0.1), 1)
            self.assertTrue(child_started.exists(), "fixture child never started")
            self.assertLess(time.monotonic() - started, 5)
            self.assertEqual(len(invoked), 1)
            report = json.loads(receipt.read_text())
            self.assertFalse(report["complete"])
            self.assertEqual(report["cases"][0]["exitCode"], 124)
            self.assertTrue(report["cases"][0]["timedOut"])
            time.sleep(1.2)
            self.assertFalse(late.exists(), "timed-out test child survived cleanup")

    def test_unknown_selection_fails_without_starting_any_child(self):
        with tempfile.TemporaryDirectory() as directory:
            def forbidden(case):
                self.fail("invalid selection launched a child")
            with self.assertRaises(ValueError):
                runner["run_scenarios"](forbidden, os.environ, [{"id": "unknown"}],
                                        Path(directory) / "receipt.json")


if __name__ == "__main__":
    unittest.main()

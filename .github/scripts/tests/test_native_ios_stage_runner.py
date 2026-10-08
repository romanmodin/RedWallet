import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("native_ios_runner", sys.argv.pop(1))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

CHILD = """
import os, signal, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
while True:
    with open(os.environ["HEARTBEAT"], "a") as out:
        out.write("tick\\n")
    time.sleep(0.01)
"""

PARENT = """
import os, subprocess, sys, time
from pathlib import Path
with open(os.environ["TRACE"], "a") as out:
    out.write(os.environ["REDWALLET_NATIVE_FORMAT"] + "\\n")
if os.environ["REDWALLET_NATIVE_FORMAT"] == "segwit":
    child = subprocess.Popen([sys.executable, "-c", os.environ["CHILD_CODE"]])
    Path(os.environ["CHILD_PID"]).write_text(str(child.pid))
    deadline = time.monotonic() + 2
    while not Path(os.environ["HEARTBEAT"]).exists():
        if time.monotonic() > deadline:
            raise RuntimeError("child did not start")
        time.sleep(0.01)
    if os.environ["MODE"] == "timeout":
        time.sleep(60)
    else:
        sys.exit(7)
else:
    heartbeat = Path(os.environ["HEARTBEAT"])
    before = heartbeat.read_bytes()
    time.sleep(0.12)
    if heartbeat.read_bytes() != before:
        raise RuntimeError("preceding format is still running")
    Path(os.environ["ISOLATED"]).write_text("yes")
"""


class NativeIosRunnerTest(unittest.TestCase):
    def run_pair(self, command, environment, timeout=2):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            status = runner.run_formats(
                lambda _: [sys.executable, "-c", command],
                environment, timeout_seconds=timeout, grace_seconds=0.05,
            )
        return status, output.getvalue()

    def test_only_delete_gets_extended_process_bound(self):
        self.assertEqual(runner.process_timeout_seconds("delete"), 20 * 60)

    def test_other_stages_retain_default_process_bound(self):
        for stage in ("recovery", "receive", "send", "rbf", "cpfp", "encryption", "final"):
            self.assertEqual(runner.process_timeout_seconds(stage), 18 * 60)

    def test_both_formats_execute_once_in_order(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = Path(directory) / "trace"
            command = 'import os; open(os.environ["TRACE"], "a").write(os.environ["REDWALLET_NATIVE_FORMAT"] + "\\n")'
            status, _ = self.run_pair(command, dict(os.environ, TRACE=str(trace)))
            self.assertEqual(status, 0)
            self.assertEqual(trace.read_text().splitlines(), ["segwit", "taproot"])

    def check_failed_group(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            paths = {name: str(Path(directory) / name) for name in ("TRACE", "HEARTBEAT", "CHILD_PID", "ISOLATED")}
            env = dict(os.environ, **paths, CHILD_CODE=CHILD, MODE=mode)
            try:
                status, output = self.run_pair(PARENT, env, timeout=1 if mode == "timeout" else 2)
                self.assertEqual(status, 1)
                self.assertEqual(Path(paths["TRACE"]).read_text().splitlines(), ["segwit", "taproot"])
                self.assertEqual(Path(paths["ISOLATED"]).read_text(), "yes")
                self.assertIn("segwit exit=" + ("124" if mode == "timeout" else "7"), output)
                self.assertIn("taproot exit=0", output)
            finally:
                # Even a broken implementation must not leak test fixtures.
                if Path(paths["CHILD_PID"]).exists():
                    try:
                        os.kill(int(Path(paths["CHILD_PID"]).read_text()), 9)
                    except ProcessLookupError:
                        pass

    def test_failed_parent_cannot_leave_backend_running_in_next_format(self):
        self.check_failed_group("exit")

    def test_timeout_terminates_process_tree_before_next_format(self):
        self.check_failed_group("timeout")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Run each iOS format once in its own bounded process group."""
import os
import signal
import subprocess
import sys
import time

FORMATS = ("segwit", "taproot")
# Jest still permits 900 seconds per case. This outer bound only allows CLI
# startup and teardown within the existing 40-minute two-format workflow step.
PROCESS_TIMEOUT_SECONDS = 18 * 60


def stop_group(process, grace_seconds):
    """Terminate only this runner's group, including orphaned backend children."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait()
        return
    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def run_formats(command_for_format, environment, timeout_seconds=PROCESS_TIMEOUT_SECONDS, grace_seconds=5):
    failed = False
    for wallet_format in FORMATS:
        env = dict(environment, REDWALLET_NATIVE_FORMAT=wallet_format)
        print("[native-runner] starting " + wallet_format, flush=True)
        process = subprocess.Popen(command_for_format(wallet_format), env=env, start_new_session=True)
        try:
            result = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            result = 124
            print("[native-runner] process deadline exceeded for " + wallet_format, flush=True)
        finally:
            # Jest timeouts do not cancel async test bodies. No process from the
            # preceding format may continue wallet operations in the next format.
            stop_group(process, grace_seconds)
        print("[native-runner] finished " + wallet_format + " exit=" + str(result), flush=True)
        failed = failed or result != 0
    return 1 if failed else 0


def detox_command(wallet_format):
    return [
        "npx", "detox", "test", "-c", "ios.release",
        "tests/e2e/native-live-lifecycle.spec.ts", "--runTestsByPath",
        "--record-videos", "failing", "--record-logs", "failing",
        "--take-screenshots", "failing", "--headless", "--retries", "0", "--reuse",
        "--artifacts-location", "artifacts/native-lifecycle/detox-ios/" + wallet_format,
    ]


if __name__ == "__main__":
    if os.environ.get("REDWALLET_NATIVE_STAGE") not in (
        "recovery", "receive", "send", "rbf", "cpfp", "encryption", "delete", "final"
    ):
        sys.exit("Select one lifecycle stage before running the iOS format pair")
    sys.exit(run_formats(detox_command, os.environ))

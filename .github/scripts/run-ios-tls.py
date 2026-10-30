#!/usr/bin/env python3
"""Run all native TLS cases once, with no surviving work between cases."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = json.loads((ROOT / "tests/e2e/tls-scenarios.json").read_text())
# Same ten-minute case ceiling as Jest. The existing workflow ceiling stays 90m.
PROCESS_TIMEOUT_SECONDS = 600
stop_group = runpy.run_path(str(Path(__file__).with_name("run-native-ios-stage.py")))["stop_group"]


def selected_scenarios(environment):
    # Retain the pre-existing explicit manual diagnostic mode. Default always
    # runs all seven cases, even if a stale individual-case variable was inherited.
    if environment.get("TLS_TRUSTED_CERT_RECHECK") == "true":
        return [case for case in SCENARIOS if case["id"] == "server-certificate"]
    return SCENARIOS


def detox_command(case):
    return [
        "npx", "detox", "test", "-c", "ios.release",
        "tests/e2e/electrum-tls.spec.js", "--runTestsByPath",
        "--record-videos", "failing", "--record-logs", "failing",
        "--take-screenshots", "failing", "--headless", "--retries", "0",
        "--reuse", "--artifacts-location", "artifacts/tls/" + case["id"],
    ]


def run_scenarios(command_for_case, environment, cases, receipt_path,
                  timeout_seconds=PROCESS_TIMEOUT_SECONDS, grace_seconds=5):
    if not cases or any(case not in SCENARIOS for case in cases):
        raise ValueError("Unknown or empty TLS case selection")
    receipt = {"requiredCases": [case["id"] for case in cases], "cases": [], "complete": False}
    path = Path(receipt_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    def save():
        path.write_text(json.dumps(receipt, indent=2) + "\n")

    save()
    for case in cases:
        env = dict(environment, REDWALLET_TLS_CASE=case["id"])
        entry = {"id": case["id"], "status": "running"}
        receipt["cases"].append(entry)
        save()
        print("[tls-runner] starting " + case["id"], flush=True)
        started = time.monotonic()
        process = subprocess.Popen(command_for_case(case), env=env, start_new_session=True)
        try:
            result = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            result = 124
            entry["timedOut"] = True
        finally:
            # Jest timeouts do not cancel async bodies. Terminate this exact
            # group, including its lingering fixture/helper children, on every
            # outcome. Never launch a subsequent case after an unknown outcome.
            stop_group(process, grace_seconds)
        entry.update(exitCode=result, elapsedSeconds=round(time.monotonic() - started, 3),
                     status="success" if result == 0 else "failure")
        save()
        print("[tls-runner] finished " + case["id"] + " exit=" + str(result), flush=True)
        if result != 0:
            return 1
    receipt["complete"] = True
    save()
    return 0


if __name__ == "__main__":
    sys.exit(run_scenarios(detox_command, os.environ, selected_scenarios(os.environ),
                          "artifacts/tls/runner.json"))

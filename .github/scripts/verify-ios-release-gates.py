#!/usr/bin/env python3
"""Fail closed unless the pinned source passed every required iOS release gate."""
import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY = "romanmodin/RedWallet"
GATES = (
    ("CI_RUN_ID", ".github/workflows/ci.yml", {"unit", "lint"}),
    ("IOS_RUN_ID", ".github/workflows/e2e-ios.yml", {"build", "test"}),
    ("FUNDED_IOS_RUN_ID", ".github/workflows/native-bip84-rbf-ios.yml", {"build", "Native ios (rbf)"}),
)



def required_gates(*, regtest=False, mainnet=False):
    if regtest and mainnet:
        raise RuntimeError("Choose exactly one Lightning network")
    gates = GATES
    if regtest or mainnet:
        jobs = {"regtest (wallet)", "regtest (payments)"}
        if mainnet:
            jobs.add("public-sync")
        gates += (("LND_IOS_RUN_ID", ".github/workflows/xbt-lnd-ios.yml", jobs),)
    return gates


def validate_gate(run, jobs, source, workflow, required_jobs):
    if run["repository"]["full_name"] != REPOSITORY or run["head_repository"]["full_name"] != REPOSITORY:
        raise RuntimeError("Gate belongs to a different source repository")
    if run["head_sha"] != source or run["path"] != workflow:
        raise RuntimeError("Gate does not qualify the pinned source/workflow")
    if run["status"] != "completed" or run["conclusion"] != "success":
        raise RuntimeError(f"Gate {run['id']} is {run['status']}/{run['conclusion']}")
    found = {job["name"]: job for job in jobs}
    if not required_jobs.issubset(found):
        raise RuntimeError("Required gate jobs are missing")
    for name in required_jobs:
        job = found[name]
        if job["status"] != "completed" or job["conclusion"] != "success":
            raise RuntimeError(f"Required job did not pass: {name}")
    return {"id": run["id"], "url": run["html_url"], "workflow": workflow,
            "source": source, "conclusion": "success", "runAttempt": run["run_attempt"]}


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", default="ios-release-gates.json")
    args = parser.parse_args()
    import os
    source = os.environ["SOURCE_COMMIT"]
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise RuntimeError("Expected a full source commit")
    receipts = []
    gates = required_gates(regtest=os.environ.get("VERIFY_LND_REGTEST_IPA") == "1",
                           mainnet=os.environ.get("VERIFY_LND_MAINNET_IPA") == "1")
    for variable, workflow, required_jobs in gates:
        run_id = os.environ[variable]
        if not run_id.isdecimal():
            raise RuntimeError("Invalid gate run ID")
        run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
        # Explicit attempt prevents an older successful attempt satisfying a rerun.
        jobs = api(f"repos/{REPOSITORY}/actions/runs/{run_id}/attempts/{run['run_attempt']}/jobs?per_page=100")["jobs"]
        receipts.append(validate_gate(run, jobs, source, workflow, required_jobs))
    result = {"verifiedAt": datetime.now(timezone.utc).isoformat(), "sourceCommit": source,
              "gates": receipts, "androidQualified": False}
    Path(args.receipt).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

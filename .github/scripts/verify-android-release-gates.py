#!/usr/bin/env python3
"""Verify exact-source software and hosted Android gates before packaging."""
import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY = "romanmodin/RedWallet"
GATES = (
    ("CI_RUN_ID", ".github/workflows/ci.yml", {"unit", "lint"}, "pull_request"),
    ("ANDROID_RUN_ID", ".github/workflows/e2e-android.yml", {"build", "test"}, "pull_request"),
    ("FUNDED_ANDROID_RUN_ID", ".github/workflows/native-bip84-rbf-android.yml",
     {"build", "Native android (rbf)"}, "workflow_dispatch"),
)


def validate_gate(run, jobs, source, workflow, required_jobs, event):
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise RuntimeError("Expected full source commit")
    if any(run[key]["full_name"] != REPOSITORY for key in ("repository", "head_repository")):
        raise RuntimeError("Wrong gate repository")
    if run["head_sha"] != source or run["path"] != workflow or run["event"] != event:
        raise RuntimeError("Wrong gate source, workflow or event")
    if run["status"] != "completed" or run["conclusion"] != "success":
        raise RuntimeError("Gate has not passed")
    attempt = run["run_attempt"]
    if type(attempt) is not int or attempt < 1:
        raise RuntimeError("Invalid gate attempt")
    for name in required_jobs:
        matches = [job for job in jobs if job["name"] == name]
        if len(matches) != 1:
            raise RuntimeError("Missing or ambiguous required job: " + name)
        job = matches[0]
        if (job["run_id"] != run["id"] or job["run_attempt"] != attempt
                or job["head_sha"] != source):
            raise RuntimeError("Required job belongs to another run, attempt or source")
        if job["status"] != "completed" or job["conclusion"] != "success":
            raise RuntimeError("Required job has not passed: " + name)
    return {"id": run["id"], "url": run["html_url"], "workflow": workflow,
            "source": source, "conclusion": "success", "runAttempt": attempt}


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", default="android-release-gates.json")
    args = parser.parse_args()
    source = os.environ["SOURCE_COMMIT"]
    receipts = []
    for variable, workflow, required, event in GATES:
        run_id = os.environ[variable]
        if not run_id.isdecimal():
            raise RuntimeError("Invalid run ID")
        run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
        if run["id"] != int(run_id):
            raise RuntimeError("Unexpected gate run")
        jobs = []
        page = 1
        while True:
            result = api(f"repos/{REPOSITORY}/actions/runs/{run_id}/attempts/"
                         f"{run['run_attempt']}/jobs?per_page=100&page={page}")
            jobs.extend(result["jobs"])
            if len(jobs) >= result["total_count"]:
                break
            if not result["jobs"]:
                raise RuntimeError("Incomplete gate job response")
            page += 1
        receipts.append(validate_gate(run, jobs, source, workflow, required, event))
    receipt = {"verifiedAt": datetime.now(timezone.utc).isoformat(),
               "sourceCommit": source, "gates": receipts,
               "hostedAndroidQualified": True, "physicalAndroidPhoneTested": False}
    Path(args.receipt).write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()

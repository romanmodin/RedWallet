#!/usr/bin/env python3
"""Bind an independently verified upload package to its original signing run."""
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys


def signing_attempt(run, jobs, expected_id, orchestration):
    if str(run["id"]) != expected_id or run["event"] != "workflow_dispatch" or run["head_branch"] != "main":
        raise ValueError("Expected the selected protected main signing dispatch")
    verifier = runpy.run_path(str(Path(__file__).with_name("verify-ios-release-gates.py")))
    verifier["validate_gate"](run, jobs, orchestration, ".github/workflows/build-ios-approved-source.yml", {"build"})
    if not any(j["name"] == "testflight-upload" and j["status"] == "completed" and j["conclusion"] == "skipped" for j in jobs):
        raise ValueError("Expected a signing-only source run")
    return run["run_attempt"]


def record_signing_attempt():
    run_id = os.environ["SOURCE_RUN_ID"]
    if not re.fullmatch(r"[1-9][0-9]*", run_id):
        raise ValueError("Invalid source run ID")
    endpoint = f"repos/romanmodin/RedWallet/actions/runs/{run_id}"
    run = json.loads(subprocess.check_output(["gh", "api", endpoint]))
    attempt = run["run_attempt"]
    if type(attempt) is not int or attempt < 1:
        raise ValueError("Invalid signing run attempt")
    jobs = json.loads(subprocess.check_output(["gh", "api", f"{endpoint}/attempts/{attempt}/jobs?per_page=100"]))["jobs"]
    verified = signing_attempt(run, jobs, run_id, os.environ["GITHUB_SHA"])
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        print(f"attempt={verified}", file=output)


def combined_signing_attempt(signed, run_id, upload_attempt, orchestration, producer_attempt=""):
    attempt = signed["sourceRunAttempt"]
    if signed["sourceRunId"] != run_id or type(attempt) is not int or not 1 <= attempt <= upload_attempt:
        raise ValueError("Invalid signing attempt for the current run")
    if producer_attempt and str(attempt) != producer_attempt:
        raise ValueError("Receipt belongs to a different build attempt")
    endpoint = f"repos/romanmodin/RedWallet/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100"
    jobs = json.loads(subprocess.check_output(["gh", "api", endpoint]))["jobs"]
    for job in jobs:
        if (job["name"] == "build" and job["status"] == "completed" and job["conclusion"] == "success"
                and str(job["run_id"]) == run_id and job["run_attempt"] == attempt and job["head_sha"] == orchestration):
            saved = any(step["name"] == "Save signing verification receipt" and step["conclusion"] == "success"
                        for step in job["steps"])
            if saved:
                return attempt
    raise ValueError("The selected build attempt did not save a verified signing receipt")


def link_receipts(signed, package, signing_run, upload_run, source, orchestration, source_attempt, upload_attempt):
    if not all(re.fullmatch(r"[1-9][0-9]*", run) for run in (signing_run, upload_run)):
        raise ValueError("Expected numeric signing and upload run IDs")
    if type(signed["sourceRunAttempt"]) is not int or min(source_attempt, upload_attempt) < 1 or signed["sourceRunAttempt"] != source_attempt:
        raise ValueError("Signing receipt is from a different attempt")
    if signed["sourceRunId"] != signing_run:
        raise ValueError("Signing receipt is from a different run")
    if package["sourceCommit"] != source or package["orchestrationCommit"] != orchestration:
        raise ValueError("Upload receipt is from a different release")
    if package["signatureVerification"] != "passed" or package["sourceMappingVerification"] != "passed":
        raise ValueError("The uploaded package must pass signature and source verification")
    if not re.fullmatch(r"[0-9a-f]{64}", package["ipaSha256"]):
        raise ValueError("Missing or invalid IPA digest")

    for key in ("ipaSha256", "bundles", "sourceCommit", "publicSourceCommit", "orchestrationCommit",
                "productionTreeSha256", "productionPathCount", "signatureVerification", "sourceMappingVerification"):
        if signed[key] != package[key]:
            raise ValueError(f"Signing and upload receipts disagree on {key}")
    if signed.get("lightningNetwork") != package.get("lightningNetwork"):
        raise ValueError("Signing and upload receipts disagree on the Lightning network")
    # Signing and upload verify the gates independently at different times.
    first, second = signed["qualification"], package["qualification"]
    if first["sourceCommit"] != source or second["sourceCommit"] != source or not second["gates"] or first["gates"] != second["gates"]:
        raise ValueError("Signing and upload must qualify the same source and gate attempts")
    return {**package, "sourceRunId": signing_run, "sourceRunAttempt": source_attempt,
            "uploadRunId": upload_run, "uploadRunAttempt": upload_attempt}


if __name__ == "__main__":
    if sys.argv[1:] == ["--source-run-attempt"]:
        record_signing_attempt()
        sys.exit(0)
    signed_path, upload_path = map(Path, sys.argv[1:])
    signed = json.loads(signed_path.read_text())
    signing_run, upload_run = os.environ["SIGNING_RUN_ID"], os.environ["GITHUB_RUN_ID"]
    upload_attempt = int(os.environ["GITHUB_RUN_ATTEMPT"])
    orchestration = os.environ["GITHUB_SHA"]
    if signing_run == upload_run:
        source_attempt = combined_signing_attempt(
            signed, upload_run, upload_attempt, orchestration, os.environ.get("PRODUCER_ATTEMPT", ""))
    else:
        source_attempt = int(os.environ["SIGNING_RUN_ATTEMPT"])
    linked = link_receipts(signed, json.loads(upload_path.read_text()), signing_run, upload_run,
                           os.environ["SOURCE_COMMIT"], orchestration, source_attempt, upload_attempt)
    upload_path.write_text(json.dumps(linked, indent=2) + "\n")

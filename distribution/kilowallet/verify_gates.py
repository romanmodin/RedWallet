"""Fail closed unless the exact Kilowallet source has current-attempt native evidence."""
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY = "romanmodin/kilowallet-ios"
GATES = (
    ("KILOWALLET_IOS_RUN_ID", ".github/workflows/ios.yml",
     {"Tests, simulator build, screenshots", "Release build for device (unsigned)"}),
    ("KILOWALLET_SCREENSHOT_RUN_ID", ".github/workflows/screenshot-check.yml", {"verify"}),
)

NATIVE_JOB = "iPhone release and simulator qualification"
NATIVE_STEPS = (
    "Select supported Xcode",
    "Unit tests (JVM and iOS simulator)",
    "Check native tests actually ran on the Intel simulator",
    "Build the app for the iOS Simulator (no signing)",
    "Boot a simulator, launch the app and take screenshots",
    "Verify live native engine outcomes",
    "Build Release for iphoneos without signing",
)

def verify_native_steps(job):
    evidence = {}
    for name in NATIVE_STEPS:
        matches = [step for step in job["steps"] if step["name"] == name]
        if len(matches) != 1 or matches[0]["status"] != "completed" or matches[0]["conclusion"] != "success":
            raise RuntimeError("Missing or unsuccessful native step: " + name)
        evidence[name] = matches[0]["number"]
    return evidence

def validate(run, jobs, source, workflow, required):
    if any(run[k]["full_name"] != REPOSITORY for k in ("repository", "head_repository")):
        raise RuntimeError("Wrong Kilowallet repository")
    if run["head_sha"] != source or run["path"] != workflow:
        raise RuntimeError("Wrong Kilowallet source or workflow")
    if run["event"] not in ("pull_request", "workflow_dispatch", "push"):
        raise RuntimeError("Unexpected qualification event")
    if run["status"] != "completed" or run["conclusion"] != "success":
        raise RuntimeError("Kilowallet gate has not passed")
    found = {j["name"]: j for j in jobs}
    if len(found) != len(jobs) or not required.issubset(found):
        raise RuntimeError("Missing or ambiguous required jobs")
    for name in required:
        j = found[name]
        if j["status"] != "completed" or j["conclusion"] != "success":
            raise RuntimeError("Required native job did not pass")
        if j["run_attempt"] != run["run_attempt"]:
            raise RuntimeError("Stale qualification job attempt")
    return {"id":run["id"], "sourceCommit":source, "workflow":workflow,
            "runAttempt":run["run_attempt"], "url":run["html_url"],
            "jobs":{n:found[n]["id"] for n in sorted(required)}}

def api(path):
    return json.loads(subprocess.check_output(["gh","api",path], text=True))

def checkout_sha(log):
    # Use the actual checkout log, not the PR's reported head. PR runs normally test refs/pull/N/merge.
    lines=log.splitlines()
    matches=[]
    for i,line in enumerate(lines[:-1]):
        if re.fullmatch(r"\S+ \[command\](?:\S*/)?git log -1 --format=%H",line):
            match=re.fullmatch(r"\S+ ([0-9a-f]{40})",lines[i+1])
            if not match: raise RuntimeError("Malformed checkout receipt")
            matches.append(match[1])
    if len(matches)!=1: raise RuntimeError("Missing or ambiguous checkout receipt")
    return matches[0]

def verify_tree(source, source_tree, checked, commit, event):
    if not re.fullmatch(r"[0-9a-f]{40}",source_tree) or commit["sha"]!=checked or commit["tree"]["sha"]!=source_tree:
        raise RuntimeError("CI checkout does not match the source tree to sign")
    if checked!=source and not (event=="pull_request" and source in [p["sha"] for p in commit["parents"]]):
        raise RuntimeError("Unrelated CI checkout")
    return {"checkoutCommit":checked,"tree":source_tree}

def checked_trees(run,receipt,source):
    prefix=f"repos/{REPOSITORY}"
    source_tree=api(f"{prefix}/git/commits/{source}")["tree"]["sha"]
    result={}
    for name,job in receipt["jobs"].items():
        log=subprocess.check_output(["gh","api","--allow-escape-sequences",f"{prefix}/actions/jobs/{job}/logs"]).decode(errors="replace")
        checked=checkout_sha(log)
        result[name]=verify_tree(source,source_tree,checked,api(f"{prefix}/git/commits/{checked}"),run["event"])
    return result

def main():
    source = os.environ["KILOWALLET_SOURCE_COMMIT"]
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise RuntimeError("Full source commit required")
    receipts = []
    for variable, workflow, required in GATES:
        run_id = os.environ[variable]
        if not run_id.isdecimal(): raise RuntimeError("Invalid qualification run")
        run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
        jobs = api(f"repos/{REPOSITORY}/actions/runs/{run_id}/attempts/{run['run_attempt']}/jobs?per_page=100")["jobs"]
        combined = variable == "KILOWALLET_IOS_RUN_ID" and os.environ.get("KILOWALLET_MARKETING_VERSION","").startswith("1.")
        if combined:
            required = {NATIVE_JOB}
        receipt=validate(run, jobs, source, workflow, required)
        if combined:
            receipt["requiredSteps"] = verify_native_steps(next(job for job in jobs if job["name"] == NATIVE_JOB))
        if os.environ.get("KILOWALLET_MARKETING_VERSION","").startswith("1."):
            receipt["checkouts"]=checked_trees(run,receipt,source)
        receipts.append(receipt)
    result = {"repository":REPOSITORY, "sourceCommit":source,
              "verifiedAt":datetime.now(timezone.utc).isoformat(), "gates":receipts,
              "physicalPhoneQualified":False, "livePoolCompletionVerified":False}
    Path("kilowallet-source-gates.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))
if __name__ == "__main__": main()

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
        receipts.append(validate(run, jobs, source, workflow, required))
    result = {"repository":REPOSITORY, "sourceCommit":source,
              "verifiedAt":datetime.now(timezone.utc).isoformat(), "gates":receipts,
              "physicalPhoneQualified":False, "livePoolCompletionVerified":False}
    Path("kilowallet-source-gates.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))
if __name__ == "__main__": main()

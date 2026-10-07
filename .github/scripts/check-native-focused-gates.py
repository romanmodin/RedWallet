#!/usr/bin/env python3
"""Fail closed: final acceptance requires every focused native job on this source."""
import json
import subprocess
import sys

STAGES = ("recovery", "receive", "send", "rbf", "cpfp", "encryption", "delete")

def api(endpoint):
    return json.loads(subprocess.check_output(["gh", "api", endpoint], text=True))

def check(source):
    if len(source) != 40 or any(c not in "0123456789abcdef" for c in source):
        raise ValueError("A full source commit is required")
    missing = []
    for platform in ("android", "ios"):
        runs = api(f"repos/romanmodin/RedWallet/actions/workflows/native-live-lifecycle-{platform}.yml/runs?head_sha={source}&per_page=100")["workflow_runs"]
        passed = set()
        for run in runs:
            if run["head_sha"] != source or run["status"] != "completed":
                continue
            pages = subprocess.check_output(
                ["gh", "api", "--paginate", "--slurp", f"repos/romanmodin/RedWallet/actions/runs/{run['id']}/jobs?filter=latest&per_page=100"],
                text=True,
            )
            for page in json.loads(pages):
                for job in page["jobs"]:
                    if job["status"] == "completed" and job["conclusion"] == "success":
                        passed.add(job["name"])
        missing.extend(f"{platform}/{stage}" for stage in STAGES if f"Native {platform} ({stage})" not in passed)
    if missing:
        raise RuntimeError("Final acceptance blocked; missing successful exact-source focused jobs: " + ", ".join(missing))
    print("Both native platforms passed all seven focused stages on " + source)

if __name__ == "__main__":
    check(sys.argv[1])

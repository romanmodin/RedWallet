#!/usr/bin/env python3
"""Reject artifacts from forks, unexpected workflows, branches or commits."""
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def validate_source(source, mode, repository, branch, commit):
    workflow = {
        "release": ".github/workflows/build-ios-release-pullrequest.yml",
        "simulator": ".github/workflows/e2e-ios.yml",
    }[mode]
    assert source["repository"]["full_name"] == repository, "Wrong source repository"
    assert source.get("head_repository", {}).get("full_name") == repository, "Fork source is not allowed"
    assert source["path"] == workflow, "Wrong source workflow"
    assert source["status"] == "completed", "Source run must have completed"
    assert source["event"] in ("push", "workflow_dispatch"), "PR artifacts are not allowed"
    assert source["head_branch"] == branch, "Wrong source branch"
    assert re.fullmatch(r"[0-9a-f]{40}", source["head_sha"]), "Invalid source commit"
    if mode == "release":
        assert source["event"] == "workflow_dispatch", "Release must have been explicitly dispatched"
        assert source["conclusion"] == "success", "Source release must have succeeded"
        assert branch == "main" and source["head_sha"] == commit, "Source release must match the approved commit"
    return source["head_sha"]


def simulator_lightning_variant(jobs, required, created_at):
    def instant(timestamp):
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))

    created = instant(created_at)
    builds = [
        job for job in jobs if job["name"] == "build" and any(
            step["name"] == "Upload simulator app" and step["conclusion"] == "success"
            and instant(step["started_at"]) <= created <= instant(step["completed_at"])
            for step in job["steps"]
        )
    ]
    if len(builds) != 1 or builds[0]["conclusion"] != "success":
        raise ValueError("Expected one successful simulator build")
    steps = builds[0]["steps"]
    uploaded = [s["conclusion"] for s in steps if s["name"] == "Upload simulator app"]
    variant = [s["conclusion"] for s in steps if s["name"] == "Enable the iOS 16 Lightning regtest variant"]
    if uploaded != ["success"] or variant not in (["success"], ["skipped"]):
        raise ValueError("Simulator build lacks definitive variant or upload evidence; build a fresh artifact")
    if required and variant == ["skipped"]:
        raise ValueError("This branch requires a Lightning simulator artifact; build a fresh artifact")
    return variant[0]


def main():
    mode, run_id = sys.argv[1:]
    assert run_id.isdecimal(), "Source run must be numeric"
    repository = os.environ["GITHUB_REPOSITORY"]
    source = json.loads(subprocess.check_output(["gh", "api", f"repos/{repository}/actions/runs/{run_id}"]))
    commit = validate_source(source, mode, repository, os.environ["GITHUB_REF_NAME"], os.environ["GITHUB_SHA"])
    if mode == "simulator":
        endpoint = f"repos/{repository}/actions/runs/{run_id}"
        artifacts = json.loads(subprocess.check_output(["gh", "api", endpoint + "/artifacts?name=bluewallet-ios-app"]))
        eligible = [a for a in artifacts["artifacts"] if a["name"] == "bluewallet-ios-app" and not a["expired"]]
        if len(eligible) != 1:
            raise ValueError("Expected one available simulator artifact")
        artifact = eligible[0]
        if artifact["workflow_run"]["id"] != int(run_id) or artifact["workflow_run"]["head_sha"] != commit:
            raise ValueError("Simulator artifact source differs from the verified run")
        pages = json.loads(subprocess.check_output([
            "gh", "api", "--paginate", "--slurp", endpoint + "/jobs?filter=all&per_page=100",
        ]))
        jobs = [job for page in pages for job in page["jobs"]]
        variant = simulator_lightning_variant(jobs, os.environ.get("LIGHTNING_VARIANT_REQUIRED") == "true", artifact["created_at"])
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            print(f"lightning_variant={variant}", file=output)
            print(f"artifact_id={int(artifact['id'])}", file=output)
        Path("simulator-source.txt").write_text(commit + "\n")
    else:
        with open(os.environ["GITHUB_ENV"], "a") as output:
            output.write("LATEST_COMMIT_MESSAGE=Source commit: " + commit + "\n")
            output.write("BRANCH_NAME=" + source["head_branch"] + "\n")
    print("Verified source commit:", commit)


if __name__ == "__main__":
    main()

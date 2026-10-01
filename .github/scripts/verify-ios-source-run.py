#!/usr/bin/env python3
"""Reject artifacts from forks, unexpected workflows, branches or commits."""
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


def main():
    mode, run_id = sys.argv[1:]
    assert run_id.isdecimal(), "Source run must be numeric"
    repository = os.environ["GITHUB_REPOSITORY"]
    source = json.loads(subprocess.check_output(["gh", "api", f"repos/{repository}/actions/runs/{run_id}"]))
    commit = validate_source(source, mode, repository, os.environ["GITHUB_REF_NAME"], os.environ["GITHUB_SHA"])
    if mode == "simulator":
        Path("simulator-source.txt").write_text(commit + "\n")
    else:
        with open(os.environ["GITHUB_ENV"], "a") as output:
            output.write("LATEST_COMMIT_MESSAGE=Source commit: " + commit + "\n")
            output.write("BRANCH_NAME=" + source["head_branch"] + "\n")
    print("Verified source commit:", commit)


if __name__ == "__main__":
    main()

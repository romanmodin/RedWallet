"""Fetch only the exact RC6 screenshot artifact after its current-attempt run passes."""
import json
import os
import subprocess
import sys
from pathlib import Path
from verify_visual import ARTIFACT, ARTIFACT_SHA256, ATTEMPT, RUN, SOURCE

ROOT = Path(__file__).resolve().parent
REPO = "romanmodin/kilowallet-ios"

def api(path):
    return json.loads(subprocess.check_output(["gh", "api", f"repos/{REPO}/{path}"], text=True))

def validate_remote(run, artifact, receipt):
    assert run["id"] == RUN and run["run_attempt"] == ATTEMPT and run["head_sha"] == SOURCE
    assert run["repository"]["full_name"] == REPO and run["head_repository"]["full_name"] == REPO
    assert run["path"] == ".github/workflows/ios.yml" and run["event"] == "pull_request"
    assert run["status"] == "completed" and run["conclusion"] == "success"
    assert artifact["id"] == ARTIFACT == receipt["artifact"]["id"]
    assert artifact["name"] == "screenshots" and not artifact["expired"]
    assert artifact["digest"] == "sha256:" + ARTIFACT_SHA256 == "sha256:" + receipt["artifact"]["sha256"]
    assert artifact["workflow_run"]["id"] == RUN and artifact["workflow_run"]["head_sha"] == SOURCE
    assert receipt["sourceCommit"] == SOURCE and receipt["run"] == RUN and receipt["attempt"] == ATTEMPT
    return True

def main():
    assert os.environ["KILOWALLET_SOURCE_COMMIT"] == SOURCE
    receipt = json.loads((ROOT / "visual-receipt.json").read_text())
    run = api(f"actions/runs/{RUN}")
    artifact = api(f"actions/artifacts/{ARTIFACT}")
    validate_remote(run, artifact, receipt)
    root = Path("visual-evidence")
    root.mkdir(exist_ok=True)
    (root / "receipt.json").write_text(json.dumps(receipt))
    with (root / "evidence.zip").open("wb") as output:
        subprocess.run([
            "gh", "api", f"repos/{REPO}/actions/artifacts/{ARTIFACT}/zip",
            "--allow-escape-sequences",
        ], stdout=output, check=True)
    subprocess.run([
        sys.executable, str(ROOT / "verify_visual.py"), str(root),
        str(ROOT / "visual-review.json"), "kilowallet-visual-qualification.json",
    ], check=True)

if __name__ == "__main__":
    main()

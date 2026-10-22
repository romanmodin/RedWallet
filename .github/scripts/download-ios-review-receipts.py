#!/usr/bin/env python3
"""Download only pinned, successful, first-attempt release receipts."""
import hashlib
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path
REPO = "romanmodin/RedWallet"
SOURCE = "286e875cb488365eeb00799b6c04305994ab9db7"
EXPECTED = {
 "ios-ipa-verification.json": (".github/workflows/build-ios-approved-source.yml", "ios-ipa-verification"),
 "testflight-beta-verification.json": (".github/workflows/distribute-ios-beta.yml", "testflight-beta-verification"),
 "store-screenshot-receipt.json": (".github/workflows/upload-ios-store-screenshots.yml", "store-screenshot-receipt"),
 "imessage-upload-receipt.json": (".github/workflows/upload-ios-imessage-screenshots.yml", "imessage-upload-receipt"),
}
def api(path):
 return json.loads(subprocess.check_output(["gh", "api", f"repos/{REPO}/{path}"]))
def main():
 manifest = json.loads(Path(sys.argv[1]).read_text())
 assert manifest["sourceCommit"] == SOURCE
 receipts = manifest["receipts"]
 assert len(receipts) == 4 and {r["member"] for r in receipts} == set(EXPECTED)
 target = Path("submission-receipts"); target.mkdir(exist_ok=True)
 for receipt in receipts:
  workflow, name = EXPECTED[receipt["member"]]
  run = api(f"actions/runs/{receipt['runId']}")
  assert run["repository"]["full_name"] == REPO and run["head_repository"]["full_name"] == REPO
  assert run["head_sha"] == receipt["head"] and run["path"] == workflow
  assert run["event"] == "workflow_dispatch" and run["head_branch"] == "main" and run["run_attempt"] == 1
  assert run["status"] == "completed" and run["conclusion"] == "success"
  if receipt["member"] == "ios-ipa-verification.json":
   assert run["id"] == 39799087741 and run["head_sha"] == "b881585e528a9d06b20f67b28a774bd540f3fd20"
  artifact = api(f"actions/artifacts/{receipt['artifactId']}")
  assert not artifact["expired"] and artifact["workflow_run"]["id"] == run["id"] and artifact["name"] == name
  assert artifact["digest"] == "sha256:" + receipt["archiveSha256"]
  data = subprocess.check_output(["gh", "api", f"repos/{REPO}/actions/artifacts/{receipt['artifactId']}/zip"])
  assert hashlib.sha256(data).hexdigest() == receipt["archiveSha256"]
  archive = zipfile.ZipFile(io.BytesIO(data)); assert archive.namelist().count(receipt["member"]) == 1
  body = archive.read(receipt["member"]); assert hashlib.sha256(body).hexdigest() == receipt["sha256"]
  (target/receipt["member"]).write_bytes(body)
 print("PASS: four actual release receipt archives and members verified")
if __name__ == "__main__":
 main()

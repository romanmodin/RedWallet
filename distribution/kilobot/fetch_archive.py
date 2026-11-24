"""Authenticate the unsigned device archive from the pinned publisher workflow."""
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

REPO = "romanmodin/kilowallet-ios"
RUN = 45475792490
COMMIT = "b6277dd26e163183e4c45378ca832f77d32d7dc7"
WORKFLOW = ".github/workflows/kilobot-testflight-archive.yml"
NAME = "Kilobot-QA-unsigned-device-archive"
ARCHIVE = "KilobotQA.xcarchive.zip"


def github(path):
    return json.loads(subprocess.check_output(["gh", "api", f"repos/{REPO}/{path}"]))


def artifact(run, listing):
    if (run["id"] != RUN or run["head_sha"] != COMMIT or run["run_attempt"] != 1
            or run["repository"]["full_name"] != REPO or run["head_repository"]["full_name"] != REPO
            or run["event"] != "push" or run["path"] != WORKFLOW
            or run["status"] != "completed" or run["conclusion"] != "success"):
        raise ValueError("Publisher archive run has not passed with the expected source")
    matches = [a for a in listing["artifacts"] if a["name"] == NAME]
    if len(matches) != 1 or len(listing["artifacts"]) != listing["total_count"]:
        raise ValueError("Expected one matching archive in the complete artifact list")
    item = matches[0]
    if (item["expired"] or item["workflow_run"]["id"] != RUN
            or item["workflow_run"]["head_sha"] != COMMIT or not isinstance(item["id"], int)
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", item["digest"])):
        raise ValueError("Invalid publisher artifact")
    return item


def digest(path):
    with path.open("rb") as stream:
        h = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def checked_members(data):
    for member in data.infolist():
        path = PurePosixPath(member.filename)
        if (path.is_absolute() or ".." in path.parts or "\\" in member.filename
                or not path.parts or path.parts[0] not in {"KilobotQA.xcarchive", "__MACOSX"}
                or stat.S_ISLNK(member.external_attr >> 16)):
            raise ValueError("Unexpected archive path or symbolic link")


def main():
    record = artifact(github(f"actions/runs/{RUN}"), github(f"actions/runs/{RUN}/artifacts"))
    root = Path(os.environ["RUNNER_TEMP"])
    outer = root / "publisher-artifact.zip"
    inner = root / ARCHIVE
    with outer.open("wb") as stream:
        subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts/{record['id']}/zip"],
                       stdout=stream, check=True)
    if "sha256:" + digest(outer) != record["digest"]:
        raise ValueError("GitHub artifact checksum mismatch")
    with zipfile.ZipFile(outer) as payload:
        if sorted(payload.namelist()) != sorted(["SHA256SUMS", ARCHIVE]):
            raise ValueError("Unexpected publisher artifact contents")
        checksum = payload.read("SHA256SUMS").decode("ascii").strip().split()
        with payload.open(ARCHIVE) as source, inner.open("wb") as output:
            shutil.copyfileobj(source, output)
    observed = digest(inner)
    if checksum != [observed, ARCHIVE]:
        raise ValueError("Archive checksum mismatch")
    with zipfile.ZipFile(inner) as data:
        checked_members(data)
    subprocess.run(["ditto", "-x", "-k", str(inner), str(root)], check=True)
    print(f"Verified publisher run {RUN}, artifact {record['id']}, archive SHA-256 {observed}")


if __name__ == "__main__":
    main()

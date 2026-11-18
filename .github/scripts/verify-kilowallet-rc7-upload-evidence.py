"""Verify the immutable RC7 upload whose processing poll timed out.

This read-only evidence stage does NOT qualify Apple processing or distribution.
The normal upload qualifier remains unchanged until a protected Apple receipt
can be bound to this evidence. Never rerun signing to recover a polling timeout.
"""
import hashlib
import io
import json
import subprocess
import zipfile
from pathlib import Path

REPO = "romanmodin/RedWallet"
RUN = 44199784070
HEAD = "130487709c507d4635b32274047911f3e864b8a8"
SOURCE = "3f5beee29cfbbd257a5d967f6d2e505bfec4c1b3"
IPA = "c9a14033af78ee52cb955ec9dfaf55694d999340035acd5f00480ef0859d47ad"
ARTIFACT = 14386469136
ZIP_SHA = "359452ec3d20301d59252e65048939d0aa8f37fb97331f086dab89e7931e138e"
JOBS = {"verify": 134450612400, "qualify": 134450683448,
        "preflight": 134450884926, "certificate": 134451156528,
        "sign": 134456057469}
MEMBERS = {
    "kilowallet-source-gates.json": "a88ac830cd9e0fcf579d8afebb04faef92095f92769517c0dad25a775a1e2826",
    "kilowallet-archive-verification.json": "b246b5ca46cb436ed106e5bc5dd7726f5240f7975c6f394753ca0f8d10c5f663",
    "kilowallet-visual-qualification.json": "fe9724fe5319df8782e5f540ec0e6e4a14e8b69a5896259a3705d83a25456e2b",
    "kilowallet-package-verification.json": "ba8c27e272f03b325be78b4cd39d94caf85412ac008c0cb98c32b546b3b658ab",
    "kilowallet-territory-preflight.json": "e0eaf90a4904e0e3e2d5f68a7849f25a594fd360fc1178a7eb051a9824f83caa",
    "kilowallet-build-preflight-before-upload.json": "1f468c827f1165e3328f47247065f6dc611d0c12b5e26a8fca3091c793615ad8",
}
REQUIRED_STEPS = {
    6: "Check pinned app source",
    14: "Archive pinned Kilowallet source",
    15: "Verify archive and export package",
    16: "Preserve encrypted verified package",
    18: "Verify US-only availability immediately before 1.0 upload",
    19: "Recheck unused Apple build number immediately before upload",
    20: "Upload Kilowallet to TestFlight",
    21: "Verify Apple processing",
    22: "Save verified source, package and Apple processing receipts",
    23: "Clean up temporary credentials",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def validate_attempt(run, jobs):
    require(all(run[k]["full_name"] == REPO for k in ("repository", "head_repository")), "Wrong repository")
    require(run["id"] == RUN and run["head_sha"] == HEAD and run["head_branch"] == "main", "Wrong upload source")
    require(run["event"] == "workflow_dispatch" and run["path"] == ".github/workflows/build-kilowallet.yml", "Wrong upload workflow")
    require(run["status"] == "completed" and run["conclusion"] == "failure" and run["run_attempt"] == 1, "Original failed attempt changed")
    require(len(jobs) == len(JOBS) and {j["name"] for j in jobs} == set(JOBS), "Ambiguous upload jobs")
    for job in jobs:
        require(job["id"] == JOBS[job["name"]] and job["run_id"] == RUN and job["head_sha"] == HEAD and job["run_attempt"] == 1, "Wrong job provenance")
        expected = "failure" if job["name"] == "sign" else "success"
        require(job["status"] == "completed" and job["conclusion"] == expected, "Unexpected upload job result")
    sign = next(j for j in jobs if j["name"] == "sign")
    steps = sign["steps"]
    require(len(steps) == len({s["number"] for s in steps}), "Duplicate step numbers")
    require({s["number"] for s in steps} == set(range(1, 24)) | {44, 45, 46, 47}, "Missing or unexpected sign steps")
    for step in steps:
        number = step["number"]
        if number in REQUIRED_STEPS:
            require(step["name"] == REQUIRED_STEPS[number], "Required step identity changed")
        require(step["status"] == "completed" and step["conclusion"] == ("failure" if number == 21 else "success"), "Failure outside processing poll")
    return {"jobId": sign["id"], "failedStep": REQUIRED_STEPS[21], "uploadStep": REQUIRED_STEPS[20]}


def validate_archive(meta, raw):
    require(meta["id"] == ARTIFACT and meta["name"] == "kilowallet-release-verification" and meta["expired"] is False, "Wrong or expired artifact")
    require(meta["workflow_run"]["id"] == RUN and meta["workflow_run"]["head_sha"] == HEAD, "Wrong artifact provenance")
    require(meta["digest"] == "sha256:" + ZIP_SHA and hashlib.sha256(raw).hexdigest() == ZIP_SHA, "Artifact digest mismatch")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(archive.testzip() is None, "ZIP CRC failure")
        require(len(archive.namelist()) == len(MEMBERS) and set(archive.namelist()) == set(MEMBERS), "Unexpected receipt members")
        result = {}
        for name, expected in MEMBERS.items():
            data = archive.read(name)
            require(hashlib.sha256(data).hexdigest() == expected, "Receipt digest mismatch")
            result[name] = json.loads(data)
    return result


def summarize(receipts, attempt):
    package = receipts["kilowallet-package-verification.json"]
    require(package["sourceCommit"] == SOURCE and package["orchestrationCommit"] == HEAD and package["ipaSha256"] == IPA, "Wrong signed package")
    require(package["runId"] == str(RUN) and package["runAttempt"] == "1" and package["version"] == "1.0.0" and package["build"] == "30", "Wrong package version/attempt")
    require(package["bundle"] == "com.kilombino.kilowallet" and package["team"] == "PPG9C98EY9" and package["signature"] == "verified", "Wrong signature identity")
    require(package["sdk"] == "iphoneos26.2" and package["usesNonExemptEncryption"] is False, "Unsupported package flags")
    return {"originalUploadEvidenceVerified": True, "originalRunConclusion": "failure",
            "processingVerified": False, "testerMembershipVerified": False,
            "currentNativeGatesVerified": False, "readyForDistribution": False,
            "app": "6824331953", "marketingVersion": "1.0.0", "build": "30",
            "sourceCommit": SOURCE, "orchestrationCommit": HEAD, "ipaSha256": IPA,
            "runId": RUN, "runAttempt": 1, "artifactId": ARTIFACT,
            "artifactSha256": ZIP_SHA, "receiptSha256": MEMBERS, "attemptEvidence": attempt,
            "nextRequiredEvidence": "Protected Apple VALID receipt for exact app/version/build, current native gates and exact intended beta-group membership",
            "mode": "GET-only", "writes": []}


def api(path, raw=False):
    data = subprocess.check_output(["gh", "api", path] + (["--allow-escape-sequences"] if raw else []))
    return data if raw else json.loads(data)


def main():
    run = api(f"repos/{REPO}/actions/runs/{RUN}")
    page = api(f"repos/{REPO}/actions/runs/{RUN}/attempts/1/jobs?per_page=100")
    require(page["total_count"] == len(page["jobs"]), "Incomplete job listing")
    attempt = validate_attempt(run, page["jobs"])
    meta = api(f"repos/{REPO}/actions/artifacts/{ARTIFACT}")
    receipts = validate_archive(meta, api(f"repos/{REPO}/actions/artifacts/{ARTIFACT}/zip", True))
    result = summarize(receipts, attempt)
    Path("kilowallet-rc7-original-upload-evidence.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

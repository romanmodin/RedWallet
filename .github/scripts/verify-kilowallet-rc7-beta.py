"""Qualify build 30 for the beta planner from its original upload + a protected ASC read.
The public release keeps its separate build and review evidence.
"""
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location("original_rc7", HERE / "verify-kilowallet-rc7-upload-evidence.py")
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
require = original.require
APP = "6824331953"
BUNDLE = "com.kilombino.kilowallet"
TREE = "212a9bc56aa9cbd93aed819fccf311a637c620c7"
NATIVE = 44063853758
SCREEN = 44111397016
# The protected inspector on main must run these reviewed Git blobs.
INSPECTOR = {
    ".github/workflows/kilowallet-preflight.yml": "15694936faf69f12f6256eb560dbb2c6b07127ca",
    ".github/scripts/inspect-kilowallet-store.mjs": "4e9ad110e0683d08c6dec43e4bc02aaa64e96688",
    ".github/scripts/inspect-ios-store.mjs": "54256157fc58c676681ca440d41569876f65bd21",
}
READ_STEP = "Read independent Kilowallet Apple facts without changes"
CHECKOUT = "Run actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10"
SAVE = "Run actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"
AFTER_UPLOAD = datetime.fromisoformat("2026-11-18T01:08:41+00:00")
PUBLIC_ONLY = {"publicReview"}  # unrelated listing may lack access; never excuse a beta/identity error.

def stamp(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(result.tzinfo is not None, "Unzoned timestamp")
    return result

def inspector_provenance(run_id, run, jobs, blobs):
    require(type(run_id) is int and 0 < run_id == run["id"], "Wrong inspection run")
    require(all(run[k]["full_name"] == original.REPO for k in ("repository", "head_repository")), "Unexpected inspecting repository")
    require(run["head_branch"] == "main" and re.fullmatch("[0-9a-f]{40}", run["head_sha"]), "Unexpected inspecting branch")
    require(run["event"] == "workflow_dispatch" and run["path"] == ".github/workflows/kilowallet-preflight.yml", "Unexpected inspecting workflow")
    require(run["status"] == "completed" and run["conclusion"] in ("success", "failure") and run["run_attempt"] == 1, "Nonterminal or replayed inspection")
    require(blobs == INSPECTOR, "Unrecognized inspector implementation")
    require(len(jobs) == 2 and {j["name"] for j in jobs} == {"verify", "inspect"}, "Missing or ambiguous inspection jobs")
    verify, inspect = [next(j for j in jobs if j["name"] == n) for n in ("verify", "inspect")]
    for j in jobs:
        require(j["run_id"] == run_id and j["head_sha"] == run["head_sha"] and j["run_attempt"] == 1 and j["status"] == "completed", "Wrong inspection job")
    require(verify["conclusion"] == "success" and inspect["conclusion"] == run["conclusion"], "Unverified inspector")
    steps = {s["number"]: s for s in inspect["steps"]}
    require(len(steps) == len(inspect["steps"]) and steps[2]["name"] == CHECKOUT and steps[4]["name"] == READ_STEP and steps[5]["name"] == SAVE, "Unexpected inspection steps")
    for n, step in steps.items():
        outcomes = {run["conclusion"]} if n == 4 else {"success"}
        if n > 5 and step["name"].startswith("Post Run ") and run["conclusion"] == "failure":
            outcomes.add("skipped")
        require(step["status"] == "completed" and step["conclusion"] in outcomes, "Unexpected inspection step outcome")
    return steps[4]

def unpack(meta, raw, run):
    require(type(meta["id"]) is int and meta["id"] > 0 and meta["name"] == "kilowallet-apple-preflight" and meta["expired"] is False, "Wrong/expired inspection archive")
    require(meta["workflow_run"]["id"] == run["id"] and meta["workflow_run"]["head_sha"] == run["head_sha"], "Foreign inspection archive")
    require(len(raw) <= 2_000_000 and meta["digest"] == "sha256:" + hashlib.sha256(raw).hexdigest(), "Inspection archive digest or size mismatch")
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        require(z.namelist() == ["kilowallet-apple-preflight.json"] and z.infolist()[0].file_size <= 4_000_000, "Unexpected inspection archive members")
        data = z.read(z.infolist()[0])  # zipfile checks the member CRC.
    return json.loads(data), hashlib.sha256(data).hexdigest()

def valid_apple(report, step):
    require(report["mode"] == "read-only" and report.get("writes", []) == [] and not report.get("failure") and report.get("appId") == APP, "Missing read-only app identity")
    require(report.get("app") == {"id": APP, "bundleId": BUNDLE}, "Wrong ASC app")
    errors = report["errors"]
    require(isinstance(errors, list) and all(e.get("resource") in PUBLIC_ONLY and e.get("kind") == "HTTPError" and e.get("httpStatus") in (401,403) for e in errors), "Incomplete beta or unexpected inspector error")
    require(report["inspectionComplete"] is (not errors) and (step["conclusion"] == "success") == (not errors), "Inspection outcome mismatch")
    observed = stamp(report["observedAt"])
    require(AFTER_UPLOAD <= observed and stamp(step["started_at"]) - timedelta(seconds=1) <= observed <= stamp(step["completed_at"]) + timedelta(seconds=1), "Observation outside protected Apple read")
    b = report["rc7Processing"]
    require(b["found"] is True and b["expired"] is False and b["usesNonExemptEncryption"] is False and b["testerMembershipVerified"] is False, "Expired, unobserved, or unexpected RC7 flags")
    require((b["build"], b["version"], b["platform"], b["processingState"]) == ("30", "1.0.0", "IOS", "VALID"), "Build 30 is not VALID")
    uid = UUID(b["id"])
    require(str(uid) == b["id"] and uid.int != 0, "Invalid Apple build identity")
    return b["id"]

def bind_archive(package, archive):
    # Export signs a different Mach-O. Pin both original executable digests, then compare the shared identities.
    require(archive["executableSha256"] == "7a2ea330877f32425611b4f2752236d1889243a1e039097cb973c1f5f73a00bf", "Wrong archive executable")
    require(package["executableSha256"] == "31c476027a21ca4bb4a366dc797fb90330e981caaa90c4e27da356cc0bde8450" and package["ipaSha256"] == original.IPA, "Wrong exported executable or IPA")
    require({k:v for k,v in package.items() if k not in ("ipaSha256","executableSha256")} ==
            {k:v for k,v in archive.items() if k != "executableSha256"}, "Signed package/archive identity mismatch")

def original_candidate(receipts, fresh):
    package = receipts["kilowallet-package-verification.json"]
    archive = receipts["kilowallet-archive-verification.json"]
    bind_archive(package, archive)
    gates = receipts["kilowallet-source-gates.json"]
    require(package["qualification"] == gates and fresh["sourceCommit"] == original.SOURCE and fresh["repository"] == "romanmodin/kilowallet-ios", "Mismatched signed source qualification")
    require(fresh["gates"] == gates["gates"] and [g["id"] for g in fresh["gates"]] == [NATIVE, SCREEN], "Stale native gates")
    for g in fresh["gates"]:
        require(bool(g["jobs"]) and set(g["checkouts"]) == set(g["jobs"]) and all(v["tree"] == TREE for v in g["checkouts"].values()), "Wrong checkout tree")
    v = receipts["kilowallet-visual-qualification.json"]
    manual = json.loads((ROOT / "distribution/kilowallet/rc7-visual-review.json").read_bytes())
    manual_sha = hashlib.sha256((ROOT / "distribution/kilowallet/rc7-visual-review.json").read_bytes()).hexdigest()
    require(v["sourceCommit"] == original.SOURCE and v["visualEvidenceQualified"] is True and v["manualReviewSha256"] == manual_sha and v["syntheticOnly"] is True and v["realTransaction"] is False, "Wrong visual evidence")
    require(v["evidence"]["native"]["id"] == NATIVE and v["evidence"]["native"]["jobs"] == fresh["gates"][0]["jobs"], "Wrong native rendering run")
    effective = {n:h for item in manual["evidence"].values() for n,h in item["imageHashes"].items() if n not in item["excludedImages"]}
    require(len(effective) == 79 and v["imageHashes"] == effective, "Wrong reviewed screenshot set")
    t = receipts["kilowallet-territory-preflight.json"]
    require(t["mode"] == "GET-only" and t["territories"] == ["USA"] and t["availableInNewTerritories"] is False and t["app"] == APP and t["bundle"] == BUNDLE, "Wrong upload territory")
    require(all(t[k] == package[k] for k in ("sourceCommit","runId","runAttempt","ipaSha256")), "Territory receipt for another package")
    before = receipts["kilowallet-build-preflight-before-upload.json"]
    require(before["duplicateAbsent"] is True and before["readOnly"] is True and before["writes"] == [] and before["proposedBuild"] == "30" and before["app"] == APP and before["phase"] == "before-upload", "Missing duplicate check")
    return package

def main():
    ref = os.environ.get("KILOWALLET_PREFLIGHT_RUN", "")
    require(bool(re.fullmatch("[1-9][0-9]{0,16}", ref)), "An exact protected build-30 inspection run ID is required")
    prefix = "repos/" + original.REPO
    run = original.api(f"{prefix}/actions/runs/{ref}")
    page = original.api(f"{prefix}/actions/runs/{ref}/attempts/1/jobs?per_page=100")
    require(page["total_count"] == len(page["jobs"]), "Truncated inspection jobs")
    head = run["head_sha"]
    require(bool(re.fullmatch("[0-9a-f]{40}", head)), "Unexpected inspector commit")
    blobs = {p:original.api(f"{prefix}/contents/{p}?ref={head}")["sha"] for p in INSPECTOR}
    step = inspector_provenance(int(ref), run, page["jobs"], blobs)
    artifacts = original.api(f"{prefix}/actions/runs/{ref}/artifacts?per_page=100")
    require(artifacts["total_count"] == len(artifacts["artifacts"]) == 1, "Missing or ambiguous inspection artifact")
    artifact = artifacts["artifacts"][0]
    report, member_sha = unpack(artifact, original.api(f"{prefix}/actions/artifacts/{artifact['id']}/zip", True), run)
    build_id = valid_apple(report, step)
    receipts, evidence = original.verified_original()
    env = {**os.environ, "KILOWALLET_MARKETING_VERSION":"1.0.0", "KILOWALLET_SOURCE_COMMIT":original.SOURCE, "KILOWALLET_IOS_RUN_ID":str(NATIVE), "KILOWALLET_SCREENSHOT_RUN_ID":str(SCREEN)}
    subprocess.run([sys.executable, "-I", str(ROOT / "distribution/kilowallet/verify_gates.py")], env=env, check=True)
    package = original_candidate(receipts, json.loads(Path("kilowallet-source-gates.json").read_bytes()))
    result = {"uploadVerified":True, "currentNativeGatesVerified":True, "app":APP, "appleBuildId":build_id,
              "sourceCommit":original.SOURCE,"ipaSha256":original.IPA,"runId":original.RUN,"runAttempt":1,
              "marketingVersion":"1.0.0","build":"30","signature":package["signature"],"usesNonExemptEncryption":False,
              "artifactId":original.ARTIFACT,"artifactSha256":original.ZIP_SHA,"originalRunConclusion":evidence["originalRunConclusion"],
              "testerMembershipVerified":False,"inspection":{"run":int(ref),"attempt":1,"head":head,"artifact":artifact["id"],"digest":artifact["digest"],"memberSha256":member_sha,"observedAt":report["observedAt"]}}
    Path("kilowallet-upload-qualification.json").write_text(json.dumps(result,indent=2)+"\n")
    print(f"Qualified signed build 30 / {build_id}; membership must be verified live.")

if __name__ == "__main__":
    main()

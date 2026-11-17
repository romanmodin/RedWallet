"""Bind RC7 visual review to exact native and diagnostic CI artifacts.

Diagnostics supplement visual coverage only; verify_gates still independently
requires the full native run on the production candidate.
"""
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import zipfile
from pathlib import Path

from verify_gates import REPOSITORY, api, checked_trees, validate
from verify_visual import duplicate_groups

SOURCE = "3f5beee29cfbbd257a5d967f6d2e505bfec4c1b3"
PINS = {
    "native": (44063853758, SOURCE, "pull_request", "iPhone release and simulator qualification", 76),
    "startup": (44103548176, "7f14ab021e9a3d1accdd65a44271f10010c4b184", "workflow_dispatch", "Diagnostic only - RC7 Lightning startup frame", 1),
    "rpc": (44109729393, "abd873ede80efe3382126ca321975157dd61f5db", "workflow_dispatch", "Diagnostic only - RC7 RPC visual coverage", 3),
}
KNOWN_ARTIFACTS = {
    "native": (14331456008, "c6bc49414ae774aa3edde7abe688d1e7c2586a42b6e1cf7ae61409110b88743b"),
    "startup": (14338834239, "756183fa66804c5905856c3b991eaaeab3241b4c00b49e52d3f12ee9fb98bbcd"),
}
RPC_IMAGES = {"77-rpc-settings.png", "78-rpc-cert.png", "79-rpc-error.png"}
BASE_DUPLICATES = {frozenset({"22-pool-create.png", "68-pool-create-v6.png"})}
EXCLUDED = {"native": ["09-ln-starting.png"], "startup": [], "rpc": []}
PRODUCT_ROOTS = {"app", "core", "iosApp", "lnd-engine", "ark-engine", "tor-engine"}


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def validate_manifest(manual):
    require(manual.get("sourceCommit") == SOURCE, "Wrong production candidate")
    require(manual.get("approvedForSigning") is True, "RC7 visual review is incomplete")
    require(manual.get("blockers") == [], "Unresolved visual blockers")
    require(manual.get("syntheticOnly") is True and manual.get("realTransaction") is False,
            "Only synthetic visual evidence is accepted")
    require(manual.get("physicalPhoneQualified") is False, "Device qualification is not established")
    evidence = manual.get("evidence", {})
    require(set(evidence) == set(PINS), "Missing or unexpected visual evidence")
    for role, (run, source, event, job, count) in PINS.items():
        item = evidence[role]
        require((item.get("run"), item.get("sourceCommit"), item.get("event"), item.get("attempt")) ==
                (run, source, event, 1), "Wrong visual run/source/attempt: " + role)
        require(isinstance(item.get("jobName"), str) and bool(item["jobName"]), "Missing visual job")
        require(job is None or item["jobName"] == job, "Wrong visual job")
        require(item.get("reviewed") is True and item.get("glyphsComplete") is True and
                item.get("layoutOrClippingBlockers") == [], "Unreviewed visual evidence: " + role)
        require(isinstance(item.get("reviewedAt"), str) and bool(item["reviewedAt"]), "Missing review time")
        require(isinstance(item.get("notes"), str) and bool(item["notes"]), "Missing review notes")
        require(item.get("excludedImages") == EXCLUDED[role], "Unexpected visual exclusion")
        require(type(item.get("artifactId")) is int and item["artifactId"] > 0, "Missing artifact ID")
        require(re.fullmatch(r"[0-9a-f]{64}", item.get("artifactSha256", "") or ""), "Missing artifact digest")
        if role in KNOWN_ARTIFACTS:
            require((item["artifactId"], item["artifactSha256"]) == KNOWN_ARTIFACTS[role], "Wrong pinned artifact")
        hashes = item.get("imageHashes", {})
        require(len(hashes) == count and list(hashes) == sorted(hashes), "Wrong screenshot count/order")
        require(all(re.fullmatch(r"[0-9a-f]{64}", v) for v in hashes.values()), "Invalid image hash")
        require(all(re.fullmatch(r"[0-9]{2}-[a-z0-9-]+\.png", n) for n in hashes), "Unsafe screenshot name")
        if role == "startup":
            require(set(hashes) == {"09-ln-starting.png"}, "Missing startup replacement")
        elif role == "rpc":
            require(set(hashes) == RPC_IMAGES, "Missing RPC visual states")
        else:
            require("09-ln-starting.png" in hashes, "Missing original startup frame")
        require(duplicate_groups(hashes) == (BASE_DUPLICATES if role == "native" else set()), "Unexpected duplicate images")
    require(evidence["native"]["imageHashes"]["09-ln-starting.png"] !=
            evidence["startup"]["imageHashes"]["09-ln-starting.png"], "Rejected startup frame reused")
    require(manual.get("diagnosticLimitations") ==
            "Startup uses unchanged product trees; RPC uses reviewed synthetic fixture changes. Neither diagnostic replaces native production qualification or proves device RPC connectivity.",
            "Missing diagnostic attribution")
    return evidence


def validate_product_trees(candidate, startup, rpc):
    for trees in (candidate, startup, rpc):
        require(set(trees) == PRODUCT_ROOTS, "Missing product tree evidence")
        require(all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in trees.values()), "Invalid product tree")
    require(candidate == startup, "Startup diagnostic changed product code")
    require(all(candidate[name] == rpc[name] for name in PRODUCT_ROOTS - {"app"}),
            "RPC diagnostic changed native code, core or engines")
    return True


def product_trees(source):
    prefix = f"repos/{REPOSITORY}"
    tree = api(f"{prefix}/git/commits/{source}")["tree"]["sha"]
    entries = api(f"{prefix}/git/trees/{tree}")
    require(entries.get("truncated") is False, "Truncated product tree")
    return {entry["path"]: entry["sha"] for entry in entries["tree"]
            if entry["path"] in PRODUCT_ROOTS and entry["type"] == "tree"}


def validate_remote(run, artifact, item):
    require(run["id"] == item["run"] and run["run_attempt"] == item["attempt"], "Stale visual attempt")
    require(run["event"] == item["event"], "Wrong visual event")
    require(artifact["id"] == item["artifactId"] and artifact["name"] == "screenshots" and
            artifact["expired"] is False, "Wrong/expired visual artifact")
    require(artifact["digest"] == "sha256:" + item["artifactSha256"], "Artifact API digest mismatch")
    require(artifact["workflow_run"]["id"] == item["run"] and
            artifact["workflow_run"]["head_sha"] == item["sourceCommit"], "Artifact source mismatch")


def verify_archive(data, item):
    require(hashlib.sha256(data).hexdigest() == item["artifactSha256"], "Downloaded ZIP digest mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and archive.testzip() is None, "Invalid/ambiguous ZIP")
        require(set(names) == set(item["imageHashes"]), "Unexpected or missing screenshot")
        actual = {}
        for name in sorted(names):
            image = archive.read(name)
            require(len(image) >= 24 and image[:8] == b"\x89PNG\r\n\x1a\n" and image[12:16] == b"IHDR",
                    "Invalid PNG header")
            require(struct.unpack(">II", image[16:24]) == (1290, 2796), "Wrong screenshot dimensions")
            actual[name] = hashlib.sha256(image).hexdigest()
    require(actual == item["imageHashes"], "Screenshot pixels do not match review")
    return actual


def verify_bundle(manual, archives):
    evidence = validate_manifest(manual)
    require(set(archives) == set(evidence), "Missing downloaded visual artifacts")
    effective = {}
    for role in PINS:
        item = evidence[role]
        for name, digest in verify_archive(archives[role], item).items():
            if name not in item["excludedImages"]:
                require(name not in effective, "Ambiguous effective visual evidence")
                effective[name] = digest
    require(len(effective) == 79 and RPC_IMAGES.issubset(effective) and "09-ln-starting.png" in effective,
            "Incomplete effective visual coverage")
    require(duplicate_groups(effective) == BASE_DUPLICATES, "Unexpected cross-artifact duplicates")
    return effective


def main():
    require(os.environ["KILOWALLET_SOURCE_COMMIT"] == SOURCE, "Wrong signing source")
    manual = json.loads(Path(__file__).with_name("rc7-visual-review.json").read_text())
    evidence = validate_manifest(manual)  # Fail before downloads when review is incomplete.
    provenance = {role: product_trees(item["sourceCommit"]) for role, item in evidence.items()}
    validate_product_trees(provenance["native"], provenance["startup"], provenance["rpc"])
    root = Path("rc7-visual-evidence")
    root.mkdir(exist_ok=True)
    archives, receipts = {}, {}
    for role, item in evidence.items():
        prefix = f"repos/{REPOSITORY}"
        run = api(f"{prefix}/actions/runs/{item['run']}")
        jobs = api(f"{prefix}/actions/runs/{item['run']}/attempts/{item['attempt']}/jobs?per_page=100")["jobs"]
        receipt = validate(run, jobs, item["sourceCommit"], ".github/workflows/ios.yml", {item["jobName"]})
        artifact = api(f"{prefix}/actions/artifacts/{item['artifactId']}")
        validate_remote(run, artifact, item)
        receipt["checkouts"] = checked_trees(run, receipt, item["sourceCommit"])
        path = root / (role + ".zip")
        with path.open("wb") as output:
            subprocess.run(["gh", "api", "--allow-escape-sequences",
                            f"{prefix}/actions/artifacts/{item['artifactId']}/zip"], stdout=output, check=True)
        archives[role] = path.read_bytes()
        receipt.update(artifactId=item["artifactId"], artifactSha256=item["artifactSha256"])
        receipts[role] = receipt
    effective = verify_bundle(manual, archives)
    result = dict(sourceCommit=SOURCE, visualEvidenceQualified=True,
                  imageHashes=dict(sorted(effective.items())), evidence=receipts,
                  manualReviewSha256=hashlib.sha256(Path(__file__).with_name("rc7-visual-review.json").read_bytes()).hexdigest(),
                  syntheticOnly=True, realTransaction=False, physicalPhoneQualified=False,
                  mixedSourceDiagnostics=True, productTrees=provenance,
                  diagnosticLimitations=manual["diagnosticLimitations"])
    Path("kilowallet-visual-qualification.json").write_text(json.dumps(result, indent=2) + "\n")
    print("RC7 native and supplemental visual artifacts verified; 79 effective images.")


if __name__ == "__main__":
    main()

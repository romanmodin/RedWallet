#!/usr/bin/env python3
"""Bind an independently verified upload package to its original signing run."""
import json
import os
from pathlib import Path
import re
import sys


def link_receipts(signed, package, signing_run, upload_run, source, orchestration):
    if not all(re.fullmatch(r"[1-9][0-9]*", run) for run in (signing_run, upload_run)):
        raise ValueError("Expected numeric signing and upload run IDs")
    if signed["sourceRunId"] != signing_run:
        raise ValueError("Signing receipt is from a different run")
    if package["sourceCommit"] != source or package["orchestrationCommit"] != orchestration:
        raise ValueError("Upload receipt is from a different release")
    if package["signatureVerification"] != "passed" or package["sourceMappingVerification"] != "passed":
        raise ValueError("The uploaded package must pass signature and source verification")
    if not re.fullmatch(r"[0-9a-f]{64}", package["ipaSha256"]):
        raise ValueError("Missing or invalid IPA digest")

    for key in ("ipaSha256", "bundles", "sourceCommit", "publicSourceCommit", "orchestrationCommit",
                "productionTreeSha256", "productionPathCount", "signatureVerification", "sourceMappingVerification"):
        if signed[key] != package[key]:
            raise ValueError(f"Signing and upload receipts disagree on {key}")
    if signed.get("lightningNetwork") != package.get("lightningNetwork"):
        raise ValueError("Signing and upload receipts disagree on the Lightning network")
    # Signing and upload verify the gates independently at different times.
    first, second = signed["qualification"], package["qualification"]
    if first["sourceCommit"] != source or second["sourceCommit"] != source or not second["gates"] or first["gates"] != second["gates"]:
        raise ValueError("Signing and upload must qualify the same source and gate attempts")
    return {**package, "sourceRunId": signing_run, "uploadRunId": upload_run}


if __name__ == "__main__":
    signed_path, upload_path = map(Path, sys.argv[1:])
    linked = link_receipts(
        json.loads(signed_path.read_text()), json.loads(upload_path.read_text()),
        os.environ["SIGNING_RUN_ID"], os.environ["GITHUB_RUN_ID"],
        os.environ["SOURCE_COMMIT"], os.environ["GITHUB_SHA"],
    )
    upload_path.write_text(json.dumps(linked, indent=2) + "\n")

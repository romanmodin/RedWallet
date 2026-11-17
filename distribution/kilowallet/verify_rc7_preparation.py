"""Readiness interlock; native and visual receipt verification still run separately."""
import hashlib
import json
import os
from pathlib import Path

SOURCE = "3f5beee29cfbbd257a5d967f6d2e505bfec4c1b3"
IOS_RUN = 44063853758
SCREEN_RUN = 44111397016
RPC_RUN = 44125897581
RPC_SOURCE = "c13760f8136358cc372d873b31f24246c15484e2"

def validate(preparation, source, ios_run, screen_run):
    if source != SOURCE or str(ios_run) != str(IOS_RUN) or str(screen_run) != str(SCREEN_RUN):
        raise RuntimeError("RC7 preparation does not match workflow pins")
    if preparation.get("candidateSource") != SOURCE:
        raise RuntimeError("Wrong RC7 candidate")
    if preparation.get("readyForSigning") is not True or preparation.get("blockers") != []:
        raise RuntimeError("RC7 signing is held pending reviewed evidence")
    native = preparation.get("native", {})
    checker = preparation.get("screenshotChecker", {})
    rpc = preparation.get("rpcVisual", {})
    startup = preparation.get("startupVisualSupplement", {})
    if native.get("sourceCommit") != SOURCE or native.get("id") != IOS_RUN:
        raise RuntimeError("Wrong native evidence")
    if checker.get("run") != SCREEN_RUN or checker.get("source") != SOURCE or checker.get("verified") is not True:
        raise RuntimeError("Screenshot checker is not qualified")
    if rpc.get("run") != RPC_RUN or rpc.get("source") != RPC_SOURCE or rpc.get("verified") is not True:
        raise RuntimeError("RPC visual evidence is not qualified")
    if startup.get("candidateSource") != SOURCE or startup.get("manualVisualApproved") is not True:
        raise RuntimeError("Lightning startup visual evidence is not qualified")
    # These flags never replace fetching, hashing and verifying the actual evidence.
    return True

def validate_visual_binding(preparation, raw):
    if preparation.get("visualReviewSha256") != hashlib.sha256(raw).hexdigest():
        raise RuntimeError("RC7 visual review digest does not match preparation")
    visual = json.loads(raw)
    if visual.get("sourceCommit") != SOURCE or visual.get("approvedForSigning") is not True:
        raise RuntimeError("Bound RC7 visual review is not approved")
    return True

def main():
    preparation = json.loads(Path(__file__).with_name("RC7_SIGNING_PREPARATION.json").read_text())
    validate(preparation, os.environ["KILOWALLET_SOURCE_COMMIT"],
             os.environ["KILOWALLET_IOS_RUN_ID"], os.environ["KILOWALLET_SCREENSHOT_RUN_ID"])
    validate_visual_binding(preparation, Path(__file__).with_name("rc7-visual-review.json").read_bytes())
    print("RC7 readiness interlock cleared; exact native and visual receipt gates still required.")

if __name__ == "__main__":
    main()

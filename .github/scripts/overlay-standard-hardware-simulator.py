#!/usr/bin/env python3
"""Explicit qualification-only source overlay. Never used by device/release builds."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys

REPLACEMENTS = {
    "class/xbt/standard-hardware.ts": {
        "export const STANDARD_HARDWARE_RELEASE_ENABLED: boolean = false;":
        "export const STANDARD_HARDWARE_RELEASE_ENABLED: boolean = true;"
    },
    "class/xbt/separation-service.ts": {
        "const EVIDENCE = 'https://blockstream.info/api';": "const EVIDENCE = 'https://127.0.0.1:61770/evidence';",
        "const ANCHOR = 'https://mempool.space/api';": "const ANCHOR = 'https://127.0.0.1:61770/anchor';",
    },
}

def main():
    check_only = sys.argv[1:] == ["--check"]
    if not check_only and not (
        sys.argv[1:] == ["--simulator-only"]
        and os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("RUNNER_OS") == "macOS"
    ):
        raise SystemExit("This overlay is restricted to the dedicated macOS CI simulator job.")
    contents = {}
    for filename, replacements in REPLACEMENTS.items():
        original = Path(filename).read_text()
        changed = original
        for before, after in replacements.items():
            if changed.count(before) != 1:
                raise SystemExit("Unexpected source; refusing overlay: " + filename)
            changed = changed.replace(before, after)
        contents[filename] = (original, changed)
    if check_only:
        print("Release remains disabled; simulator overlay anchors verified.")
        return
    receipt = {
        "purpose": "SIMULATOR ONLY - NOT A RELEASE OR TESTFLIGHT BINARY",
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "files": {},
    }
    for filename, (original, changed) in contents.items():
        Path(filename).write_text(changed)
        receipt["files"][filename] = {
            "sourceSha256": hashlib.sha256(original.encode()).hexdigest(),
            "overlaySha256": hashlib.sha256(changed.encode()).hexdigest(),
        }
    info = Path("ios/BlueWallet/Info.plist")
    data = plistlib.loads(info.read_bytes())
    data["CFBundleDisplayName"] = "RedWallet TEST ONLY"
    data["RedWalletQualificationSource"] = receipt["sourceCommit"]
    info.write_bytes(plistlib.dumps(data, sort_keys=False))
    Path("standard-hardware-simulator-overlay.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(receipt["purpose"])

if __name__ == "__main__":
    main()

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
    "class/xbt/separation-http-policy.ts": {
        "export const SEPARATION_EVIDENCE = 'https://blockstream.info/api';": "export const SEPARATION_EVIDENCE = 'https://127.0.0.1:61770/evidence';",
        "export const SEPARATION_ANCHOR = 'https://mempool.space/api';": "export const SEPARATION_ANCHOR = 'https://127.0.0.1:61770/anchor';",
    },
    "blue_modules/redwallet-separation-http/ios/SeparationHTTPTransport.swift": {
        'static let evidenceBase = "https://blockstream.info/api"': 'static let evidenceBase = "https://127.0.0.1:61770/evidence"',
        'static let anchorBase = "https://mempool.space/api"': 'static let anchorBase = "https://127.0.0.1:61770/anchor"',
    },
}

def main():
    if sys.argv[1:] == ["--verify-applied"]:
        receipt = json.loads(Path("standard-hardware-simulator-overlay.json").read_text())
        assert receipt["sourceCommit"] == subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        for filename, hashes in receipt["files"].items():
            assert hashlib.sha256(Path(filename).read_bytes()).hexdigest() == hashes["overlaySha256"], filename
        print("Compiled transport and overlay sources match the recorded hashes.")
        return
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
    tracked_transport = [
        "class/xbt/separation-http.native.ts", "class/xbt/separation-http-policy.ts",
        "class/xbt/separation-service.ts", "ios/BlueWallet.xcodeproj/project.pbxproj",
        "blue_modules/redwallet-separation-http/ios/SeparationHTTPTransport.swift",
        "blue_modules/redwallet-separation-http/ios/RedWalletSeparationHTTP.swift",
        "blue_modules/redwallet-separation-http/ios/RedWalletSeparationHTTP.m",
        ".github/scripts/overlay-standard-hardware-simulator.py",
        "screen/send/ScanQRCode.tsx", "components/CameraScreen.tsx",
    ]
    for filename in tracked_transport:
        if filename not in contents:
            original = Path(filename).read_text()
            contents[filename] = (original, original)
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

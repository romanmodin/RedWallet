#!/usr/bin/env python3
"""Verify the exported RedWallet IPA on macOS before uploading to TestFlight."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import zipfile

team = os.environ["TEAM_ID"]
assert re.fullmatch(r"[A-Z0-9]{10}", team), "Invalid signing team"
# codesign/csreq require '=' to distinguish an inline rule from a filename.
requirement = '=anchor apple generic and certificate leaf[subject.OU] = "' + team + '"'
expected_ids = {"com.romanmodin.redwallet", "com.romanmodin.redwallet.Stickers"}

def run(*args):
    try:
        return subprocess.run(args, check=True, capture_output=True).stdout
    except subprocess.CalledProcessError as error:
        sys.stderr.buffer.write(error.stderr or b"")
        raise

def plist_from_output(data):
    start = data.find(b"<?xml")
    assert start >= 0, "Missing entitlement plist"
    end = data.index(b"</plist>", start) + len(b"</plist>")
    return plistlib.loads(data[start:end])

if sys.argv[1:] == ["--check-requirement"]:
    run("csreq", "-r", requirement, "-t")
    print("Signing certificate requirement parsed successfully")
    sys.exit(0)

ipa = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="redwallet-ipa-") as temporary:
    root = Path(temporary)
    with zipfile.ZipFile(ipa) as archive:
        for name in archive.namelist():
            assert not Path(name).is_absolute() and ".." not in Path(name).parts, "Unsafe archive path"
    run("ditto", "-xk", str(ipa), str(root))
    apps = list((root / "Payload").glob("*.app"))
    assert len(apps) == 1, "Expected one main iOS app"
    app = apps[0]
    run("codesign", "--verify", "--deep", "--strict", "-R", requirement, str(app))
    bundles = [app, *app.rglob("*.appex"), *app.rglob("*.app")]
    seen = set()
    receipt = []
    for bundle in bundles:
        info = plistlib.loads((bundle / "Info.plist").read_bytes())
        identifier = info["CFBundleIdentifier"]
        assert identifier in expected_ids and identifier not in seen, "Unexpected embedded bundle"
        seen.add(identifier)
        run("codesign", "--verify", "--strict", "-R", requirement + ' and identifier "' + identifier + '"', str(bundle))
        assert "iPhoneOS" in info.get("CFBundleSupportedPlatforms", []), "Not a device build"
        signature = subprocess.run(
            ["codesign", "-d", "--entitlements", ":-", str(bundle)],
            check=True, capture_output=True,
        )
        entitlements = plist_from_output(signature.stdout + signature.stderr)
        profile = plistlib.loads(run("security", "cms", "-D", "-i", str(bundle / "embedded.mobileprovision")))
        certificate_prefix = str(root / ("certificate-" + str(len(receipt)) + "-"))
        run("codesign", "-d", "--extract-certificates=" + certificate_prefix, str(bundle))
        leaf_certificate = Path(certificate_prefix + "0").read_bytes()
        assert leaf_certificate in profile["DeveloperCertificates"], "Signer not authorized by profile"
        profile_entitlements = profile["Entitlements"]
        expected_app_id = team + "." + identifier
        assert entitlements.get("application-identifier") == expected_app_id, "Wrong signed app identity"
        assert entitlements.get("com.apple.developer.team-identifier") == team, "Wrong signing team"
        assert profile["TeamIdentifier"] == [team], "Wrong profile team"
        assert profile_entitlements.get("application-identifier") == expected_app_id, "Wrong profile app identity"
        assert not entitlements.get("get-task-allow", False), "Debug entitlement in release app"
        assert not profile_entitlements.get("get-task-allow", False), "Development profile"
        assert not profile.get("ProvisionedDevices"), "Device-limited profile"
        assert not profile.get("ProvisionsAllDevices", False), "Enterprise profile"
        assert profile["ExpirationDate"] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), "Expired profile"
        architectures = run("lipo", "-archs", str(bundle / info["CFBundleExecutable"])).decode().split()
        assert "arm64" in architectures, "Missing iPhone architecture"
        if bundle == app:
            assert info.get("CFBundleDisplayName") == "RedWallet", "Wrong app display name"
            assert entitlements.get("com.apple.security.application-groups") == ["group.com.romanmodin.redwallet"], "Wrong app group"
            assert entitlements.get("aps-environment") == "production", "Incorrect push entitlement for distribution"
            main_info = info
        receipt.append({"bundleId": identifier, "version": info["CFBundleShortVersionString"],
                        "build": info["CFBundleVersion"], "architectures": architectures,
                        "profileExpires": profile["ExpirationDate"].isoformat()})
    assert seen == expected_ids, "Missing required extension"
    digest = hashlib.sha256(ipa.read_bytes()).hexdigest()
    result = {"ipaSha256": digest, "bundles": receipt, "signatureVerification": "passed", "sourceCommit": os.environ.get("GITHUB_SHA")}
    Path("ios-ipa-verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if os.environ.get("GITHUB_ENV"):
        with open(os.environ["GITHUB_ENV"], "a") as output:
            output.write("IPA_OUTPUT_PATH=" + str(ipa) + "\n")
            output.write("PROJECT_VERSION=" + str(main_info["CFBundleShortVersionString"]) + "\n")
            output.write("NEW_BUILD_NUMBER=" + str(main_info["CFBundleVersion"]) + "\n")

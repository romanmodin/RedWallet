"""Sign the pinned Kilobot iPhone archive for internal TestFlight distribution."""
import hashlib
import os
import plistlib
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "kilowallet"))
from manual_profiles import main as prepare_profile, validate_profile
from recover_profile import get

APP_ID = "6838899911"
BUNDLE = "dev.kilowallet.tests.KilobotWallet"
TEAM = "PPG9C98EY9"
VERSION = "1.0.0"
BUILD = "5"


def check_apple():
    app = get(f"/v1/apps/{APP_ID}")["data"]
    if app["id"] != APP_ID or app["attributes"]["bundleId"] != BUNDLE:
        raise ValueError("Unexpected App Store Connect app")
    query = urlencode({"filter[app]": APP_ID, "filter[preReleaseVersion.version]": VERSION,
                       "filter[preReleaseVersion.platform]": "IOS", "limit": 200})
    builds = get("/v1/builds?" + query)
    if builds.get("links", {}).get("next"):
        raise ValueError("Incomplete QA build list")
    for build in builds["data"]:
        number = build["attributes"]["version"]
        if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", number) or int(number.split(".")[0]) >= int(BUILD):
            raise ValueError("QA build number is already in use or superseded")


def check_app(info):
    expected = {"CFBundleIdentifier": BUNDLE, "CFBundleDisplayName": "Kilobot QA",
                "CFBundleShortVersionString": VERSION, "CFBundleVersion": BUILD,
                "CFBundleExecutable": "Kilowallet", "CFBundleSupportedPlatforms": ["iPhoneOS"]}
    if (any(info.get(k) != v for k, v in expected.items())
            or info.get("ITSAppUsesNonExemptEncryption") is not False
            or not re.fullmatch(r"iphoneos\d+(?:\.\d+)*", info.get("DTSDKName", ""))
            or int(info["DTSDKName"][len("iphoneos"):].split(".")[0]) < 26):
        raise ValueError("Unexpected iPhone archive identity, SDK, or encryption configuration")


def read_plist(path):
    return plistlib.loads(path.read_bytes())


def sign_archive():
    if os.environ["TEAM_ID"] != TEAM:
        raise ValueError("Unexpected publishing team")
    root = Path(os.environ["RUNNER_TEMP"])
    archive = root / "KilobotQA.xcarchive"
    app = archive / "Products/Applications/Kilowallet.app"
    if list(app.parent.iterdir()) != [app] or list(app.rglob("*.appex")) or list(app.rglob("*.app")):
        raise ValueError("Unexpected nested app or extension")
    check_app(read_plist(app / "Info.plist"))
    binary = app / "Kilowallet"
    archs = subprocess.check_output(["xcrun", "lipo", "-archs", binary], text=True).split()
    if archs != ["arm64"]:
        raise ValueError("Expected a physical iPhone executable")
    metadata = read_plist(archive / "Info.plist")
    props = metadata["ApplicationProperties"]
    if props["ApplicationPath"] != "Applications/Kilowallet.app" or props["CFBundleIdentifier"] != BUNDLE:
        raise ValueError("Incorrect archived application path or identity")

    check_apple()
    prepare_profile(kilobot_qa=True)
    options = read_plist(Path(os.environ["APPLE_EXPORT_OPTIONS"]))
    if (options.get("testFlightInternalTestingOnly") is not True or options["destination"] != "upload"
            or options["teamID"] != TEAM or set(options["provisioningProfiles"]) != {BUNDLE}):
        raise ValueError("Incorrect internal export options")
    cert = (root / "Kilowallet-signing/distribution.cer").read_bytes()
    identity = hashlib.sha1(cert).hexdigest().upper()
    profile_uuid = options["provisioningProfiles"][BUNDLE]
    profile_file = (Path.home() / "Library/MobileDevice/Provisioning Profiles" /
                    (profile_uuid + ".mobileprovision"))
    profile = validate_profile(profile_file.read_bytes(), BUNDLE, cert, TEAM)
    full_id = TEAM + "." + BUNDLE
    permitted_groups = profile["Entitlements"].get("keychain-access-groups", [])
    if (full_id not in permitted_groups and TEAM + ".*" not in permitted_groups
            or not profile["Entitlements"].get("beta-reports-active")):
        raise ValueError("Profile does not authorize the QA keychain and TestFlight")
    entitlements = {"application-identifier": full_id, "keychain-access-groups": [full_id],
                    "com.apple.developer.team-identifier": TEAM, "get-task-allow": False,
                    "beta-reports-active": True}
    entitlements_path = root / "Kilobot-QA.entitlements"
    entitlements_path.write_bytes(plistlib.dumps(entitlements))
    shutil.copyfile(profile_file, app / "embedded.mobileprovision")
    codesign = ["codesign", "--force", "--sign", identity, "--generate-entitlement-der"]
    frameworks = app / "Frameworks"
    if not (frameworks / "KilombinoTor.framework/KilombinoTor").is_file():
        raise ValueError("Missing the embedded Tor engine")
    for component in sorted(frameworks.iterdir()):
        if component.suffix not in (".dylib", ".framework"):
            raise ValueError("Unexpected code in Frameworks: " + component.name)
        subprocess.run([*codesign, component], check=True)
    subprocess.run([*codesign, "--entitlements", entitlements_path, app], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", app], check=True)
    signed = plistlib.loads(subprocess.check_output(["codesign", "-d", "--entitlements", ":-", app]))
    if signed != entitlements:
        raise ValueError("Signed entitlements differ from the isolated QA entitlements")
    signing_info = subprocess.run(["codesign", "-dvv", app], check=True, capture_output=True, text=True).stderr
    authority = re.search(r"^Authority=(Apple Distribution:.+)$", signing_info, re.MULTILINE)
    if not authority or "TeamIdentifier=" + TEAM not in signing_info:
        raise ValueError("Expected the verified Apple Distribution identity")
    props.update(SigningIdentity=authority[1], Team=TEAM)
    (archive / "Info.plist").write_bytes(plistlib.dumps(metadata))
    print("Verified Kilobot QA 1.0.0 (5) distribution signature, isolated keychain, and internal-only export.")


if __name__ == "__main__":
    sign_archive()

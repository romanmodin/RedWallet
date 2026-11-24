"""Assign the processed Kilobot QA build to its verified, single-tester internal group."""
import datetime
import json
import re
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, build_opener

from sign_archive import APP_ID, BUNDLE, VERSION, BUILD
from recover_profile import NoRedirect, get, token

GROUP = "dfd773b1-2601-45e6-a854-45ecf6f26f91"
GROUP_NAME = "Kilobot QA Internal"


def collection(read, path, **query):
    page = read(path + "?" + urlencode({"limit": 200, **query}))
    if page.get("links", {}).get("next") or not isinstance(page.get("data"), list):
        raise ValueError("Incomplete Apple collection")
    return page["data"]


def verify_group(read):
    app = read("/v1/apps/" + APP_ID)["data"]
    if app["id"] != APP_ID or app["attributes"]["bundleId"] != BUNDLE:
        raise ValueError("Unexpected QA app")
    groups = collection(read, f"/v1/apps/{APP_ID}/betaGroups")
    if len(groups) != 1 or groups[0]["id"] != GROUP:
        raise ValueError("Unexpected groups for the QA app")
    attrs = groups[0]["attributes"]
    if (attrs["name"] != GROUP_NAME or attrs["isInternalGroup"] is not True
            or attrs.get("publicLinkEnabled") or attrs.get("hasAccessToAllBuilds") is not False):
        raise ValueError("Expected the restricted manual internal group")
    testers = collection(read, f"/v1/betaGroups/{GROUP}/betaTesters",
                         **{"fields[betaTesters]": "firstName,lastName,email"})
    holders = collection(read, "/v1/users", **{"filter[roles]": "ACCOUNT_HOLDER",
                         "fields[users]": "firstName,lastName,username,roles"})
    if len(holders) != 1 or len(testers) != 1:
        raise ValueError("Expected one account holder and one tester")
    tester = testers[0]["attributes"]
    holder = holders[0]["attributes"]
    if ("ACCOUNT_HOLDER" not in holder["roles"]
            or (holder["firstName"], holder["lastName"]) != ("Roman", "Winter")
            or not holder.get("username")
            or tester.get("email", "").casefold() != holder["username"].casefold()):
        raise ValueError("The internal tester does not match the authorized account holder")


def read_build(read):
    builds = collection(read, "/v1/builds", **{
        "filter[app]": APP_ID, "filter[version]": BUILD,
        "filter[preReleaseVersion.version]": VERSION, "filter[preReleaseVersion.platform]": "IOS"})
    if not builds:
        return None
    if len(builds) != 1 or not re.fullmatch(r"[a-fA-F0-9-]{36}", builds[0]["id"]):
        raise ValueError("Ambiguous QA build")
    bid = builds[0]["id"]
    page = read(f"/v1/builds/{bid}?include=app,preReleaseVersion,betaGroups,buildBetaDetail")
    resource = page["data"]
    attr = resource["attributes"]
    if (resource["id"] != bid or attr["version"] != BUILD or attr.get("expired")
            or resource["relationships"]["app"]["data"] != {"type": "apps", "id": APP_ID}):
        raise ValueError("Wrong, expired, or mismatched QA build")
    inc = {item["type"]: item["attributes"] for item in page["included"]
           if item["type"] in {"preReleaseVersions", "buildBetaDetails"}}
    train = inc["preReleaseVersions"]
    if train["platform"] != "IOS" or train["version"] != VERSION:
        raise ValueError("Wrong iPhone build train")
    relation = resource["relationships"]["betaGroups"]
    assigned = [item["id"] for item in relation["data"]]
    if relation.get("links", {}).get("next") or any(group != GROUP for group in assigned):
        raise ValueError("Build is already assigned to another group")
    return {"id": bid, "processing": attr["processingState"], "audience": attr.get("buildAudienceType"),
            "internalState": inc.get("buildBetaDetails", {}).get("internalBuildState"), "assigned": GROUP in assigned}


def add_group(bid):
    request = Request(f"https://api.appstoreconnect.apple.com/v1/builds/{bid}/relationships/betaGroups",
                      headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"},
                      data=json.dumps({"data": [{"type": "betaGroups", "id": GROUP}]}).encode())
    with build_opener(NoRedirect()).open(request, timeout=30) as response:
        if response.status != 204:
            raise RuntimeError("Unexpected build assignment response")


def main():
    verify_group(get)
    posted = False
    for _ in range(120):
        build = read_build(get)
        if build and build["processing"] in {"INVALID", "FAILED"}:
            raise ValueError("Apple reported " + build["processing"])
        if build and build["processing"] == "VALID":
            if build["audience"] != "INTERNAL_ONLY":
                raise ValueError("Apple has not marked this build internal-only")
            if build["internalState"] in {"MISSING_EXPORT_COMPLIANCE", "EXPIRED"}:
                raise ValueError("Apple reports " + build["internalState"])
            if build["assigned"] and build["internalState"] == "IN_BETA_TESTING":
                verify_group(get)
                receipt = {"app": APP_ID, "bundle": BUNDLE, "version": VERSION, "build": BUILD,
                           "group": GROUP, "testerCount": 1, **build,
                           "verifiedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
                Path("kilobot-qa-internal-access.json").write_text(json.dumps(receipt, indent=2) + "\n")
                print("Apple confirmed the internal-only build is in beta testing with one tester.")
                return
            if not build["assigned"] and not posted:
                verify_group(get)
                add_group(build["id"])
                posted = True
                print("Assigned the validated internal-only build to the verified internal group.", flush=True)
        time.sleep(30)
    raise RuntimeError("Apple processing or group availability is still pending")


if __name__ == "__main__":
    main()

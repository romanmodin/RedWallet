"""GET-only: require the verified US-only scope immediately before a 1.0 upload."""
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener
from recover_profile import token, NoRedirect
from verify_processing import verify_identity, APP, BUNDLE

ROOT = "https://api.appstoreconnect.apple.com"
APP_PATH = "/v1/apps/" + APP

def route(path):
    u = urlsplit(path)
    if u.scheme or u.netloc or u.fragment or not (
        u.path in (APP_PATH, APP_PATH + "/appAvailabilityV2") or
        re.fullmatch(r"/v2/appAvailabilities/[A-Za-z0-9-]+/territoryAvailabilities", u.path)
    ):
        raise ValueError("Unexpected read-only territory resource")
    return path

def read(path):
    route(path)
    req = Request(ROOT + path, headers={"Authorization": "Bearer " + token(), "Accept": "application/json"}, method="GET")
    with build_opener(NoRedirect()).open(req, timeout=30) as response:
        return json.load(response)

def check(read):
    app = read(APP_PATH)["data"]
    if app.get("type") != "apps" or app.get("id") != APP or app.get("attributes", {}).get("bundleId") != BUNDLE:
        raise ValueError("Wrong Apple app")
    availability = read(APP_PATH + "/appAvailabilityV2")["data"]
    aid = availability.get("id", "")
    if (availability.get("type") != "appAvailabilities" or not re.fullmatch(r"[A-Za-z0-9-]+", aid)
            or availability.get("attributes", {}).get("availableInNewTerritories") is not False):
        raise ValueError("Unverified availability identity or automatic territory expansion")
    path = "/v2/appAvailabilities/" + aid + "/territoryAvailabilities?include=territory&limit=200"
    seen, countries, available = set(), set(), set()
    for _ in range(5):
        if path in seen:
            raise ValueError("Cyclic territory pagination")
        seen.add(path)
        route(path)
        body = read(path)
        if not isinstance(body.get("data"), list):
            raise ValueError("Incomplete territory collection")
        for item in body["data"]:
            territory = item.get("relationships", {}).get("territory", {}).get("data", {})
            country = territory.get("id", "")
            enabled = item.get("attributes", {}).get("available")
            if (item.get("type") != "territoryAvailabilities" or territory.get("type") != "territories"
                    or not re.fullmatch(r"[A-Z]{3}", country) or country in countries or type(enabled) is not bool):
                raise ValueError("Ambiguous territory state")
            countries.add(country)
            if enabled:
                available.add(country)
        nxt = body.get("links", {}).get("next")
        if not nxt:
            if available != {"USA"}:
                raise ValueError("Upload requires exactly United States availability")
            return {"app": APP, "bundle": BUNDLE, "availabilityId": aid,
                    "territories": sorted(available), "availableInNewTerritories": False,
                    "checkedTerritories": len(countries), "mode": "GET-only"}
        u = urlsplit(nxt)
        if u.fragment:
            raise ValueError("Unexpected pagination fragment")
        if u.scheme or u.netloc:
            if u.scheme != "https" or u.netloc != "api.appstoreconnect.apple.com" or u.username or u.password:
                raise ValueError("Unexpected pagination origin")
        path = route(u.path + ("?" + u.query if u.query else ""))
        if urlsplit(path).path != "/v2/appAvailabilities/" + aid + "/territoryAvailabilities":
            raise ValueError("Changed availability during pagination")
    raise ValueError("Incomplete territory pagination")

def main():
    package = json.loads(Path("kilowallet-package-verification.json").read_text())
    verify_identity(package, os.environ)
    if not package["version"].startswith("1.") or package.get("usesNonExemptEncryption") is not False:
        raise ValueError("Unexpected package for US-only 1.0 preflight")
    receipt = check(read)
    receipt.update({"checkedAt": datetime.now(timezone.utc).isoformat(), "sourceCommit": package["sourceCommit"],
                    "ipaSha256": package["ipaSha256"], "runId": package["runId"], "runAttempt": package["runAttempt"]})
    Path("kilowallet-territory-preflight.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))

if __name__ == "__main__": main()

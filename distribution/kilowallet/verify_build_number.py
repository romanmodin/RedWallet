"""Read-only Apple build-number gate before signing and again before upload."""
import datetime
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

APP = "6824331953"
BUNDLE = "com.kilombino.kilowallet"
ROOT = "https://api.appstoreconnect.apple.com"


def number(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", value):
        raise ValueError("Unsupported Apple build number")
    return tuple(int(part) for part in value.split(".")) + (0,) * (3 - len(value.split(".")))


def inspect(read, proposed, version):
    target = number(proposed)
    if version != "1.0.0":
        raise ValueError("Unexpected marketing version")
    app = read("/v1/apps/" + APP)["data"]
    if app.get("id") != APP or app.get("attributes", {}).get("bundleId") != BUNDLE:
        raise ValueError("Wrong Apple app")
    filters = {"filter[app]": APP, "filter[preReleaseVersion.version]": version,
               "filter[preReleaseVersion.platform]": "IOS"}
    path = "/v1/builds?" + urlencode(dict(filters, include="app,preReleaseVersion", limit=200))
    seen_pages, seen_builds, builds = set(), set(), []
    for _ in range(20):
        url = urlsplit(path)
        if (url.scheme and url.scheme != "https") or (url.netloc and url.netloc != "api.appstoreconnect.apple.com") or url.fragment or url.path != "/v1/builds":
            raise ValueError("Unsafe Apple pagination")
        query = parse_qs(url.query)
        if any(query.get(k) != [v] for k, v in filters.items()) or query.get("include") != ["app,preReleaseVersion"]:
            raise ValueError("Apple pagination changed app or version scope")
        path = url.path + "?" + url.query
        if path in seen_pages:
            raise ValueError("Cyclic Apple pagination")
        seen_pages.add(path)
        page = read(path)
        if not isinstance(page.get("data"), list):
            raise ValueError("Incomplete Apple builds")
        included = {(x["type"], x["id"]): x for x in page.get("included", [])}
        for build in page["data"]:
            identity = build.get("id")
            if build.get("type") != "builds" or not identity or identity in seen_builds:
                raise ValueError("Duplicate or invalid Apple build")
            seen_builds.add(identity)
            rel = build.get("relationships", {})
            if rel.get("app", {}).get("data") != {"type": "apps", "id": APP}:
                raise ValueError("Foreign Apple build")
            train = rel.get("preReleaseVersion", {}).get("data", {})
            train = included.get((train.get("type"), train.get("id")), {})
            if train.get("attributes", {}).get("version") != version or train.get("attributes", {}).get("platform") != "IOS":
                raise ValueError("Foreign or missing Apple version train")
            attrs = build.get("attributes", {})
            if number(attrs.get("version")) >= target:
                raise ValueError("Proposed build number already exists or is not newer")
            builds.append({"id": identity, "build": attrs["version"], "processingState": attrs.get("processingState")})
        path = page.get("links", {}).get("next")
        if not path:
            return dict(app=APP, bundle=BUNDLE, marketingVersion=version, proposedBuild=proposed,
                        existingBuilds=builds, duplicateAbsent=True, readOnly=True, writes=[],
                        observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    raise ValueError("Incomplete Apple pagination")


def main():
    if (os.environ.get("TEAM_ID") != "PPG9C98EY9" or
            os.environ.get("GITHUB_REPOSITORY") != "romanmodin/RedWallet" or
            os.environ.get("GITHUB_REF") != "refs/heads/main" or
            os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or
            os.environ.get("GITHUB_RUN_ATTEMPT") != "1"):
        raise ValueError("Build preflight requires first-attempt publisher main dispatch")
    phase = sys.argv[1] if len(sys.argv) == 2 else ""
    if phase not in ("before-signing", "before-upload"):
        raise ValueError("Invalid preflight phase")
    from recover_profile import get
    report = inspect(get, os.environ["GITHUB_RUN_NUMBER"], os.environ["KILOWALLET_MARKETING_VERSION"])
    report.update(sourceCommit=os.environ["KILOWALLET_SOURCE_COMMIT"],
                  orchestrationCommit=os.environ["GITHUB_SHA"], runId=os.environ["GITHUB_RUN_ID"],
                  runAttempt=os.environ["GITHUB_RUN_ATTEMPT"], phase=phase)
    Path("kilowallet-build-preflight-" + phase + ".json").write_text(json.dumps(report, indent=2) + "\n")
    print("Apple build-number preflight passed for " + report["marketingVersion"] + " (" + report["proposedBuild"] + "); read-only.")


if __name__ == "__main__":
    main()

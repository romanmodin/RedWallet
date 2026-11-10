import test from "node:test";
import assert from "node:assert/strict";
import { RELEASE as R, apiClient, verifyReceipt, publish } from "./publish-redwallet-public-beta.mjs";

function fixture(options = {}) {
  const state = { assigned: false, auto: false, external: "READY_FOR_BETA_SUBMISSION", review: null, ...options };
  const writes = [], checkpoints = [];
  const receipt = {
    publicSourceCommit: R.source, sourceCommit: R.source, orchestrationCommit: R.orchestration,
    ipaSha256: R.ipa, lightningNetwork: "mainnet", signatureVerification: "passed", sourceMappingVerification: "passed",
    bundles: [R.bundle, R.bundle + ".Stickers"].map(bundleId => ({
      bundleId, version: R.version, build: R.build, architectures: ["arm64"]
    }))
  };
  const app = { id: R.app, attributes: { bundleId: R.bundle } };
  const group = { id: R.group, attributes: { name: R.groupName, isInternalGroup: false,
    publicLinkEnabled: true, publicLink: R.publicLink }, relationships: { app: { data: { id: R.app } } } };
  const info = () => ({
    data: { type: "builds", id: R.appleBuild, attributes: { version: R.build, processingState: "VALID",
      expired: false, usesNonExemptEncryption: false, buildAudienceType: "APP_STORE_ELIGIBLE", ...state.buildAttributes },
      relationships: { app: { data: { id: R.app } }, preReleaseVersion: { data: { id: "version-1" } },
        buildBetaDetail: { data: { id: "detail-1" } }, betaAppReviewSubmission: { data: state.review ? { id: "review-1" } : null } } },
    included: [
      { id: "version-1", type: "preReleaseVersions", attributes: { version: R.version, platform: "IOS" } },
      { id: "detail-1", type: "buildBetaDetails", attributes: { internalBuildState: "IN_BETA_TESTING",
        externalBuildState: state.external, autoNotifyEnabled: state.auto } },
      ...(state.review ? [{ id: "review-1", type: "betaAppReviewSubmissions", attributes: { betaReviewState: state.review } }] : []),
      ...(state.assigned ? [{ ...group, type: "betaGroups" }] : [])
    ]
  });
  const api = async (method, path, query, payload) => {
    if (method !== "GET") {
      writes.push({ method, path, payload });
      if (state.failAt === path) throw Error("Apple operation failed: HTTP 503");
      if (path.endsWith("/relationships/betaGroups")) {
        assert.deepEqual(payload, { data: [{ type: "betaGroups", id: R.group }] });
        state.assigned = true;
      } else if (method === "PATCH") {
        assert.equal(path, "/v1/buildBetaDetails/detail-1");
        assert.deepEqual(payload.data.attributes, { autoNotifyEnabled: true });
        state.auto = true;
      } else if (path === "/v1/betaAppReviewSubmissions") {
        assert.equal(payload.data.relationships.build.data.id, R.appleBuild);
        state.review = "WAITING_FOR_REVIEW"; state.external = "WAITING_FOR_BETA_REVIEW";
      } else if (path === "/v1/buildBetaNotifications") {
        assert.equal(payload.data.relationships.build.data.id, R.appleBuild);
        state.external = "IN_BETA_TESTING";
      } else assert.fail("Unexpected write");
      return {};
    }
    if (path === "/v1/apps/" + R.app) return { data: app };
    if (path === "/v1/apps/" + R.app + "/betaGroups") return { data: state.missingGroup ? [] : [group] };
    if (path === "/v1/builds") {
      assert.equal(query["filter[app]"], R.app);
      assert.equal(query["filter[version]"], R.build);
      return { data: state.wrongBuildMembership ? [] : [info().data] };
    }
    if (path.endsWith("/betaBuildLocalizations")) return { data: [{ attributes: { locale: "en-US", whatsNew: "Existing release notes" } }] };
    assert.equal(path, "/v1/builds/" + R.appleBuild);
    return info();
  };
  return { state, writes, receipt, app, group, checkpoints, api,
    run: () => publish(api, receipt, R.uploadRun, x => checkpoints.push(x)) };
}

test("only assigns existing public group and submits exact verified build; repeats do not resubmit", async () => {
  const f = fixture();
  const first = await f.run();
  assert.equal(first.status, "APPLE_BETA_REVIEW_PENDING");
  assert.deepEqual(first.operations, ["assigned_existing_public_group", "enabled_release_after_approval", "submitted_beta_review"]);
  assert.equal(f.writes.length, 3);
  const again = await f.run();
  assert.equal(again.status, "APPLE_BETA_REVIEW_PENDING");
  assert.deepEqual(again.operations, []);
  assert.equal(f.writes.length, 3);
});
test("already available exact build makes no writes", async () => {
  const f = fixture({ assigned: true, auto: false, external: "IN_BETA_TESTING", review: "APPROVED" });
  assert.equal((await f.run()).status, "AVAILABLE_TO_PUBLIC_TESTERS");
  assert.equal(f.writes.length, 0);
});
test("approved ready build starts external testing once", async () => {
  const f = fixture({ assigned: true, auto: true, external: "READY_FOR_BETA_TESTING", review: "APPROVED" });
  assert.equal((await f.run()).status, "AVAILABLE_TO_PUBLIC_TESTERS");
  assert.equal(f.writes.length, 1);
  await f.run(); assert.equal(f.writes.length, 1);
});
for (const key of ["sourceCommit", "ipaSha256", "orchestrationCommit"]) {
  test("wrong receipt " + key + " makes no API calls", async () => {
    const f = fixture(); f.receipt[key] = "different";
    let calls = 0;
    await assert.rejects(publish(async () => { calls++; }, f.receipt, R.uploadRun));
    assert.equal(calls, 0);
  });
}
test("wrong upload or bundle is rejected", () => {
  const f = fixture();
  assert.throws(() => verifyReceipt(f.receipt, "different"));
  f.receipt.bundles[1].bundleId = R.bundle;
  assert.throws(() => verifyReceipt(f.receipt, R.uploadRun));
});
for (const [name, mutate] of [
  ["app", f => { f.app.attributes.bundleId = "another.app"; }],
  ["group missing from app", f => { f.state.missingGroup = true; }],
  ["build missing from app", f => { f.state.wrongBuildMembership = true; }],
  ["group", f => { f.group.attributes.isInternalGroup = true; }],
  ["link", f => { f.group.attributes.publicLink = "https://testflight.apple.com/join/other"; }],
  ["expired", f => { f.state.buildAttributes = { expired: true }; }],
  ["internal only", f => { f.state.buildAttributes = { buildAudienceType: "INTERNAL_ONLY" }; }],
  ["encryption", f => { f.state.buildAttributes = { usesNonExemptEncryption: true }; }],
  ["rejected", f => { f.state.external = "BETA_REJECTED"; f.state.review = "REJECTED"; }]
]) {
  test("reject " + name + " before any write", async () => {
    const f = fixture(); mutate(f); await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
  });
}
test("uncertain submission stops without retry and preserves assignment checkpoint", async () => {
  const f = fixture({ failAt: "/v1/betaAppReviewSubmissions" });
  await assert.rejects(f.run(), /HTTP 503/);
  assert.equal(f.writes.filter(x => x.path === f.state.failAt).length, 1);
  assert.equal(f.checkpoints.at(-1).status, "BLOCKED");
  assert.equal(f.checkpoints.at(-1).groupAssigned, true);
  assert.deepEqual(f.checkpoints.at(-1).operations, ["assigned_existing_public_group", "enabled_release_after_approval"]);
});
test("transport disallows unrelated writes, deletes, tester reads and credential redirects", async () => {
  let calls = 0;
  const api = apiClient("fixture", async (url, options) => {
    calls++;
    assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  for (const [method, path] of [["GET", "/v1/betaTesters"], ["DELETE", "/v1/builds/" + R.appleBuild],
    ["POST", "/v1/betaGroups"], ["PATCH", "/v1/apps/" + R.app], ["GET", "https://elsewhere.example/"]]) {
    await assert.rejects(api(method, path), /Unexpected Apple/);
  }
  assert.equal(calls, 0);
  await api("GET", "/v1/apps/" + R.app);
  assert.equal(calls, 1);
});
test("transport rejects incomplete and failed responses", async () => {
  await assert.rejects(apiClient("fixture", async () => new Response(JSON.stringify({ links: { next: "more" } })))("GET", "/v1/apps/" + R.app), /Incomplete/);
  await assert.rejects(apiClient("fixture", async () => new Response("private detail", { status: 403 }))("GET", "/v1/apps/" + R.app), /HTTP 403/);
});

test("transport reports only fixed operation identity on server errors and never retries", async () => {
  let calls = 0;
  const api = apiClient("private-token", async () => {
    calls++;
    return new Response("private-server-response", { status: 500 });
  });
  await assert.rejects(api("GET", "/v1/apps/" + R.app), error => {
    assert.equal(error.message, "Apple operation failed: HTTP 500 (GET /v1/apps/" + R.app + ")");
    assert.ok(!error.message.includes("private"));
    return true;
  });
  assert.equal(calls, 1);
});
test("transport rejects unscoped and different-build membership queries", async () => {
  let calls = 0;
  const api = apiClient("fixture", async () => { calls++; return new Response("{}"); });
  for (const query of [{}, { "filter[app]": "other", "filter[version]": R.build },
    { "filter[app]": R.app, "filter[version]": "other" }]) {
    await assert.rejects(api("GET", "/v1/builds", query), /Unexpected Apple/);
  }
  assert.equal(calls, 0);
});

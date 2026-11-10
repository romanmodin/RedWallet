import assert from "node:assert/strict";
import test from "node:test";
import { inspect, reader } from "./inspect-redwallet-testflight.mjs";
const app = { id: "6817118871", attributes: { bundleId: "com.romanmodin.redwallet" } };
const group = (id, internal) => ({ id, type: "betaGroups", attributes: { name: id, isInternalGroup: internal, publicLinkEnabled: !internal, publicLink: "https://testflight.apple.com/join/example" } });
const build = (id, version) => ({ id, type: "builds", attributes: { version, uploadedDate: "2026-11-10T12:00:00Z", processingState: "VALID", minOsVersion: "15.6" } });
function fixture() {
  const internal = group("internal", true), external = group("external", false), latest = build("latest", "200"), prior = build("prior", "100");
  const calls = [];
  const get = async (path, query) => {
    calls.push([path, query]);
    if (path === "/v1/apps/6817118871") return { data: app };
    if (path === "/v1/apps/6817118871/betaGroups") return { data: [internal, external] };
    if (path === "/v1/builds") return { data: [latest, prior] };
    if (path === "/v1/betaGroups/internal/builds") return { data: [latest] };
    if (path === "/v1/betaGroups/external/builds") return { data: [prior] };
    if (path === "/v1/builds/latest" || path === "/v1/builds/prior") {
      const newest = path.endsWith("latest");
      return { data: newest ? latest : prior, included: [
        newest ? internal : external,
        { type: "buildBetaDetails", attributes: { internalBuildState: "IN_BETA_TESTING", externalBuildState: newest ? "READY_FOR_BETA_SUBMISSION" : "IN_BETA_TESTING" } },
        { type: "preReleaseVersions", attributes: { version: "8.0.1", platform: "IOS" } }
      ] };
    }
    throw Error("Unexpected fixture path");
  };
  return { calls, get };
}
test("reports separate internal and public build availability without requesting testers", async () => {
  const f = fixture(), report = await inspect(f.get, "fixture-time");
  assert.equal(report.latestBuilds[0].build, "200");
  assert.equal(report.latestBuilds[0].externalBuildState, "READY_FOR_BETA_SUBMISSION");
  assert.equal(report.groups.find((g) => !g.internal).latestBuilds[0].build, "100");
  assert.equal(report.groups.find((g) => !g.internal).publicLinkEnabled, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.changedGroups, false);
  assert.equal(report.submittedReview, false);
  assert.equal(report.testerIdentitiesRequested, false);
  assert.equal(f.calls.filter(([p]) => p === "/v1/builds/latest").length, 1);
  assert.ok(f.calls.every(([p]) => !p.includes("betaTesters")));
});
test("fails closed on a different app", async () => {
  await assert.rejects(inspect(async () => ({ data: { ...app, attributes: { bundleId: "other.app" } } })), /Wrong Apple app/);
});
test("reader only sends GET to fixed Apple host and rejects redirects", async () => {
  let seen;
  const get = reader("fixture", async (url, options) => {
    seen = { url, options };
    return { ok: true, json: async () => ({ data: app }) };
  });
  await get("/v1/apps/6817118871");
  assert.equal(seen.url.origin, "https://api.appstoreconnect.apple.com");
  assert.equal(seen.options.method, "GET");
  assert.equal(seen.options.redirect, "error");
  for (const path of ["/v1/users", "/v1/apps/other", "/v1/betaTesters", "/v1/betaGroups/group/relationships/builds", "https://example.com/v1/apps/6817118871"])
    await assert.rejects(get(path), /Unexpected Apple resource/);
  await assert.rejects(get("/v1/builds", {}), /Unexpected Apple resource/);
});
test("rejects incomplete pagination and does not return raw Apple errors", async () => {
  await assert.rejects(reader("fixture", async () => ({ ok: true, json: async () => ({ links: { next: "next" } }) }))("/v1/apps/6817118871"), /Incomplete Apple response/);
  await assert.rejects(reader("fixture", async () => ({ ok: false, status: 403 }))("/v1/apps/6817118871"), /^Error: Apple read failed: HTTP 403$/);
});

test("allows a deliberate latest-five build prefix while rejecting incomplete group lists", async () => {
  const get = reader("fixture", async () => ({ ok: true, json: async () => ({ data: [], links: { next: "more" } }) }));
  await get("/v1/builds", { "filter[app]": "6817118871", sort: "-uploadedDate", limit: "5" });
  await assert.rejects(get("/v1/apps/6817118871/betaGroups", { limit: "200" }), /Incomplete Apple response/);
});

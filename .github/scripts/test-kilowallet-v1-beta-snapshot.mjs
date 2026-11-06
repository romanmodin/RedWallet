import test from "node:test";
import assert from "node:assert/strict";
import { APP, GROUPS, planDistribution } from "./kilowallet-v1-beta-plan.mjs";
import { readSnapshot, collection } from "./kilowallet-v1-beta-snapshot.mjs";
const NOW = Date.parse("2026-11-04T08:30:00Z");
const upload = {
  uploadVerified: true,
  currentNativeGatesVerified: true,
  app: APP,
  marketingVersion: "1.0.0",
  signature: "verified",
  usesNonExemptEncryption: false,
  sourceCommit: "a".repeat(40),
  ipaSha256: "b".repeat(64),
  appleBuildId: "synthetic-build",
  build: "999",
  runId: 123,
  runAttempt: 1,
};
const rel = (type, id) => ({ data: { type, id } });
const one = (type, id, attributes = {}, relationships = {}) => ({
  data: { type, id, attributes, relationships },
});
const many = (type, ids) => ({
  data: ids.map((id) => ({ type, id })),
  meta: { paging: { total: ids.length } },
});
function fixture() {
  const b = "/v1/builds/synthetic-build";
  const pages = {
    ["/v1/apps/" + APP]: one("apps", APP, {
      bundleId: "com.kilombino.kilowallet",
    }),
    [b +
    "?include=app,preReleaseVersion,appEncryptionDeclaration,buildBetaDetail,betaAppReviewSubmission"]:
      one(
        "builds",
        "synthetic-build",
        {
          version: "999",
          processingState: "VALID",
          expired: false,
          usesNonExemptEncryption: false,
        },
        {
          app: rel("apps", APP),
          preReleaseVersion: rel("preReleaseVersions", "train"),
          buildBetaDetail: rel("buildBetaDetails", "detail"),
          appEncryptionDeclaration: rel(
            "appEncryptionDeclarations",
            "declaration",
          ),
          betaAppReviewSubmission: rel("betaAppReviewSubmissions", "review"),
        },
      ),
    [b + "/preReleaseVersion"]: one("preReleaseVersions", "train", {
      version: "1.0.0",
      platform: "IOS",
    }),
    [b + "/buildBetaDetail"]: one("buildBetaDetails", "detail", {
      internalBuildState: "IN_BETA_TESTING",
      externalBuildState: "IN_BETA_TESTING",
    }),
    ["/v1/appEncryptionDeclarations/declaration?include=app"]: one(
      "appEncryptionDeclarations",
      "declaration",
      { appEncryptionDeclarationState: "APPROVED" },
      { app: rel("apps", APP) },
    ),
    ["/v1/betaAppReviewSubmissions/review?include=build"]: one(
      "betaAppReviewSubmissions",
      "review",
      { betaReviewState: "APPROVED" },
      { build: rel("builds", "synthetic-build") },
    ),
    ["/v1/betaGroups?filter%5Bapp%5D=" + APP + "&filter%5Bbuilds%5D=synthetic-build&limit=200"]: many(
      "betaGroups",
      GROUPS.map((g) => g.id),
    ),
    [b + "/betaBuildLocalizations?limit=200"]: {
      data: [
        {
          type: "betaBuildLocalizations",
          id: "locale",
          attributes: { locale: "en-US", whatsNew: "Synthetic notes" },
        },
      ],
    },
  };
  for (const g of GROUPS) {
    pages["/v1/betaGroups/" + g.id + "?include=app"] = one(
      "betaGroups",
      g.id,
      { name: g.name, isInternalGroup: g.internal },
      { app: rel("apps", APP) },
    );
    pages["/v1/betaGroups/" + g.id + "/builds?limit=200"] = many("builds", [
      "synthetic-build",
    ]);
  }
  return pages;
}
function reader(pages, calls = []) {
  return async (path) => {
    calls.push(path);
    assert.ok(Object.hasOwn(pages, path), "Unexpected read " + path);
    return structuredClone(pages[path]);
  };
}
test("complete exact Apple-shaped resources normalize and qualify without transport or writes", async () => {
  const calls = [],
    s = await readSnapshot(reader(fixture(), calls), upload, () => NOW);
  assert.equal(s.complete, true);
  assert.deepEqual([...calls].sort(), Object.keys(fixture()).sort());
  const p = planDistribution(s, upload, "Synthetic notes", NOW);
  assert.equal(p.available, true);
  assert.deepEqual(p.writes, []);
});
test("wrong upload blocks before any read", async () => {
  let reads = 0;
  await assert.rejects(
    readSnapshot(
      async () => reads++,
      { ...upload, marketingVersion: "0.4.0" },
      () => NOW,
    ),
  );
  assert.equal(reads, 0);
});
test("foreign relationship bindings and wrong train cannot become a complete snapshot", async () => {
  const changes = [
    (p) => (p["/v1/apps/" + APP].data.attributes.bundleId = "foreign"),
    (p) =>
      (p[
        "/v1/builds/synthetic-build?include=app,preReleaseVersion,appEncryptionDeclaration,buildBetaDetail,betaAppReviewSubmission"
      ].data.relationships.app.data.id = "foreign"),
    (p) =>
      (p["/v1/builds/synthetic-build/preReleaseVersion"].data.id = "foreign"),
    (p) =>
      (p[
        "/v1/builds/synthetic-build/preReleaseVersion"
      ].data.attributes.version = "0.4.0"),
    (p) =>
      (p[
        "/v1/builds/synthetic-build/preReleaseVersion"
      ].data.attributes.platform = "MAC_OS"),
    (p) =>
      (p["/v1/builds/synthetic-build/buildBetaDetail"].data.id = "foreign"),
    (p) =>
      (p[
        "/v1/appEncryptionDeclarations/declaration?include=app"
      ].data.relationships.app.data.id = "foreign"),
    (p) =>
      (p[
        "/v1/betaAppReviewSubmissions/review?include=build"
      ].data.relationships.build.data.id = "foreign"),
    (p) =>
      (p[
        "/v1/betaGroups/" + GROUPS[0].id + "?include=app"
      ].data.attributes.name = "foreign"),
    (p) =>
      p["/v1/betaGroups?filter%5Bapp%5D=" + APP + "&filter%5Bbuilds%5D=synthetic-build&limit=200"].data.push({
        type: "betaGroups",
        id: "foreign",
      }),
  ];
  for (const change of changes) {
    const p = fixture();
    change(p);
    await assert.rejects(readSnapshot(reader(p), upload, () => NOW));
  }
});
test("group-side mismatch remains pending, not available or reassigned", async () => {
  const p = fixture();
  p["/v1/betaGroups/" + GROUPS[1].id + "/builds?limit=200"] = many(
    "builds",
    [],
  );
  const s = await readSnapshot(reader(p), upload, () => NOW),
    plan = planDistribution(s, upload, "Synthetic notes", NOW);
  assert.equal(plan.available, false);
  assert.equal(plan.propagationPending, true);
  assert.deepEqual(plan.writes, []);
});
test("pagination follows only the original Apple collection and checks complete totals", async () => {
  let calls = 0;
  const rows = await collection(
    async (path) => {
      calls++;
      return calls === 1
        ? {
            data: [{ type: "builds", id: "one" }],
            meta: { paging: { total: 2 } },
            links: {
              next: "https://api.appstoreconnect.apple.com/v1/betaGroups/group/builds?cursor=next",
            },
          }
        : {
            data: [{ type: "builds", id: "two" }],
            meta: { paging: { total: 2 } },
          };
    },
    "/v1/betaGroups/group/builds?limit=200",
    "builds",
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["one", "two"],
  );
  assert.equal(calls, 2);
});
test("foreign pagination is rejected before another injected read", async () => {
  for (const next of [
    "https://evil.invalid/v1/betaGroups/group/builds",
    "https://user@api.appstoreconnect.apple.com/v1/betaGroups/group/builds",
    "/v1/apps/foreign",
    "/v1/betaGroups/group/builds#fragment",
  ]) {
    let calls = 0;
    await assert.rejects(
      collection(
        async () => {
          calls++;
          return { data: [], links: { next } };
        },
        "/v1/betaGroups/group/builds?limit=200",
        "builds",
      ),
    );
    assert.equal(calls, 1);
  }
});
test("duplicates, cycles, changing totals and truncated collections fail closed", async () => {
  for (const mode of ["duplicate", "cycle", "total", "truncated"]) {
    let calls = 0;
    await assert.rejects(
      collection(
        async () => {
          calls++;
          if (mode === "truncated")
            return { data: [], meta: { paging: { total: 1 } } };
          if (mode === "cycle")
            return { data: [], links: { next: "/v1/items?limit=200" } };
          return {
            data: [
              {
                type: "builds",
                id: mode === "duplicate" ? "same" : String(calls),
              },
            ],
            meta: {
              paging: { total: calls === 1 ? 2 : mode === "total" ? 3 : 2 },
            },
            ...(calls === 1
              ? { links: { next: "/v1/items?cursor=next" } }
              : {}),
          };
        },
        "/v1/items?limit=200",
        "builds",
      ),
    );
  }
});
test("failed read never returns a partial complete snapshot", async () => {
  await assert.rejects(
    readSnapshot(
      async () => {
        throw Error("temporary API failure");
      },
      upload,
      () => NOW,
    ),
    /temporary/,
  );
});

test("explicit null encryption relation is complete without a declaration read; missing relation fails closed", async () => {
  const p=fixture(), key="/v1/builds/synthetic-build?include=app,preReleaseVersion,appEncryptionDeclaration,buildBetaDetail,betaAppReviewSubmission";
  p[key].data.relationships.appEncryptionDeclaration={data:null};
  delete p["/v1/appEncryptionDeclarations/declaration?include=app"];
  const calls=[], s=await readSnapshot(reader(p,calls),upload,()=>NOW);
  assert.equal(s.declaration,null); assert.equal(s.build.declarationId,null);
  assert.equal(planDistribution(s,upload,"Synthetic notes",NOW).available,true);
  assert.ok(!calls.some(x=>x.startsWith("/v1/appEncryptionDeclarations/")));
  delete p[key].data.relationships.appEncryptionDeclaration;
  await assert.rejects(readSnapshot(reader(p),upload,()=>NOW));
});

import test from "node:test";
import assert from "node:assert/strict";
import { APP, GROUPS, applyDistribution } from "./kilowallet-v1-beta-plan.mjs";
import { readSnapshot } from "./kilowallet-v1-beta-snapshot.mjs";
import { clients } from "./kilowallet-v1-beta-client.mjs";
import { PRIOR_BUILD } from "./kilowallet-v1-beta-prior-review.mjs";
const NOW = Date.parse("2026-11-04T09:00:00Z"),
  notes = "Synthetic release notes";
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
const b = "/v1/builds/synthetic-build";
const rel = (type, id) => ({ data: { type, id } });
function fixture() {
  const state = {
    notes: "old",
    groups: [],
    review: false,
    processing: "VALID",
    failWrite: false,
    priorPending: false,
    priorReadFails: false,
  };
  const requests = [],
    journal = [];
  const one = (type, id, attributes = {}, relationships = {}) => ({
    data: { type, id, attributes, relationships },
  });
  const many = (type, ids) => ({
    data: ids.map((id) => ({ type, id })),
    meta: { paging: { total: ids.length } },
  });
  async function request(url, options) {
    const path = url.pathname,
      method = options.method;
    requests.push({ path, method, options });
    assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer synthetic-token");
    assert.ok(options.signal instanceof AbortSignal);
    if (method !== "GET") {
      if (state.failWrite) throw Error("Ambiguous connection failure");
      const body = JSON.parse(options.body);
      if (path === "/v1/betaBuildLocalizations/english")
        state.notes = body.data.attributes.whatsNew;
      else if (path === b + "/relationships/betaGroups")
        state.groups = body.data.map((x) => x.id);
      else if (path === "/v1/betaAppReviewSubmissions") state.review = true;
      else throw Error("Unexpected fixture write");
      return { ok: true, status: 204 };
    }
    let result;
    if (path === "/v1/builds/" + PRIOR_BUILD) {
      if (state.priorReadFails) throw Error("Prior review unavailable");
      result = one("builds", PRIOR_BUILD, {version:"8"}, {
        app:rel("apps",APP),preReleaseVersion:rel("preReleaseVersions","prior-train"),
        buildBetaDetail:rel("buildBetaDetails","prior-detail"),
        betaAppReviewSubmission:rel("betaAppReviewSubmissions","prior-review")});
      result.included = [
        one("apps",APP,{bundleId:"com.kilombino.kilowallet"}).data,
        one("preReleaseVersions","prior-train",{version:"1.0.0",platform:"IOS"}).data,
        one("buildBetaDetails","prior-detail",{externalBuildState:state.priorPending?"WAITING_FOR_BETA_REVIEW":"IN_BETA_TESTING"}).data,
        one("betaAppReviewSubmissions","prior-review",{betaReviewState:state.priorPending?"WAITING_FOR_REVIEW":"APPROVED"}).data
      ];
    } else if (path === "/v1/apps/" + APP)
      result = one("apps", APP, { bundleId: "com.kilombino.kilowallet" });
    else if (path === b) {
      // Like a JSON:API response, relationship data is provided only when requested.
      assert.equal(
        url.searchParams.get("include"),
        "app,preReleaseVersion,appEncryptionDeclaration,buildBetaDetail,betaAppReviewSubmission,betaGroups",
      );
      result = one(
        "builds",
        "synthetic-build",
        {
          version: "999",
          processingState: state.processing,
          expired: false,
          usesNonExemptEncryption: false,
        },
        {
          app: rel("apps", APP),
          betaGroups: {data:state.groups.map(id=>({type:"betaGroups",id})),meta:{paging:{total:state.groups.length}}},
          preReleaseVersion: rel("preReleaseVersions", "train"),
          buildBetaDetail: rel("buildBetaDetails", "detail"),
          appEncryptionDeclaration: rel(
            "appEncryptionDeclarations",
            "declaration",
          ),
          betaAppReviewSubmission: state.review
            ? rel("betaAppReviewSubmissions", "review")
            : { data: null },
        },
      );
    } else if (path === b + "/preReleaseVersion")
      result = one("preReleaseVersions", "train", {
        version: "1.0.0",
        platform: "IOS",
      });
    else if (path === b + "/buildBetaDetail")
      result = one("buildBetaDetails", "detail", {
        internalBuildState: state.review
          ? "IN_BETA_TESTING"
          : "READY_FOR_BETA_TESTING",
        externalBuildState: state.review
          ? "IN_BETA_TESTING"
          : "READY_FOR_BETA_SUBMISSION",
      });
    else if (path === "/v1/appEncryptionDeclarations/declaration")
      result = one(
        "appEncryptionDeclarations",
        "declaration",
        { appEncryptionDeclarationState: "APPROVED" },
        { app: rel("apps", APP) },
      );
    else if (path === "/v1/betaAppReviewSubmissions/review")
      result = one(
        "betaAppReviewSubmissions",
        "review",
        { betaReviewState: "APPROVED" },
        { build: rel("builds", "synthetic-build") },
      );
    else if (path === "/v1/betaGroups") {
      assert.equal(url.searchParams.get("filter[app]"),APP);
      assert.equal(url.searchParams.get("filter[builds]"),"synthetic-build");
      result = many("betaGroups", state.groups);
    }
    else if (path === b + "/betaBuildLocalizations")
      result = {
        data: [
          {
            type: "betaBuildLocalizations",
            id: "english",
            attributes: { locale: "en-US", whatsNew: state.notes },
          },
        ],
      };
    else {
      const group = GROUPS.find(
        (g) =>
          path === "/v1/betaGroups/" + g.id ||
          path === "/v1/betaGroups/" + g.id + "/builds",
      );
      assert.ok(group, "Unexpected fixture read");
      result = path.endsWith("/builds")
        ? many(
            "builds",
            state.groups.includes(group.id) ? ["synthetic-build"] : [],
          )
        : one(
            "betaGroups",
            group.id,
            { name: group.name, isInternalGroup: group.internal },
            { app: rel("apps", APP) },
          );
    }
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  }
  const log = async (event) => journal.push(structuredClone(event));
  const client = clients(
    "synthetic-token",
    upload,
    notes,
    log,
    request,
    () => NOW,
  );
  return { state, requests, journal, client, request, log };
}
const notesBody = {
  data: {
    type: "betaBuildLocalizations",
    id: "english",
    attributes: { whatsNew: notes },
  },
};
test("full fresh-plan integration writes notes, original groups, and beta review once", async () => {
  const f = fixture(),
    result = await applyDistribution(
      () => readSnapshot(f.client.get, upload, () => NOW),
      f.client.write,
      upload,
      notes,
      f.log,
      () => NOW,
    );
  assert.equal(result.available, true);
  assert.deepEqual(
    f.requests.filter((r) => r.method !== "GET").map((r) => [r.method, r.path]),
    [
      ["PATCH", "/v1/betaBuildLocalizations/english"],
      ["POST", b + "/relationships/betaGroups"],
      ["POST", "/v1/betaAppReviewSubmissions"],
    ],
  );
  assert.equal(
    f.journal.filter((e) => e.stage === "beta-http-started").length,
    3,
  );
  const previous = f.requests.filter((r) => r.method !== "GET").length;
  await applyDistribution(
    () => readSnapshot(f.client.get, upload, () => NOW),
    f.client.write,
    upload,
    notes,
    f.log,
    () => NOW,
  );
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, previous);
});
test("invalid upload fails before any credentialed request", () => {
  const f = fixture();
  assert.throws(() =>
    clients(
      "synthetic-token",
      { ...upload, signature: "invalid" },
      notes,
      f.log,
      f.request,
    ),
  );
  assert.equal(f.requests.length, 0);
});
test("foreign origins, resources, query injections and unauthorized related reads never receive token", async () => {
  const f = fixture();
  for (const path of [
    "https://evil.invalid/v1/apps/" + APP,
    "https://user@api.appstoreconnect.apple.com/v1/apps/" + APP,
    "/v1/apps/" + APP + "#fragment",
    "/v1/apps/foreign",
    b + "?include=app",
    b + "/betaGroups?limit=201",
    b + "/betaGroups?limit=200&limit=1",
    b + "/betaGroups?filter[app]=foreign",
    "/v1/appEncryptionDeclarations/foreign?include=app",
    "/v1/betaAppReviewSubmissions/foreign?include=build",
  ])
    await assert.rejects(f.client.get(path));
  assert.equal(f.requests.length, 0);
});
test("only build-bound declarations and review can be fetched", async () => {
  const f = fixture();
  f.state.review = true;
  await readSnapshot(f.client.get, upload, () => NOW);
  assert.ok(
    f.requests.some(
      (r) => r.path === "/v1/appEncryptionDeclarations/declaration",
    ),
  );
  assert.ok(
    f.requests.some((r) => r.path === "/v1/betaAppReviewSubmissions/review"),
  );
  const n = f.requests.length;
  await assert.rejects(
    f.client.get("/v1/appEncryptionDeclarations/foreign?include=app"),
  );
  assert.equal(f.requests.length, n);
});
test("forged beta bodies and all store or encryption writes fail before mutation", async () => {
  const f = fixture();
  for (const [method, path, body] of [
    ["DELETE", b, {}],
    ["PATCH", "/v1/appStoreVersions/foreign", {}],
    ["POST", "/v1/appEncryptionDeclarations", {}],
    ["PATCH", b, { data: { attributes: { usesNonExemptEncryption: false } } }],
    [
      "POST",
      b + "/relationships/betaGroups",
      { data: [{ type: "betaGroups", id: "foreign" }] },
    ],
    [
      "PATCH",
      "/v1/betaBuildLocalizations/english",
      { ...notesBody, extra: true },
    ],
    [
      "PATCH",
      "/v1/betaBuildLocalizations/english",
      { data: { ...notesBody.data, attributes: { whatsNew: "wrong" } } },
    ],
  ])
    await assert.rejects(f.client.write(method, path, body));
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, 0);
});
test("each write rereads state and refuses a build that changed after earlier inspection", async () => {
  const f = fixture();
  await readSnapshot(f.client.get, upload, () => NOW);
  f.state.processing = "INVALID";
  await assert.rejects(
    f.client.write("PATCH", "/v1/betaBuildLocalizations/english", notesBody),
  );
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, 0);
});
test("ambiguous write is journaled and cannot be repeated by this client", async () => {
  const f = fixture();
  f.state.failWrite = true;
  await assert.rejects(
    f.client.write("PATCH", "/v1/betaBuildLocalizations/english", notesBody),
    /Ambiguous/,
  );
  await assert.rejects(
    f.client.write("PATCH", "/v1/betaBuildLocalizations/english", notesBody),
    /already attempted/,
  );
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, 1);
  assert.equal(
    f.journal.filter((e) => e.stage === "beta-http-started").length,
    1,
  );
  assert.equal(
    f.journal.filter((e) => e.stage === "beta-http-returned").length,
    0,
  );
});
test("journal failure prevents the write", async () => {
  const f = fixture(),
    c = clients(
      "synthetic-token",
      upload,
      notes,
      async () => {
        throw Error("journal unavailable");
      },
      f.request,
      () => NOW,
    );
  await assert.rejects(
    c.write("PATCH", "/v1/betaBuildLocalizations/english", notesBody),
    /journal unavailable/,
  );
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, 0);
});
test("HTTP errors expose no response body and trigger no automatic retry", async () => {
  let calls = 0;
  const c = clients(
    "synthetic-token",
    upload,
    notes,
    async () => {},
    async () => {
      calls++;
      return {
        ok: false,
        status: 503,
        json: async () => {
          throw Error("must not read");
        },
      };
    },
    () => NOW,
  );
  await assert.rejects(
    c.get("/v1/apps/" + APP),
    /^Error: Apple request failed: HTTP 503$/,
  );
  assert.equal(calls, 1);
});
test("completed membership never authorizes duplicate group assignment", async () => {
  const f = fixture();
  f.state.notes = notes;
  f.state.groups = GROUPS.map((g) => g.id);
  f.state.review = true;
  await assert.rejects(
    f.client.write("POST", b + "/relationships/betaGroups", {
      data: GROUPS.map((g) => ({ type: "betaGroups", id: g.id })),
    }),
  );
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, 0);
});

test("membership reads require the documented exact app-and-build filter on every page", async () => {
  const f=fixture();
  for (const path of ["/v1/betaGroups?limit=200", "/v1/betaGroups?filter[app]="+APP,
    "/v1/betaGroups?filter[app]="+APP+"&filter[builds]=foreign",
    b+"/betaGroups?limit=200",
    "/v1/betaGroups?filter[app]="+APP+"&filter[builds]=synthetic-build&filter[builds]=foreign"])
    await assert.rejects(f.client.get(path));
  assert.equal(f.requests.length,0);
});

test("active prior review or unavailable prior state prevents any submission attempt", async () => {
  for (const flag of ["priorPending", "priorReadFails"]) {
    const f=fixture();f.state[flag]=true;f.state.notes=notes;f.state.groups=GROUPS.map(g=>g.id);
    await assert.rejects(applyDistribution(()=>readSnapshot(f.client.get,upload,()=>NOW),
      f.client.write,upload,notes,f.log,()=>NOW));
    assert.equal(f.requests.filter(r=>r.method!=="GET").length,0);
    assert.equal(f.journal.filter(e=>e.stage==="beta-http-started").length,0);
  }
});

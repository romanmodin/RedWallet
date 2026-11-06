import test from "node:test";
import assert from "node:assert/strict";
import {
  APP,
  GROUPS,
  planDistribution,
  applyDistribution,
} from "./kilowallet-v1-beta-plan.mjs";
// All values are synthetic; no Apple credentials, transport or real receipt.
const NOW = Date.parse("2026-11-04T08:00:00Z"),
  NOTES = "Synthetic 1.0 beta notes";
const upload = {
  uploadVerified: true,
  currentNativeGatesVerified: true,
  app: APP,
  marketingVersion: "1.0.0",
  signature: "verified",
  usesNonExemptEncryption: false,
  sourceCommit: "a".repeat(40),
  ipaSha256: "b".repeat(64),
  appleBuildId: "synthetic-v1-build",
  build: "999",
  runId: 123,
  runAttempt: 1,
};
function snapshot() {
  return {
    complete: true,
    observedAt: new Date(NOW).toISOString(),
    app: { id: APP, bundleId: "com.kilombino.kilowallet" },
    build: {
      id: upload.appleBuildId,
      appId: APP,
      version: "999",
      marketingVersion: "1.0.0",
      platform: "IOS",
      processingState: "VALID",
      expired: false,
      usesNonExemptEncryption: false,
      declarationId: "synthetic-declaration",
    },
    declaration: { id: "synthetic-declaration", appId: APP, state: "APPROVED" },
    internalState: "READY_FOR_BETA_TESTING",
    externalState: "READY_FOR_BETA_SUBMISSION",
    review: null,
    assignedGroups: [],
    groups: GROUPS.map((g) => ({
      id: g.id,
      name: g.name,
      appId: APP,
      isInternalGroup: g.internal,
      buildListComplete: true,
      buildIds: [],
    })),
    localizationsComplete: true,
    localizations: [],
  };
}
function assign(s) {
  s.assignedGroups = GROUPS.map((g) => g.id);
  s.groups.forEach((g) => (g.buildIds = [upload.appleBuildId]));
}
function notes(s) {
  s.localizations = [
    {
      id: "synthetic-localization",
      buildId: upload.appleBuildId,
      locale: "en-US",
      whatsNew: NOTES,
    },
  ];
}
function available() {
  const s = snapshot();
  assign(s);
  notes(s);
  s.internalState = s.externalState = "IN_BETA_TESTING";
  s.review = { buildId: upload.appleBuildId, state: "APPROVED" };
  return s;
}
const plan = (s) => planDistribution(s, upload, NOTES, NOW);

test("wrong release or unverified upload rejects before any injected read or write", async () => {
  for (const change of [
    { marketingVersion: "0.4.0" },
    { uploadVerified: false },
    { currentNativeGatesVerified: false },
    { app: "6817118871" },
    { usesNonExemptEncryption: true },
    { signature: "unchecked" },
    { sourceCommit: "bad" },
    { ipaSha256: "bad" },
    { appleBuildId: "../foreign" },
    { build: "0" },
    { runId: 0 },
    { runAttempt: 0 },
  ]) {
    let calls = 0;
    const fn = async () => {
      calls++;
      return snapshot();
    };
    await assert.rejects(
      applyDistribution(fn, fn, { ...upload, ...change }, NOTES, fn, () => NOW),
    );
    assert.equal(calls, 0);
  }
});
test("incomplete stale foreign expired or unapproved facts cannot plan writes", () => {
  const changes = [
    (s) => (s.complete = false),
    (s) => (s.observedAt = new Date(NOW - 300001).toISOString()),
    (s) => (s.observedAt = new Date(NOW + 1).toISOString()),
    (s) => (s.app.id = "foreign"),
    (s) => (s.app.bundleId = "foreign"),
    (s) => (s.build.id = "other"),
    (s) => (s.build.version = "3"),
    (s) => (s.build.marketingVersion = "0.4.0"),
    (s) => (s.build.appId = "other"),
    (s) => (s.build.platform = "MAC_OS"),
    (s) => (s.build.processingState = "PROCESSING"),
    (s) => (s.build.expired = true),
    (s) => (s.build.usesNonExemptEncryption = true),
    (s) => (s.declaration = null),
    (s) => (s.declaration.id = "other"),
    (s) => (s.declaration.appId = "other"),
    (s) => (s.declaration.state = "CREATED"),
    (s) => (s.declaration.state = "REJECTED"),
    (s) => (s.internalState = "MISSING_EXPORT_COMPLIANCE"),
    (s) => (s.externalState = "IN_EXPORT_COMPLIANCE_REVIEW"),
    (s) => (s.review = { buildId: "other", state: "APPROVED" }),
    (s) => (s.review = { buildId: upload.appleBuildId, state: "REJECTED" }),
    (s) => (s.externalState = "IN_BETA_TESTING"),
  ];
  for (const change of changes) {
    const s = snapshot();
    change(s);
    assert.throws(() => plan(s));
  }
});
test("complete original group identities and both membership directions are mandatory", () => {
  const changes = [
    (s) => s.groups.pop(),
    (s) => (s.groups[1] = s.groups[0]),
    (s) => (s.groups[0].appId = "other"),
    (s) => (s.groups[0].name = "other"),
    (s) => (s.groups[1].isInternalGroup = true),
    (s) => (s.groups[0].buildListComplete = false),
    (s) => (s.groups[0].buildIds = ["x", "x"]),
    (s) => (s.assignedGroups = ["foreign"]),
    (s) => (s.assignedGroups = [GROUPS[0].id, GROUPS[0].id]),
  ];
  for (const change of changes) {
    const s = snapshot();
    change(s);
    assert.throws(() => plan(s));
  }
});
test("one-sided membership is pending propagation and never triggers a repeated assignment", () => {
  for (const direction of ["build", "group"]) {
    const s = snapshot();
    notes(s);
    if (direction === "build") s.assignedGroups = [GROUPS[0].id];
    else s.groups[0].buildIds = [upload.appleBuildId];
    const p = plan(s);
    assert.equal(p.available, false);
    assert.equal(p.propagationPending, true);
    assert.deepEqual(p.writes, []);
  }
});
test("available requires exact approved build and both original groups in both directions", () => {
  const s = available();
  assert.equal(plan(s).available, true);
  assert.deepEqual(plan(s).writes, []);
  s.groups[1].buildIds = [];
  assert.equal(plan(s).available, false);
  s.groups[1].buildIds = [upload.appleBuildId];
  s.review.state = "IN_REVIEW";
  assert.equal(plan(s).available, false);
});
test("pending review is preserved without another submission", () => {
  const s = available();
  s.externalState = "WAITING_FOR_BETA_REVIEW";
  s.review.state = "WAITING_FOR_REVIEW";
  assert.equal(plan(s).available, false);
  assert.deepEqual(plan(s).writes, []);
});
test("localizations must be complete unique and bound to this build", () => {
  for (const change of [
    (s) => (s.localizationsComplete = false),
    (s) => (s.localizations[0].buildId = "other"),
    (s) => s.localizations.push({ ...s.localizations[0] }),
    (s) => s.localizations.push({ ...s.localizations[0], id: "different-id" }),
    (s) => (s.localizations[0].id = "../foreign"),
  ]) {
    const s = snapshot();
    notes(s);
    change(s);
    assert.throws(() => plan(s));
  }
  for (const value of ["", " ", "x".repeat(4001)])
    assert.throws(() => planDistribution(snapshot(), upload, value, NOW));
});
test("notes are idempotent and only exact build beta resources are planned", () => {
  const s = snapshot();
  const p = plan(s);
  assert.deepEqual(
    p.writes.map((w) => w.action),
    ["notes", "groups"],
  );
  assert.equal(
    p.writes[0].body.data.relationships.build.data.id,
    upload.appleBuildId,
  );
  assert.deepEqual(
    p.writes[1].body.data.map((d) => d.id),
    GROUPS.map((g) => g.id),
  );
  notes(s);
  assert.deepEqual(
    plan(s).writes.map((w) => w.action),
    ["groups"],
  );
  s.localizations[0].whatsNew = "old";
  assert.equal(plan(s).writes[0].method, "PATCH");
  assert.equal(
    plan(s).writes[0].path,
    "/v1/betaBuildLocalizations/synthetic-localization",
  );
  notes(s);
  assign(s);
  assert.deepEqual(
    plan(s).writes.map((w) => w.action),
    ["review"],
  );
  assert.equal(
    plan(s).writes[0].body.data.relationships.build.data.id,
    upload.appleBuildId,
  );
});
test("each write is durably journaled and re-read; three actions occur once only", async () => {
  const s = snapshot(),
    events = [],
    paths = [];
  const result = await applyDistribution(
    async () => structuredClone(s),
    async (method, path, body) => {
      assert.equal(events.at(-1).stage, "beta-write-started");
      paths.push(path);
      if (path === "/v1/betaBuildLocalizations") notes(s);
      else if (path.endsWith("/relationships/betaGroups")) {
        assert.deepEqual(
          body.data.map((d) => d.id),
          GROUPS.map((g) => g.id),
        );
        assign(s);
      } else {
        assert.equal(path, "/v1/betaAppReviewSubmissions");
        s.review = {
          buildId: upload.appleBuildId,
          state: "WAITING_FOR_REVIEW",
        };
        s.externalState = "WAITING_FOR_BETA_REVIEW";
      }
    },
    upload,
    NOTES,
    async (e) => events.push(e),
    () => NOW,
  );
  assert.equal(paths.length, 3);
  assert.equal(new Set(paths).size, 3);
  assert.equal(result.changed, true);
  assert.equal(result.available, false);
  assert.equal(
    events.filter((e) => e.stage === "beta-write-started").length,
    3,
  );
});
test("another completed action seen on fresh read is never duplicated", async () => {
  const s = snapshot();
  let reads = 0;
  const actions = [];
  await applyDistribution(
    async () => {
      if (++reads > 1) {
        notes(s);
        assign(s);
        s.review = { buildId: upload.appleBuildId, state: "APPROVED" };
        s.internalState = s.externalState = "IN_BETA_TESTING";
      }
      return structuredClone(s);
    },
    async (m, p) => actions.push(p),
    upload,
    NOTES,
    async () => {},
    () => NOW,
  );
  assert.deepEqual(actions, ["/v1/betaBuildLocalizations"]);
});
test("unpropagated successful write stops pending without repeat or premature review", async () => {
  const s = snapshot();
  notes(s);
  let writes = 0;
  const result = await applyDistribution(
    async () => structuredClone(s),
    async () => writes++,
    upload,
    NOTES,
    async () => {},
    () => NOW,
  );
  assert.equal(writes, 1);
  assert.equal(result.available, false);
});
test("ambiguous transport failure or failed durable journal never retries", async () => {
  let writes = 0;
  await assert.rejects(
    applyDistribution(
      async () => snapshot(),
      async () => {
        writes++;
        throw Error("ambiguous transport");
      },
      upload,
      NOTES,
      async () => {},
      () => NOW,
    ),
    /ambiguous/,
  );
  assert.equal(writes, 1);
  writes = 0;
  await assert.rejects(
    applyDistribution(
      async () => snapshot(),
      async () => writes++,
      upload,
      NOTES,
      async () => {
        throw Error("disk full");
      },
      () => NOW,
    ),
    /disk full/,
  );
  assert.equal(writes, 0);
});
test("compliance or identity changing between actions stops further writes", async () => {
  const s = snapshot();
  let writes = 0;
  await assert.rejects(
    applyDistribution(
      async () => structuredClone(s),
      async () => {
        writes++;
        notes(s);
        s.declaration.state = "REJECTED";
      },
      upload,
      NOTES,
      async () => {},
      () => NOW,
    ),
  );
  assert.equal(writes, 1);
});

test("supported false flag needs no invented declaration and rejects missing or contradictory facts", () => {
  const s = available(); s.build.declarationId = null; s.declaration = null;
  assert.equal(plan(s).available, true);
  for (const bad of [undefined, null, 0, "false", true]) {
    assert.throws(() => planDistribution(s, {...upload, usesNonExemptEncryption:bad}, NOTES,NOW));
    assert.throws(() => plan({...s,build:{...s.build,usesNonExemptEncryption:bad}}));
  }
  assert.throws(() => plan({...s,declaration:{id:"unbound",appId:APP,state:"APPROVED"}}));
  assert.throws(() => plan({...s,build:{...s.build,declarationId:undefined}}));
});

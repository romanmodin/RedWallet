import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP, BUILD } from "./kilowallet-compliance-plan.mjs";
import {
  GROUPS,
  planDistribution,
  applyDistribution,
} from "./kilowallet-beta-plan.mjs";
const actualPolicy = JSON.parse(
  readFileSync(
    new URL(
      "../release/KILOWALLET-040-COMPLIANCE-DRAFT-20261025.json",
      import.meta.url,
    ),
  ),
);
const draft = {
  ...actualPolicy,
  draft: true,
  availableOnFrenchStore: null,
  frenchIntentEvidence: null,
};
const policy = {
  ...draft,
  draft: false,
  availableOnFrenchStore: false,
  frenchIntentEvidence:
    "OFFLINE FIXTURE ONLY: synthetic policy, not publisher intent",
};
const upload = {
  uploadVerified: true,
  currentNativeGatesVerified: true,
  sourceCommit: draft.sourceCommit,
  ipaSha256: draft.ipaSha256,
  appleBuildId: BUILD,
  app: APP,
  runId: 40218593516,
  runAttempt: 1,
  marketingVersion: "0.4.0",
  build: "3",
  signature: "verified",
};
const now = Date.parse("2026-10-26T00:00:00Z");
function snapshot() {
  return {
    complete: true,
    observedAt: new Date(now).toISOString(),
    app: { id: APP, bundleId: "com.kilombino.kilowallet" },
    build: {
      id: BUILD,
      appId: APP,
      version: "3",
      marketingVersion: "0.4.0",
      processingState: "VALID",
      expired: false,
      declarationId: "fixture-declaration",
    },
    declaration: {
      id: "fixture-declaration",
      appId: APP,
      appDescription: policy.appDescription,
      availableOnFrenchStore: false,
      containsProprietaryCryptography: false,
      containsThirdPartyCryptography: true,
      exempt: true,
      state: "CREATED",
    },
    groups: GROUPS.map((id, i) => ({
      id,
      appId: APP,
      isInternalGroup: i === 0,
    })),
    assignedGroups: [],
    internalState: "READY_FOR_BETA_TESTING",
    externalState: "READY_FOR_BETA_SUBMISSION",
    review: null,
  };
}
test("real unresolved policy blocks all injected reads, writes and journal events", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    return snapshot();
  };
  await assert.rejects(
    applyDistribution(fn, fn, draft, upload, fn, () => now),
    /Draft/,
  );
  assert.equal(calls, 0);
});
test("foreign, incomplete, stale or unsafe facts never produce a distribution plan", () => {
  const changes = [
    (s) => (s.complete = false),
    (s) => (s.observedAt = new Date(now - 300001).toISOString()),
    (s) => (s.observedAt = new Date(now + 1).toISOString()),
    (s) => (s.build.id = "other"),
    (s) => (s.build.appId = "other"),
    (s) => (s.build.expired = true),
    (s) => (s.build.marketingVersion = "0.1"),
    (s) => (s.declaration = null),
    (s) => (s.declaration.state = "REJECTED"),
    (s) => (s.declaration.availableOnFrenchStore = true),
    (s) => (s.externalState = "MISSING_EXPORT_COMPLIANCE"),
    (s) => (s.internalState = "IN_EXPORT_COMPLIANCE_REVIEW"),
    (s) => (s.groups[0].appId = "other"),
    (s) => (s.groups[1].isInternalGroup = true),
    (s) => (s.assignedGroups = ["foreign"]),
    (s) => (s.assignedGroups = [GROUPS[0], GROUPS[0]]),
    (s) => (s.groups = [s.groups[0], s.groups[0]]),
    (s) => (s.review = { buildId: "other", state: "APPROVED" }),
    (s) => (s.review = { buildId: BUILD, state: "REJECTED" }),
    (s) => (s.externalState = "IN_BETA_TESTING"),
  ];
  for (const mutate of changes) {
    const s = snapshot();
    mutate(s);
    assert.throws(() => planDistribution(s, policy, upload, now));
  }
  assert.throws(() =>
    planDistribution(
      snapshot(),
      policy,
      { ...upload, signature: "unchecked" },
      now,
    ),
  );
});
test("only two existing group linkages and exact build review payload are planned", () => {
  const p = planDistribution(snapshot(), policy, upload, now);
  assert.equal(p.available, false);
  assert.deepEqual(p.writes[0], {
    method: "POST",
    path: "/v1/builds/" + BUILD + "/relationships/betaGroups",
    body: { data: GROUPS.map((id) => ({ type: "betaGroups", id })) },
  });
  assert.deepEqual(p.writes[1], {
    method: "POST",
    path: "/v1/betaAppReviewSubmissions",
    body: {
      data: {
        type: "betaAppReviewSubmissions",
        relationships: { build: { data: { type: "builds", id: BUILD } } },
      },
    },
  });
});
test("pending review is preserved and never reported as available", () => {
  const s = snapshot();
  s.assignedGroups = [...GROUPS];
  s.externalState = "WAITING_FOR_BETA_REVIEW";
  s.review = { buildId: BUILD, state: "WAITING_FOR_REVIEW" };
  const p = planDistribution(s, policy, upload, now);
  assert.equal(p.available, false);
  assert.equal(p.writes.length, 0);
});
test("availability requires both memberships, both testing states and approved review", () => {
  const s = snapshot();
  s.assignedGroups = [...GROUPS];
  s.internalState = s.externalState = "IN_BETA_TESTING";
  s.review = { buildId: BUILD, state: "APPROVED" };
  assert.equal(planDistribution(s, policy, upload, now).available, true);
  s.review.state = "IN_REVIEW";
  assert.equal(planDistribution(s, policy, upload, now).available, false);
  s.review.state = "APPROVED";
  s.assignedGroups.pop();
  assert.equal(planDistribution(s, policy, upload, now).available, false);
});
test("one assignment and review, journal before each write, pending final read stays pending", async () => {
  const s = snapshot(),
    events = [];
  const result = await applyDistribution(
    async () => structuredClone(s),
    async (method, path, body) => {
      assert.equal(events.at(-1).stage, "beta-write-started");
      if (path.endsWith("betaGroups"))
        s.assignedGroups = body.data.map((x) => x.id);
      else {
        s.review = { buildId: BUILD, state: "WAITING_FOR_REVIEW" };
        s.externalState = "WAITING_FOR_BETA_REVIEW";
      }
    },
    policy,
    upload,
    async (e) => events.push(e),
    () => now,
  );
  assert.equal(
    events.filter((e) => e.stage === "beta-write-started").length,
    2,
  );
  assert.equal(result.available, false);
  assert.equal(result.changed, true);
});
test("a fresh concurrent assignment is not duplicated or replayed", async () => {
  const s = snapshot();
  s.review = { buildId: BUILD, state: "APPROVED" };
  s.externalState = "BETA_APPROVED";
  let reads = 0,
    writes = 0;
  const result = await applyDistribution(
    async () => {
      reads++;
      if (reads > 1) s.assignedGroups = [...GROUPS];
      return structuredClone(s);
    },
    async () => writes++,
    policy,
    upload,
    async () => {},
    () => now,
  );
  assert.equal(writes, 0);
  assert.equal(result.changed, false);
});
test("ambiguous assignment failure propagates once, without review creation or retry", async () => {
  let writes = 0;
  await assert.rejects(
    applyDistribution(
      async () => snapshot(),
      async () => {
        writes++;
        throw Error("ambiguous transport");
      },
      policy,
      upload,
      async () => {},
      () => now,
    ),
    /ambiguous/,
  );
  assert.equal(writes, 1);
});
test("changed compliance facts or failed durable journal stop before transport", async () => {
  let reads = 0,
    writes = 0;
  const s = snapshot();
  await assert.rejects(
    applyDistribution(
      async () => {
        reads++;
        if (reads > 1) s.declaration.state = "REJECTED";
        return s;
      },
      async () => writes++,
      policy,
      upload,
      async () => {},
      () => now,
    ),
  );
  assert.equal(writes, 0);
  await assert.rejects(
    applyDistribution(
      async () => snapshot(),
      async () => writes++,
      policy,
      upload,
      async () => {
        throw Error("disk full");
      },
      () => now,
    ),
    /disk full/,
  );
  assert.equal(writes, 0);
});

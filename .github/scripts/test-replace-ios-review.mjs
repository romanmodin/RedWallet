import test from "node:test";
import assert from "node:assert/strict";
import {
  withdrawSupersededReview,
  REPLACEMENT_SOURCE,
  OLD_BUILD,
  OLD_REVIEW,
} from "./replace-ios-review.mjs";
const V = "65cd6bc4-9962-4b77-a3ca-78c115f3a615";
function fixture(overrides = {}) {
  const s = {
    state: "WAITING_FOR_REVIEW",
    reviewState: "WAITING_FOR_REVIEW",
    selected: OLD_BUILD,
    valid: true,
    delivered: true,
    itemVersion: V,
    extraReview: false,
    afterPatch: "COMPLETE",
    ...overrides,
  };
  const c = {
    sourceCommit: REPLACEMENT_SOURCE,
    appleBuildId: "new-build-id",
    build: "1792915404",
  };
  const writes = [];
  let reads = 0;
  const api = async (method, path, payload, query) => {
    if (method !== "GET") {
      writes.push({ method, path, payload });
      assert.equal(method, "PATCH");
      assert.equal(path, "/v1/reviewSubmissions/" + OLD_REVIEW);
      assert.deepEqual(payload, {
        data: {
          type: "reviewSubmissions",
          id: OLD_REVIEW,
          attributes: { canceled: true },
        },
      });
      if (s.throwAfterWrite) throw new Error("uncertain network outcome");
      s.reviewState = s.afterPatch;
      if (s.afterPatch === "COMPLETE") s.state = "DEVELOPER_REJECTED";
      return {};
    }
    assert.equal(
      path.endsWith("/betaGroups"),
      false,
      "Do not use Apple's rejected direct group route",
    );
    if (path === "/v1/builds/new-build-id" && query?.include === "betaGroups") {
      const all = [
        "0bc2722a-48b6-4520-871d-dd5a4a8988cb",
        "463ff340-3283-4f17-949d-39c7aa929da2",
      ].map((id) => ({ id, type: "betaGroups" }));
      const groups = s.missingGroup ? all.slice(0, 1) : all;
      return {
        data: {
          id: s.wrongGroupBuild ? "another-build" : c.appleBuildId,
          attributes: { version: c.build },
          relationships: {
            betaGroups: {
              data: s.unrelatedGroups ? [] : groups,
              ...(s.incompleteGroups ? { links: { next: "next-page" } } : {}),
            },
          },
        },
        included: groups,
      };
    }
    if (path === "/v1/builds/new-build-id") {
      reads++;
      if (s.changeBeforeWrite && reads === 2)
        s.selected = "unexpected-user-selection";
      return {
        data: {
          id: c.appleBuildId,
          attributes: {
            version: c.build,
            processingState: s.valid ? "VALID" : "PROCESSING",
            expired: false,
            usesNonExemptEncryption: false,
          },
        },
      };
    }
    if (path.endsWith("/items"))
      assert.equal(query?.include, "appStoreVersion");
    const r = { id: OLD_REVIEW, attributes: { state: s.reviewState } };
    const map = {
      "/v1/builds/new-build-id/app": { id: "6817118871" },
      "/v1/builds/new-build-id/preReleaseVersion": {
        attributes: { version: "8.0.1", platform: "IOS" },
      },
      "/v1/builds/new-build-id/buildBetaDetail": {
        attributes: {
          internalBuildState: "IN_BETA_TESTING",
          externalBuildState: s.delivered
            ? "IN_BETA_TESTING"
            : "WAITING_FOR_REVIEW",
        },
      },
      "/v1/builds/new-build-id/betaGroups": [
        "0bc2722a-48b6-4520-871d-dd5a4a8988cb",
        "463ff340-3283-4f17-949d-39c7aa929da2",
      ].map((id) => ({ id })),
      ["/v1/appStoreVersions/" + V]: {
        id: V,
        attributes: {
          versionString: "8.0.1",
          platform: "IOS",
          releaseType: "AFTER_APPROVAL",
          appStoreState: s.state,
        },
      },
      ["/v1/appStoreVersions/" + V + "/build"]: { id: s.selected },
      "/v1/apps/6817118871/reviewSubmissions": s.extraReview
        ? [r, { id: "unrelated", attributes: { state: "WAITING_FOR_REVIEW" } }]
        : [r],
      ["/v1/reviewSubmissions/" + OLD_REVIEW]: r,
      ["/v1/reviewSubmissions/" + OLD_REVIEW + "/items"]: [
        {
          id: "item",
          relationships: { appStoreVersion: { data: { id: s.itemVersion } } },
        },
      ],
    };
    assert.ok(path in map, "Unexpected operation " + path);
    return { data: structuredClone(map[path]) };
  };
  return { api, c, s, writes };
}
test("withdraws only the exact old review after replacement Apple and TestFlight checks", async () => {
  const f = fixture(),
    report = {};
  await withdrawSupersededReview(f.api, f.c, report);
  assert.equal(f.writes.length, 1);
  assert.equal(report.replacementStatus, "OLD_REVIEW_REMOVAL_VERIFIED");
  assert.equal(report.appStoreState, "DEVELOPER_REJECTED");
  // A repeat after confirmed removal only observes; it cannot cancel twice.
  await withdrawSupersededReview(f.api, f.c, {});
  assert.equal(f.writes.length, 1);
});
for (const [title, overrides, error] of [
  ["unprocessed build", { valid: false }, /not ready/],
  ["undelivered TestFlight", { delivered: false }, /TestFlight/],
  ["missing tester group", { missingGroup: true }, /TestFlight/],
  ["unrelated included groups", { unrelatedGroups: true }, /TestFlight/],
  ["incomplete group relationship", { incompleteGroups: true }, /TestFlight/],
  ["group response for another build", { wrongGroupBuild: true }, /TestFlight/],
  ["other selected build", { selected: "another-build" }, /unexpectedly/],
  ["another review", { extraReview: true }, /Another review/],
  [
    "another review item",
    { itemVersion: "other-version" },
    /other review items/,
  ],
  [
    "Apple already approved",
    { state: "PENDING_DEVELOPER_RELEASE", reviewState: "COMPLETE" },
    /not an editable/,
  ],
  [
    "selection changed during checks",
    { changeBeforeWrite: true },
    /changed before/,
  ],
])
  test(title + " prevents withdrawal", async () => {
    const f = fixture(overrides);
    await assert.rejects(withdrawSupersededReview(f.api, f.c, {}), error);
    assert.equal(f.writes.length, 0);
  });
test("stale source or the old build cannot authorize cancellation", async () => {
  const f = fixture();
  await assert.rejects(
    withdrawSupersededReview(f.api, { ...f.c, sourceCommit: "old" }, {}),
    /qualified release/,
  );
  await assert.rejects(
    withdrawSupersededReview(f.api, { ...f.c, appleBuildId: OLD_BUILD }, {}),
    /qualified release/,
  );
  assert.equal(f.writes.length, 0);
});
test("asynchronous cancellation remains pending without repeating its write", async () => {
  const f = fixture({ afterPatch: "CANCELING" }),
    r = {};
  await withdrawSupersededReview(f.api, f.c, r);
  assert.equal(r.replacementStatus, "WAITING_FOR_OLD_REVIEW_REMOVAL");
  assert.equal(f.writes.length, 1);
  await withdrawSupersededReview(f.api, f.c, {});
  assert.equal(f.writes.length, 1);
});
test("uncertain cancellation response is never retried in the invocation", async () => {
  const f = fixture({ throwAfterWrite: true });
  await assert.rejects(
    withdrawSupersededReview(f.api, f.c, {}),
    /uncertain network/,
  );
  assert.equal(f.writes.length, 1);
});
test("already submitted replacement is observed without any mutation", async () => {
  const f = fixture({ selected: "new-build-id" }),
    r = {};
  await withdrawSupersededReview(f.api, f.c, r);
  assert.equal(f.writes.length, 0);
  assert.equal(r.replacementStatus, "REPLACEMENT_ALREADY_SUBMITTED");
});

test("retained uncertain-write report prevents a second cancellation even if Apple still reports waiting", async () => {
  const f = fixture({ throwAfterWrite: true }),
    report = {};
  await assert.rejects(
    withdrawSupersededReview(f.api, f.c, report),
    /uncertain network/,
  );
  f.s.throwAfterWrite = false;
  await assert.rejects(
    withdrawSupersededReview(f.api, f.c, report),
    /Prior withdrawal outcome/,
  );
  assert.equal(f.writes.length, 1);
});

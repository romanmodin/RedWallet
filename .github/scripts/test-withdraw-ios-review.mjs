import test from "node:test";
import assert from "node:assert/strict";
import {
  withdrawalCandidate,
  withdrawalClient,
} from "./withdraw-ios-review.mjs";
import { REPLACEMENT_SOURCE, OLD_REVIEW } from "./replace-ios-review.mjs";
function fixture() {
  const prior = "9f627fb87b4b6cc28cddcf6ad45e2edc721551a8";
  const hash =
    "6551e126be45b9267d3fc54cf289c146b46a0ff39fcfcd2b233a8c5f323708aa";
  const ipa = {
    sourceCommit: REPLACEMENT_SOURCE,
    publicSourceCommit: REPLACEMENT_SOURCE,
    orchestrationCommit: "0c4885f252ac36596d28933552fa8bc2a73a4049",
    ipaSha256: hash,
    signatureVerification: "passed",
    sourceMappingVerification: "passed",
    bundles: [
      "com.romanmodin.redwallet",
      "com.romanmodin.redwallet.Stickers",
    ].map((bundleId) => ({
      bundleId,
      version: "8.0.1",
      build: "1792942297",
      architectures: ["arm64"],
    })),
  };
  const beta = {
    sourceCommit: REPLACEMENT_SOURCE,
    uploadRunId: "40206122168",
    ipaSha256: hash,
    appId: "6817118871",
    version: "8.0.1",
    build: "1792942297",
    appleBuildId: "fixture-new-build",
    processingState: "VALID",
    status: "AVAILABLE_TO_TESTERS",
    internalBuildState: "IN_BETA_TESTING",
    externalBuildState: "IN_BETA_TESTING",
    groups: [
      "0bc2722a-48b6-4520-871d-dd5a4a8988cb",
      "463ff340-3283-4f17-949d-39c7aa929da2",
    ].map((id) => ({ id, assigned: true })),
  };
  const shots = (n, prefix) => ({
    sourceCommit: prior,
    appId: "6817118871",
    version: "8.0.1",
    appStoreVersionId: "65cd6bc4-9962-4b77-a3ca-78c115f3a615",
    images: Array.from({ length: n }, (_, i) => ({
      id: prefix + i,
      state: "COMPLETE",
    })),
  });
  const main = {
    ...shots(8, "main"),
    sourceCommit: "14b44bf69a346e1a0787e6aed1f3d3343950a0f1",
    captureRunId: 40184204898,
    status: "SCREENSHOTS_REPLACED",
  };
  const stickers = {
    ...shots(2, "sticker"),
    captureRunId: 39319942381,
    status: "SCREENSHOTS_COMPLETE",
  };
  const capture = {
    sourceCommit: REPLACEMENT_SOURCE,
    captureRunId: 40206124543,
    captureAttempt: 1,
    visuallyReviewed: true,
    images: Array(8).fill({}),
  };
  const reuse = {
    replacementSourceCommit: REPLACEMENT_SOURCE,
    previousSourceCommit: prior,
    previousIosTree: "30e39cdee442e7d716cdc95de44ada6df2a523b7",
    replacementIosTree: "30e39cdee442e7d716cdc95de44ada6df2a523b7",
    newPackageVerificationPending: false,
  };
  return [ipa, beta, main, stickers, capture, reuse];
}
test("replacement readiness uses new signed build and preserves historical asset provenance", () => {
  const f = fixture();
  const c = withdrawalCandidate(...f);
  assert.equal(c.sourceCommit, REPLACEMENT_SOURCE);
  assert.equal(c.images.length, 10);
  assert.equal(c.appleBuildId, "fixture-new-build");
});
test("unavailable beta, changed package, unreviewed captures, or changed sticker source block withdrawal", () => {
  for (const mutate of [
    (f) => (f[0].ipaSha256 = "other"),
    (f) => f[0].bundles.pop(),
    (f) => (f[1].status = "BETA_REVIEW_PENDING"),
    (f) => (f[1].groups[1].assigned = false),
    (f) => (f[1].externalBuildState = "READY_FOR_BETA_TESTING"),
    (f) => (f[2].sourceCommit = REPLACEMENT_SOURCE),
    (f) => (f[3].images[0].state = "FAILED"),
    (f) => (f[4].visuallyReviewed = false),
    (f) => (f[5].replacementIosTree = "different"),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => withdrawalCandidate(...f));
  }
});
test("withdrawal client cannot select a build, submit, or cancel another review", async () => {
  const calls = [];
  const api = withdrawalClient("fixture-token", async (url, options) => {
    calls.push([url.pathname, options.method]);
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  });
  for (const [method, path, payload] of [
    ["PATCH", "/v1/reviewSubmissions/other", {}],
    ["POST", "/v1/reviewSubmissions", {}],
    [
      "PATCH",
      "/v1/reviewSubmissions/" + OLD_REVIEW,
      {
        data: {
          type: "reviewSubmissions",
          id: OLD_REVIEW,
          attributes: { submitted: true },
        },
      },
    ],
    [
      "PATCH",
      "/v1/appStoreVersions/65cd6bc4-9962-4b77-a3ca-78c115f3a615/relationships/build",
      {},
    ],
  ])
    await assert.rejects(api(method, path, payload), /cannot select/);
  assert.equal(calls.length, 0);
  await api("PATCH", "/v1/reviewSubmissions/" + OLD_REVIEW, {
    data: {
      type: "reviewSubmissions",
      id: OLD_REVIEW,
      attributes: { canceled: true },
    },
  });
  assert.equal(calls.length, 1);
});

test("safe withdrawal diagnostics retain only controlled errors", async () => {
  const { safeWithdrawalError } = await import("./withdraw-ios-review.mjs");
  const { SubmissionError } = await import("./submit-ios-store.mjs");
  const { ReplacementError } = await import("./replace-ios-review.mjs");
  assert.equal(
    safeWithdrawalError(new SubmissionError("Apple build is not ready")),
    "Apple build is not ready",
  );
  assert.equal(
    safeWithdrawalError(
      new ReplacementError("Another review must be preserved"),
    ),
    "Another review must be preserved",
  );
  assert.equal(
    safeWithdrawalError(new Error("PRIVATE TOKEN SECRET")),
    "Unexpected withdrawal failure; private raw diagnostics omitted",
  );
});

test("the previously withdrawn historical review cannot be canceled again", async () => {
  let calls = 0;
  const api = withdrawalClient("fixture", async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  });
  const id = "c2891ecc-4a54-4389-bf6a-05015df8d80f";
  await assert.rejects(
    api("PATCH", "/v1/reviewSubmissions/" + id, {
      data: { type: "reviewSubmissions", id, attributes: { canceled: true } },
    }),
    /cannot select/,
  );
  assert.equal(calls, 0);
});

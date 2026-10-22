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
    "4d0dc7e91c2acd01eac6d9efe07c574724c28c1483c663e013a8259d2bf5e77e";
  const ipa = {
    sourceCommit: REPLACEMENT_SOURCE,
    publicSourceCommit: REPLACEMENT_SOURCE,
    orchestrationCommit: "b881585e528a9d06b20f67b28a774bd540f3fd20",
    ipaSha256: hash,
    signatureVerification: "passed",
    sourceMappingVerification: "passed",
    bundles: [
      "com.romanmodin.redwallet",
      "com.romanmodin.redwallet.Stickers",
    ].map((bundleId) => ({
      bundleId,
      version: "8.0.1",
      build: "1792686194",
      architectures: ["arm64"],
    })),
  };
  const beta = {
    sourceCommit: REPLACEMENT_SOURCE,
    uploadRunId: "39799087741",
    ipaSha256: hash,
    appId: "6817118871",
    version: "8.0.1",
    build: "1792686194",
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
    captureRunId: 39312798717,
    status: "SCREENSHOTS_REPLACED",
  };
  const stickers = {
    ...shots(2, "sticker"),
    captureRunId: 39319942381,
    status: "SCREENSHOTS_COMPLETE",
  };
  const capture = {
    sourceCommit: REPLACEMENT_SOURCE,
    captureRunId: 39799093428,
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

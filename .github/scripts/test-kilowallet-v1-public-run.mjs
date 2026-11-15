import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APP,
  BUILD,
  BUILD_NUMBER,
  OLD_BUILD,
  POLICY_URL,
  SOURCE,
  client,
  planPublic,
  validateCandidate,
  validateRuntime,
} from "./kilowallet-v1-public-run.mjs";

function receipts() {
  const upload = {
    app: APP,
    sourceCommit: SOURCE,
    build: BUILD_NUMBER,
    marketingVersion: "1.0.0",
    appleBuildId: BUILD,
    ipaSha256: "3ed229d51d125a0259baed04dc804587d2d6e41d0ca5d7cc9f1d50e15f1a0539",
    artifactId: 14168451071,
    artifactSha256: "81f6d00d3e72de2e40656f53911be5b78495c6bba7898289428fc93d391c7359",
    runId: 43728038899,
    runAttempt: 1,
    signature: "verified",
    uploadVerified: true,
    currentNativeGatesVerified: true,
    usesNonExemptEncryption: false,
  };
  const beta = {
    action: "apply",
    app: APP,
    available: true,
    build: BUILD_NUMBER,
    buildId: BUILD,
    complete: true,
    coordinatorAttempt: 1,
    coordinatorCommit: "342b838c92399e0a73b82ed9f3c9bd4484480a8f",
    coordinatorRun: "43738317682",
    externalState: "IN_BETA_TESTING",
    internalState: "IN_BETA_TESTING",
    ipaSha256: upload.ipaSha256,
    marketingVersion: "1.0.0",
    memberships: [
      { id: "8f0948f4-86ef-4f7a-aa47-830a6e8f4eae", buildSide: true, groupSide: true },
      { id: "f4f2520c-3eaf-46f9-a31a-a36d38b74c53", buildSide: true, groupSide: true },
    ],
    propagationPending: false,
    review: { buildId: BUILD, state: "APPROVED" },
    sourceCommit: SOURCE,
    status: "AVAILABLE_TO_TESTERS",
    uploadRunAttempt: 1,
    uploadRunId: 43728038899,
  };
  return { upload, beta };
}

const metadata = {
  notes: "build 21 exact " + SOURCE + " synthetic",
  description: "PAY THROUGH JOINBLAKET",
};

test("accepts only the exact upload and TestFlight receipts", () => {
  const { upload, beta } = receipts();
  assert.equal(validateCandidate(upload, beta).appleBuildId, BUILD);
  assert.throws(() => validateCandidate({ ...upload, sourceCommit: "0".repeat(40) }, beta));
  assert.throws(() =>
    validateCandidate(upload, {
      ...beta,
      memberships: beta.memberships.slice(0, 1),
    }),
  );
  assert.throws(() => validateCandidate(upload, { ...beta, review: { buildId: BUILD, state: "WAITING_FOR_REVIEW" } }));
});

test("runtime is first-attempt exact-main and action bound", () => {
  const env = {
    GITHUB_REPOSITORY: "romanmodin/RedWallet",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF:
      "romanmodin/RedWallet/.github/workflows/kilowallet-v1-public.yml@refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "1",
    TEAM_ID: "PPG9C98EY9",
    KILOWALLET_V1_PUBLIC_ACTION: "inspect",
  };
  assert.equal(validateRuntime(env).action, "inspect");
  assert.throws(() => validateRuntime({ ...env, GITHUB_RUN_ATTEMPT: "2" }));
  assert.throws(() => validateRuntime({ ...env, KILOWALLET_V1_PUBLIC_ACTION: "delete" }));
});

test("withdrawal planner preserves the active exact version until qualified replacement", () => {
  const snapshot = {
    versionState: "WAITING_FOR_REVIEW",
    selectedBuild: OLD_BUILD,
    activeReview: { id: "review-1", state: "WAITING_FOR_REVIEW", itemId: "item-1" },
    screenshotsComplete: true,
    reviewNotes: "old",
    description: "old",
    privacyPolicyUrl: "old",
  };
  assert.deepEqual(planPublic(snapshot, "withdraw", metadata), {
    status: "WITHDRAWAL_REQUIRED",
    writes: [{ action: "withdraw-review", reviewId: "review-1" }],
  });
  assert.throws(() =>
    planPublic({ ...snapshot, selectedBuild: "unexpected" }, "withdraw", metadata),
  );
});

test("submission planner changes only the build and three metadata fields before one review", () => {
  const snapshot = {
    versionState: "DEVELOPER_REJECTED",
    selectedBuild: OLD_BUILD,
    activeReview: null,
    screenshotsComplete: true,
    reviewNotes: "old",
    description: "old",
    privacyPolicyUrl: "old",
  };
  assert.deepEqual(
    planPublic(snapshot, "submit", metadata).writes.map((x) => x.action),
    [
      "select-build",
      "review-notes",
      "description",
      "privacy-policy",
      "create-review",
      "create-review-item",
      "submit-review",
    ],
  );
  const done = {
    ...snapshot,
    versionState: "WAITING_FOR_REVIEW",
    selectedBuild: BUILD,
    activeReview: { id: "new-review", state: "WAITING_FOR_REVIEW" },
    reviewNotes: metadata.notes,
    description: metadata.description,
    privacyPolicyUrl: POLICY_URL,
  };
  assert.deepEqual(planPublic(done, "submit", metadata), {
    status: "SUBMITTED_FOR_APP_REVIEW",
    writes: [],
  });
});

test("submission planner safely resumes only the exact build-21 review draft", () => {
  const draft = {
    versionState: "PREPARE_FOR_SUBMISSION",
    selectedBuild: BUILD,
    activeReview: { id: "draft-review", state: "READY_FOR_REVIEW", itemId: null },
    screenshotsComplete: true,
    reviewNotes: metadata.notes,
    description: metadata.description,
    privacyPolicyUrl: POLICY_URL,
  };
  assert.deepEqual(planPublic(draft, "submit", metadata), {
    status: "SUBMISSION_RESUME",
    writes: [
      { action: "create-review-item" },
      { action: "submit-review", reviewId: "draft-review" },
    ],
  });
  assert.deepEqual(
    planPublic(
      { ...draft, activeReview: { ...draft.activeReview, itemId: "exact-item" } },
      "submit",
      metadata,
    ),
    {
      status: "SUBMISSION_RESUME",
      writes: [{ action: "submit-review", reviewId: "draft-review" }],
    },
  );
  assert.throws(() =>
    planPublic(
      { ...draft, selectedBuild: OLD_BUILD },
      "submit",
      metadata,
    ),
  );
  assert.throws(() =>
    planPublic(
      { ...draft, activeReview: { ...draft.activeReview, state: "CANCELING" } },
      "submit",
      metadata,
    ),
  );
});

test("Apple client rejects other apps, deletion, agreements, availability and privacy questionnaires", async () => {
  const r = receipts();
  let calls = 0;
  const api = client(
    "token",
    r,
    async () => {},
    async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    },
  );
  for (const operation of [
    () => api("GET", "/v1/apps/6817118871"),
    () => api("DELETE", "/v1/apps/" + APP),
    () => api("PATCH", "/v1/apps/" + APP, { data: {} }),
    () => api("GET", "/v1/agreements"),
    () => api("PATCH", "/v1/appAvailabilities/" + APP, { data: {} }),
    () => api("PATCH", "/v1/appDataUsages/anything", { data: {} }),
  ]) {
    await assert.rejects(operation);
  }
  assert.equal(calls, 0);
});

test("reviewed metadata is bounded and accurately discloses RC6 limits", () => {
  const notes = readFileSync("distribution/kilowallet/RC6_APP_REVIEW_NOTES.txt", "utf8");
  const description = readFileSync(
    "distribution/kilowallet/RC6_APP_STORE_DESCRIPTION.txt",
    "utf8",
  );
  const privacy = readFileSync("distribution/kilowallet/RC6_PRIVACY.md", "utf8");
  assert.ok(notes.length <= 4000);
  assert.ok(description.length <= 4000);
  for (const text of [notes, description, privacy]) {
    assert.match(text, /PAY THROUGH JOINBLAKET/);
  }
  assert.match(notes, /synthetic wallets/);
  assert.match(notes, /not been installed on a physical iPhone/);
  assert.match(notes, /no real JoinBlaket payment/);
  assert.match(privacy, /wallet-scoped history/);
  assert.match(privacy, /fails rather than falling back to a direct directory connection/);
});

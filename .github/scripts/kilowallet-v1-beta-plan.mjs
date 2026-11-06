import assert from "node:assert/strict";

export const APP = "6824331953";
export const GROUPS = Object.freeze([
  Object.freeze({
    id: "8f0948f4-86ef-4f7a-aa47-830a6e8f4eae",
    name: "Kilowallet Internal",
    internal: true,
  }),
  Object.freeze({
    id: "f4f2520c-3eaf-46f9-a31a-a36d38b74c53",
    name: "Kilowallet Public Beta",
    internal: false,
  }),
]);
// Offline planner only. No CLI, credentials, transport, or active workflow.
export function validateUpload(upload) {
  assert.equal(upload.uploadVerified, true);
  assert.equal(upload.currentNativeGatesVerified, true);
  assert.equal(upload.app, APP);
  assert.equal(upload.marketingVersion, "1.0.0");
  assert.equal(upload.signature, "verified");
  assert.equal(
    upload.usesNonExemptEncryption,
    false,
    "Signed 1.0 encryption flag required",
  );
  assert.match(upload.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(upload.ipaSha256, /^[0-9a-f]{64}$/);
  assert.match(upload.appleBuildId, /^[a-zA-Z0-9-]+$/);
  assert.match(upload.build, /^[1-9][0-9]*$/);
  assert.ok(Number.isSafeInteger(upload.runId) && upload.runId > 0);
  assert.ok(Number.isSafeInteger(upload.runAttempt) && upload.runAttempt > 0);
}

function unique(values, description) {
  assert.ok(Array.isArray(values), description);
  assert.equal(new Set(values).size, values.length, description);
}

export function planDistribution(snapshot, upload, notes, now = Date.now()) {
  validateUpload(upload);
  assert.equal(typeof notes, "string");
  assert.ok(
    notes.trim().length > 0 && Buffer.byteLength(notes, "utf8") <= 4000,
  );
  const s = snapshot,
    id = upload.appleBuildId;
  assert.equal(s.complete, true, "Complete live snapshot required");
  const observed = Date.parse(s.observedAt);
  assert.ok(
    Number.isFinite(observed) && now >= observed && now - observed <= 300000,
    "Fresh Apple snapshot required",
  );
  assert.equal(s.app?.id, APP);
  assert.equal(s.app?.bundleId, "com.kilombino.kilowallet");
  for (const [key, value] of Object.entries({
    id,
    appId: APP,
    version: upload.build,
    marketingVersion: "1.0.0",
    platform: "IOS",
    processingState: "VALID",
    expired: false,
    usesNonExemptEncryption: false,
  }))
    assert.equal(
      s.build?.[key],
      value,
      "Mismatched or unavailable build: " + key,
    );
  // The signed build and live Apple flag must both be the supported Boolean false.
  // No declaration is created, attached or changed by beta distribution.
  if (s.build.declarationId !== null) {
    assert.ok(s.declaration?.id === s.build.declarationId);
    assert.equal(s.declaration.appId, APP);
    assert.equal(s.declaration.state, "APPROVED");
  } else assert.equal(s.declaration, null);
  assert.ok(
    ["READY_FOR_BETA_TESTING", "IN_BETA_TESTING"].includes(s.internalState),
  );
  assert.ok(
    [
      "READY_FOR_BETA_SUBMISSION",
      "WAITING_FOR_BETA_REVIEW",
      "IN_BETA_REVIEW",
      "BETA_APPROVED",
      "READY_FOR_BETA_TESTING",
      "IN_BETA_TESTING",
    ].includes(s.externalState),
  );
  if (s.review) {
    assert.equal(s.review.buildId, id);
    assert.ok(
      ["WAITING_FOR_REVIEW", "IN_REVIEW", "APPROVED"].includes(s.review.state),
    );
  }
  if (s.externalState !== "READY_FOR_BETA_SUBMISSION")
    assert.ok(s.review, "Missing beta review evidence");

  assert.equal(s.groups?.length, 2);
  unique(
    s.groups.map((g) => g.id),
    "Duplicate groups",
  );
  unique(s.assignedGroups, "Incomplete or duplicate build-side memberships");
  assert.ok(
    s.assignedGroups.every((g) => GROUPS.some((e) => e.id === g)),
    "Unexpected group assignment",
  );
  const memberships = GROUPS.map((expected) => {
    const actual = s.groups.find((g) => g.id === expected.id);
    assert.ok(actual, "Missing original group");
    assert.equal(actual.appId, APP);
    assert.equal(actual.name, expected.name);
    assert.equal(actual.isInternalGroup, expected.internal);
    assert.equal(
      actual.buildListComplete,
      true,
      "Incomplete group-side membership list",
    );
    unique(actual.buildIds, "Duplicate group-side builds");
    return {
      id: expected.id,
      buildSide: s.assignedGroups.includes(expected.id),
      groupSide: actual.buildIds.includes(id),
    };
  });
  assert.equal(s.localizationsComplete, true);
  unique(
    s.localizations?.map((l) => l.id),
    "Duplicate localization IDs",
  );
  unique(
    s.localizations.map((l) => l.locale),
    "Duplicate localization locales",
  );
  for (const loc of s.localizations) {
    assert.match(loc.id, /^[a-zA-Z0-9-]+$/);
    assert.equal(loc.buildId, id, "Foreign localization");
  }
  const english = s.localizations.find((l) => l.locale === "en-US");
  const writes = [];
  const propagationPending = memberships.some(
    (m) => m.buildSide !== m.groupSide,
  );
  if (english?.whatsNew !== notes)
    writes.push(
      english
        ? {
            action: "notes",
            method: "PATCH",
            path: "/v1/betaBuildLocalizations/" + english.id,
            body: {
              data: {
                type: "betaBuildLocalizations",
                id: english.id,
                attributes: { whatsNew: notes },
              },
            },
          }
        : {
            action: "notes",
            method: "POST",
            path: "/v1/betaBuildLocalizations",
            body: {
              data: {
                type: "betaBuildLocalizations",
                attributes: { locale: "en-US", whatsNew: notes },
                relationships: { build: { data: { type: "builds", id } } },
              },
            },
          },
    );
  // A one-sided membership is propagation, not permission to repeat assignment.
  if (!propagationPending) {
    const missing = memberships
      .filter((m) => !m.buildSide && !m.groupSide)
      .map((m) => m.id);
    if (missing.length)
      writes.push({
        action: "groups",
        method: "POST",
        path: "/v1/builds/" + id + "/relationships/betaGroups",
        body: {
          data: missing.map((groupId) => ({ type: "betaGroups", id: groupId })),
        },
      });
    if (
      !missing.length &&
      s.externalState === "READY_FOR_BETA_SUBMISSION" &&
      !s.review
    )
      writes.push({
        action: "review",
        method: "POST",
        path: "/v1/betaAppReviewSubmissions",
        body: {
          data: {
            type: "betaAppReviewSubmissions",
            relationships: { build: { data: { type: "builds", id } } },
          },
        },
      });
  }
  const available =
    memberships.every((m) => m.buildSide && m.groupSide) &&
    s.internalState === "IN_BETA_TESTING" &&
    s.externalState === "IN_BETA_TESTING" &&
    s.review?.state === "APPROVED";
  return {
    app: APP,
    buildId: id,
    build: upload.build,
    marketingVersion: "1.0.0",
    sourceCommit: upload.sourceCommit,
    ipaSha256: upload.ipaSha256,
    memberships,
    internalState: s.internalState,
    externalState: s.externalState,
    review: s.review,
    available,
    propagationPending,
    writes,
    status: available ? "AVAILABLE_TO_TESTERS" : "PENDING_APPLE_OR_ASSIGNMENT",
  };
}

export async function applyDistribution(
  readSnapshot,
  write,
  upload,
  notes,
  journal,
  now = () => Date.now(),
) {
  validateUpload(upload); // Reject wrong release before even an injected read.
  const attempted = new Set();
  for (let pass = 0; pass < 4; pass++) {
    const plan = planDistribution(await readSnapshot(), upload, notes, now());
    const operation = plan.writes[0];
    if (!operation || attempted.has(operation.action))
      return { ...plan, changed: attempted.size > 0 };
    // Fresh facts on every action; no retry after an ambiguous transport result.
    await journal({
      stage: "beta-write-started",
      app: APP,
      buildId: upload.appleBuildId,
      ...operation,
    });
    attempted.add(operation.action);
    await write(operation.method, operation.path, operation.body);
    await journal({
      stage: "beta-write-returned",
      action: operation.action,
      path: operation.path,
    });
  }
  const plan = planDistribution(await readSnapshot(), upload, notes, now());
  return { ...plan, changed: attempted.size > 0 };
}

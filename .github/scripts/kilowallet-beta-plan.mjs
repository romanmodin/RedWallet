import assert from "node:assert/strict";
import {
  APP,
  BUILD,
  declarationPayload,
} from "./kilowallet-compliance-plan.mjs";
export const GROUPS = Object.freeze([
  "8f0948f4-86ef-4f7a-aa47-830a6e8f4eae",
  "f4f2520c-3eaf-46f9-a31a-a36d38b74c53",
]);
// Offline/injected operations only. No CLI, credentials, transport, or workflow activation.
export function planDistribution(snapshot, policy, upload, now = Date.now()) {
  declarationPayload(policy, upload);
  const s = snapshot;
  assert.equal(s.complete, true, "Complete live snapshot required");
  assert.ok(
    Number.isFinite(Date.parse(s.observedAt)) &&
      now - Date.parse(s.observedAt) >= 0 &&
      now - Date.parse(s.observedAt) <= 300000,
    "Fresh Apple facts required",
  );
  assert.equal(s.app?.id, APP);
  assert.equal(s.app?.bundleId, "com.kilombino.kilowallet");
  assert.equal(s.build?.id, BUILD);
  assert.equal(s.build?.appId, APP);
  assert.equal(s.build?.version, "3");
  assert.equal(s.build?.marketingVersion, "0.4.0");
  assert.equal(s.build?.processingState, "VALID");
  assert.equal(s.build?.expired, false);
  assert.ok(
    s.declaration?.id && s.declaration.id === s.build.declarationId,
    "Associated declaration required",
  );
  const d = s.declaration;
  assert.equal(d.appId, APP);
  for (const k of [
    "appDescription",
    "availableOnFrenchStore",
    "containsProprietaryCryptography",
    "containsThirdPartyCryptography",
  ])
    assert.equal(d[k], policy[k], "Declaration differs from reviewed policy");
  assert.ok(
    d.state === "APPROVED" ||
      (d.exempt === true && [null, undefined, "CREATED"].includes(d.state)),
    "Apple compliance not ready",
  );
  assert.ok(
    ["READY_FOR_BETA_TESTING", "IN_BETA_TESTING"].includes(s.internalState),
    "Internal beta blocked",
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
    "External beta blocked",
  );
  assert.ok(
    Array.isArray(s.groups) && s.groups.length === 2,
    "Only both original groups may be assigned",
  );
  for (let i = 0; i < 2; i++) {
    const found = s.groups.filter((g) => g.id === GROUPS[i]);
    assert.equal(found.length, 1);
    assert.equal(found[0].appId, APP);
    assert.equal(found[0].isInternalGroup, i === 0);
  }
  assert.ok(
    Array.isArray(s.assignedGroups) &&
      new Set(s.assignedGroups).size === s.assignedGroups.length,
  );
  assert.ok(
    s.assignedGroups.every((g) => GROUPS.includes(g)),
    "Unexpected existing assignment; preserve for review",
  );
  if (s.review) {
    assert.equal(s.review.buildId, BUILD);
    assert.ok(
      ["WAITING_FOR_REVIEW", "IN_REVIEW", "APPROVED"].includes(s.review.state),
      "Rejected or unknown beta review",
    );
  }
  if (
    [
      "WAITING_FOR_BETA_REVIEW",
      "IN_BETA_REVIEW",
      "BETA_APPROVED",
      "IN_BETA_TESTING",
    ].includes(s.externalState)
  )
    assert.ok(s.review, "Missing beta review facts");
  const missing = GROUPS.filter((g) => !s.assignedGroups.includes(g)),
    writes = [];
  if (missing.length)
    writes.push({
      method: "POST",
      path: "/v1/builds/" + BUILD + "/relationships/betaGroups",
      body: { data: missing.map((id) => ({ type: "betaGroups", id })) },
    });
  if (s.externalState === "READY_FOR_BETA_SUBMISSION" && !s.review)
    writes.push({
      method: "POST",
      path: "/v1/betaAppReviewSubmissions",
      body: {
        data: {
          type: "betaAppReviewSubmissions",
          relationships: { build: { data: { type: "builds", id: BUILD } } },
        },
      },
    });
  const available =
    missing.length === 0 &&
    s.internalState === "IN_BETA_TESTING" &&
    s.externalState === "IN_BETA_TESTING" &&
    s.review?.state === "APPROVED";
  return {
    app: APP,
    buildId: BUILD,
    writes,
    available,
    status: available ? "AVAILABLE_TO_TESTERS" : "PENDING_APPLE_OR_ASSIGNMENT",
  };
}
export async function applyDistribution(
  readSnapshot,
  write,
  policy,
  upload,
  journal,
  now = () => Date.now(),
) {
  declarationPayload(policy, upload); // Draft/unknown intent fails before reads or writes.
  const initial = planDistribution(await readSnapshot(), policy, upload, now());
  let changed = false;
  for (const operation of initial.writes) {
    const current = planDistribution(
      await readSnapshot(),
      policy,
      upload,
      now(),
    );
    const fresh = current.writes.find((w) => w.path === operation.path);
    if (!fresh) continue; // Another verified operation already completed; never duplicate it.
    // Use only current missing memberships; never replay a stale payload.
    await journal({
      stage: "beta-write-started",
      app: APP,
      buildId: BUILD,
      method: fresh.method,
      path: fresh.path,
      body: fresh.body,
    });
    await write(fresh.method, fresh.path, fresh.body); // Propagate ambiguous outcomes, never retry.
    changed = true;
    await journal({ stage: "beta-write-returned", path: fresh.path });
  }
  const after = planDistribution(await readSnapshot(), policy, upload, now());
  return { ...after, changed }; // Pending Apple states never imply availability.
}

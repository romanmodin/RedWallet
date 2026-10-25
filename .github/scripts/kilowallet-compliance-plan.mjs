import assert from "node:assert/strict";
export const APP = "6824331953",
  BUILD = "19c6e86c-079e-4022-9a11-a9ab4f23c3ba";
const SOURCE = "7c38da214682544e13ba81f472a0d1038a4d4426";
const IPA = "022d7f55a7e24607ab4ff0e84af43b5d20f23ccc789d700e2acc6c6504b2b2fd";
export function declarationPayload(policy, upload) {
  assert.equal(policy.draft, false, "Draft policy cannot authorize changes");
  assert.equal(
    typeof policy.availableOnFrenchStore,
    "boolean",
    "French App Store intent is unresolved",
  );
  assert.equal(
    typeof policy.frenchIntentEvidence,
    "string",
    "French intent evidence is required",
  );
  assert.ok(
    policy.frenchIntentEvidence.trim().length >= 20,
    "French intent evidence is required",
  );
  assert.equal(policy.containsProprietaryCryptography, false);
  assert.equal(policy.containsThirdPartyCryptography, true);
  assert.equal(policy.app, APP);
  assert.equal(policy.appleBuildId, BUILD);
  assert.equal(policy.sourceCommit, SOURCE);
  assert.equal(policy.ipaSha256, IPA);
  assert.equal(
    upload.uploadVerified,
    true,
    "Actual upload qualification is required",
  );
  assert.equal(upload.sourceCommit, SOURCE);
  assert.equal(upload.ipaSha256, IPA);
  assert.equal(upload.appleBuildId, BUILD);
  assert.equal(upload.app, APP);
  assert.equal(upload.runId, 40218593516);
  assert.equal(upload.runAttempt, 1);
  assert.equal(upload.marketingVersion, "0.4.0");
  assert.equal(upload.build, "3");
  assert.equal(upload.signature, "verified");
  assert.equal(upload.currentNativeGatesVerified, true);
  assert.equal(typeof policy.appDescription, "string");
  assert.ok(
    policy.appDescription.length > 30 && policy.appDescription.length <= 2000,
  );
  assert.ok(
    !Object.hasOwn(policy, "exempt"),
    "Exemption is an Apple response, never an input",
  );
  return {
    data: {
      type: "appEncryptionDeclarations",
      attributes: {
        appDescription: policy.appDescription,
        availableOnFrenchStore: policy.availableOnFrenchStore,
        containsProprietaryCryptography: false,
        containsThirdPartyCryptography: true,
      },
      relationships: { app: { data: { type: "apps", id: APP } } },
    },
  };
}
export function checkBuild(body) {
  const b = body.data;
  assert.equal(b?.id, BUILD);
  assert.equal(b?.type, "builds");
  assert.equal(b.attributes?.version, "3");
  assert.equal(b.attributes?.processingState, "VALID");
  assert.equal(b.attributes?.expired, false);
  assert.equal(b.relationships?.app?.data?.id, APP);
  return b;
}
function matches(d, payload) {
  const p = payload.data.attributes;
  return (
    d.type === "appEncryptionDeclarations" &&
    d.relationships?.app?.data?.id === APP &&
    Object.entries(p).every(([k, v]) => d.attributes?.[k] === v)
  );
}
export async function applyDeclaration(get, write, policy, upload, journal) {
  const payload = declarationPayload(policy, upload); // unresolved intent fails before any request
  const b = checkBuild(
    await get("/v1/builds/" + BUILD + "?include=app,appEncryptionDeclaration"),
  );
  const current = b.relationships?.appEncryptionDeclaration?.data;
  const list = await get(
    "/v1/appEncryptionDeclarations?filter%5Bapp%5D=" +
      APP +
      "&limit=200&include=app",
  );
  assert.ok(
    Array.isArray(list.data) && !list.links?.next,
    "Complete declarations required",
  );
  const found = list.data.filter((d) => matches(d, payload));
  assert.ok(found.length <= 1, "Ambiguous matching declarations");
  let d = found[0];
  if (current) {
    assert.equal(current.type, "appEncryptionDeclarations");
    assert.ok(
      d && d.id === current.id,
      "Different declaration is already attached",
    );
    await journal({ stage: "already-attached", declarationId: d.id });
    return { declarationId: d.id, attached: true, changed: false };
  }
  if (!d) {
    // A journal must be durably retained by the eventual protected workflow.
    // Once a write starts, exceptions propagate. Never retry an ambiguous write.
    await journal({ stage: "create-started", app: APP, build: BUILD });
    d = (await write("POST", "/v1/appEncryptionDeclarations", payload)).data;
    assert.ok(matches(d, payload), "Apple returned a different declaration");
    assert.ok(typeof d.id === "string" && /^[A-Za-z0-9-]+$/.test(d.id));
    await journal({
      stage: "created",
      declarationId: d.id,
      exempt: d.attributes.exempt,
      state: d.attributes.appEncryptionDeclarationState,
    });
  }
  const state = d.attributes.appEncryptionDeclarationState;
  const ready =
    state === "APPROVED" ||
    (d.attributes.exempt === true &&
      [null, undefined, "CREATED"].includes(state));
  if (!ready) {
    await journal({
      stage: "apple-review-or-documentation-required",
      declarationId: d.id,
    });
    return {
      declarationId: d.id,
      attached: false,
      changed: true,
      blocked: true,
    };
  }
  const fresh = checkBuild(
    await get("/v1/builds/" + BUILD + "?include=app,appEncryptionDeclaration"),
  );
  assert.equal(
    fresh.relationships?.appEncryptionDeclaration?.data,
    null,
    "Build declaration changed before attachment",
  );
  await journal({ stage: "attach-started", declarationId: d.id });
  await write(
    "PATCH",
    "/v1/builds/" + BUILD + "/relationships/appEncryptionDeclaration",
    { data: { type: "appEncryptionDeclarations", id: d.id } },
  );
  const after = checkBuild(
    await get("/v1/builds/" + BUILD + "?include=app,appEncryptionDeclaration"),
  );
  assert.equal(
    after.relationships?.appEncryptionDeclaration?.data?.id,
    d.id,
    "Attachment not verified",
  );
  await journal({ stage: "attachment-verified", declarationId: d.id });
  return { declarationId: d.id, attached: true, changed: true };
}
// Deliberately no CLI, token loading, HTTP write client, workflow, or automatic execution.
// Activation needs a reviewed protected workflow and verified French distribution intent.

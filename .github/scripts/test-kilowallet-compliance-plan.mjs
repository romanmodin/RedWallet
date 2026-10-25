import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APP,
  BUILD,
  declarationPayload,
  applyDeclaration,
} from "./kilowallet-compliance-plan.mjs";
const draft = JSON.parse(
  readFileSync(
    new URL(
      "../release/KILOWALLET-040-COMPLIANCE-DRAFT-20261025.json",
      import.meta.url,
    ),
  ),
);
function policy() {
  return {
    ...draft,
    draft: false,
    availableOnFrenchStore: false,
    frenchIntentEvidence: "OFFLINE FIXTURE ONLY: no French store intent",
  };
}
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
function build(attached = null) {
  return {
    data: {
      id: BUILD,
      type: "builds",
      attributes: { version: "3", processingState: "VALID", expired: false },
      relationships: {
        app: { data: { id: APP, type: "apps" } },
        appEncryptionDeclaration: { data: attached },
      },
    },
  };
}
function declaration(exempt = true) {
  const p = declarationPayload(policy(), upload).data;
  return {
    ...p,
    id: "fixture-declaration",
    attributes: {
      ...p.attributes,
      exempt,
      appEncryptionDeclarationState: "CREATED",
    },
  };
}
test("actual unresolved draft cannot authorize even a read or token-dependent operation", async () => {
  let calls = 0;
  await assert.rejects(
    applyDeclaration(
      async () => {
        calls++;
      },
      async () => {
        calls++;
      },
      draft,
      upload,
      async () => {
        calls++;
      },
    ),
    /Draft/,
  );
  assert.equal(calls, 0);
});
test("unknown French intent, missing evidence, fabricated exemption and unqualified package are rejected", () => {
  for (const p of [
    { ...policy(), availableOnFrenchStore: null },
    { ...policy(), frenchIntentEvidence: null },
    { ...policy(), exempt: true },
  ])
    assert.throws(() => declarationPayload(p, upload));
  for (const u of [
    { ...upload, currentNativeGatesVerified: false },
    { ...upload, ipaSha256: "bad" },
    { ...upload, appleBuildId: "other" },
    { ...upload, signature: "unchecked" },
  ])
    assert.throws(() => declarationPayload(policy(), u));
});
test("published standard algorithms are declared explicitly; no exemption is sent", () => {
  const a = declarationPayload(policy(), upload).data.attributes;
  assert.equal(a.containsThirdPartyCryptography, true);
  assert.equal(a.containsProprietaryCryptography, false);
  assert.deepEqual(
    Object.keys(a).sort(),
    [
      "appDescription",
      "availableOnFrenchStore",
      "containsProprietaryCryptography",
      "containsThirdPartyCryptography",
    ].sort(),
  );
});
test("one create and one attach only after actual Apple exemption; final association must be read back", async () => {
  let attached = null;
  const writes = [],
    events = [];
  const d = declaration();
  const get = async (p) =>
    p.startsWith("/v1/builds/") ? build(attached) : { data: [] };
  const write = async (method, path, body) => {
    writes.push({ method, path, body });
    if (method === "POST") return { data: d };
    attached = { type: "appEncryptionDeclarations", id: d.id };
    return {};
  };
  const result = await applyDeclaration(
    get,
    write,
    policy(),
    upload,
    async (e) => events.push(e),
  );
  assert.equal(result.attached, true);
  assert.deepEqual(
    writes.map((w) => w.method),
    ["POST", "PATCH"],
  );
  assert.equal(events.at(-1).stage, "attachment-verified");
});
test("Apple documentation requirement blocks attachment without assuming exemption", async () => {
  const writes = [];
  const d = declaration(false);
  const result = await applyDeclaration(
    async (p) => (p.startsWith("/v1/builds/") ? build() : { data: [] }),
    async (m) => {
      writes.push(m);
      return { data: d };
    },
    policy(),
    upload,
    async () => {},
  );
  assert.equal(result.blocked, true);
  assert.deepEqual(writes, ["POST"]);
});
test("ambiguous write failure is propagated without a retry or attach", async () => {
  let writes = 0;
  await assert.rejects(
    applyDeclaration(
      async (p) => (p.startsWith("/v1/builds/") ? build() : { data: [] }),
      async () => {
        writes++;
        throw Error("ambiguous transport outcome");
      },
      policy(),
      upload,
      async () => {},
    ),
    /ambiguous/,
  );
  assert.equal(writes, 1);
});
test("existing matching declaration is reused, foreign attachment or pagination fail before writes", async () => {
  const d = declaration();
  let attached = null;
  const writes = [];
  const get = async (p) =>
    p.startsWith("/v1/builds/") ? build(attached) : { data: [d] };
  await applyDeclaration(
    get,
    async (m, p, b) => {
      writes.push(m);
      attached = b.data;
      return {};
    },
    policy(),
    upload,
    async () => {},
  );
  assert.deepEqual(writes, ["PATCH"]);
  await assert.rejects(
    applyDeclaration(
      async (p) =>
        p.startsWith("/v1/builds/")
          ? build({ type: "appEncryptionDeclarations", id: "foreign" })
          : { data: [d] },
      async () => {
        throw Error("must not write");
      },
      policy(),
      upload,
      async () => {},
    ),
    /Different/,
  );
  await assert.rejects(
    applyDeclaration(
      async (p) =>
        p.startsWith("/v1/builds/")
          ? build()
          : { data: [], links: { next: "more" } },
      async () => {
        throw Error("must not write");
      },
      policy(),
      upload,
      async () => {},
    ),
    /Complete/,
  );
});

test("a rejected declaration is never attachable even with an inconsistent exempt flag", async () => {
  const d = declaration(true);
  d.attributes.appEncryptionDeclarationState = "REJECTED";
  const writes = [];
  const result = await applyDeclaration(
    async (p) => (p.startsWith("/v1/builds/") ? build() : { data: [d] }),
    async (m) => {
      writes.push(m);
      throw Error("must not write");
    },
    policy(),
    upload,
    async () => {},
  );
  assert.equal(result.blocked, true);
  assert.deepEqual(writes, []);
});

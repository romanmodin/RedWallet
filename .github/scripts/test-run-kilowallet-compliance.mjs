import test from "node:test";
import assert from "node:assert/strict";
import {
  clients,
  inspectState,
  inspectOriginalGroups,
  ORIGINAL_GROUPS,
} from "./run-kilowallet-compliance.mjs";
import { APP, BUILD } from "./kilowallet-compliance-plan.mjs";
test("credential-bearing transport rejects foreign app, host, method and altered declaration before network", async () => {
  let n = 0;
  const payload = {
    data: { type: "appEncryptionDeclarations", attributes: { fixture: true } },
  };
  const { get, write } = clients(
    "fixture",
    payload,
    async () => {},
    async () => {
      n++;
      throw Error("must not send");
    },
  );
  for (const p of [
    "https://evil.invalid/v1/builds/" + BUILD,
    "/v1/builds/other",
    "/v1/appEncryptionDeclarations?filter[app]=other",
  ])
    await assert.rejects(get(p));
  await assert.rejects(
    write("POST", "/v1/appEncryptionDeclarations", { data: {} }),
  );
  await assert.rejects(write("DELETE", "/v1/builds/" + BUILD, {}));
  await assert.rejects(
    write(
      "PATCH",
      "/v1/builds/other/relationships/appEncryptionDeclaration",
      {},
    ),
  );
  assert.equal(n, 0);
});
test("write timeout has exactly one request and a prior durable journal entry", async () => {
  const events = [];
  let n = 0;
  const payload = { data: { fixture: true } };
  const { write } = clients(
    "fixture",
    payload,
    async (e) => events.push(e),
    async (u, o) => {
      n++;
      assert.equal(events[0].stage, "http-write-started");
      assert.equal(o.redirect, "error");
      throw Error("ambiguous");
    },
  );
  await assert.rejects(
    write("POST", "/v1/appEncryptionDeclarations", payload),
    /ambiguous/,
  );
  assert.equal(n, 1);
});
test("successful declaration response identity retained without document URLs or raw response", async () => {
  const events = [];
  const payload = { data: { fixture: true } };
  const { write } = clients(
    "fixture",
    payload,
    async (e) => events.push(e),
    async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          id: "fixture-id",
          type: "appEncryptionDeclarations",
          attributes: { documentUrl: "sensitive-opaque-url" },
        },
      }),
    }),
  );
  await write("POST", "/v1/appEncryptionDeclarations", payload);
  assert.equal(events.at(-1).resourceId, "fixture-id");
  assert.ok(!JSON.stringify(events).includes("sensitive"));
});

test("reconciliation reads only build and declarations and drops unrelated response data", async () => {
  const calls = [];
  const result = await inspectState(async (path) => {
    calls.push(path);
    return path.startsWith("/v1/builds/")
      ? {
          data: {
            id: BUILD,
            attributes: {
              version: "3",
              processingState: "VALID",
              documentUrl: "opaque",
            },
            relationships: {
              app: { data: { id: APP } },
              betaGroups: { data: [] },
            },
          },
        }
      : {
          data: [
            {
              id: "fixture-declaration",
              attributes: { exempt: true, documentUrl: "opaque" },
            },
          ],
        };
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].startsWith("/v1/builds/" + BUILD + "?"));
  assert.ok(calls[1].startsWith("/v1/appEncryptionDeclarations?"));
  assert.equal(result.readOnly, true);
  assert.ok(!JSON.stringify(result).includes("opaque"));
});

test("beta status uses exact included resources and complete memberships without writes", async () => {
  const fixture = {
    data: {
      id: BUILD,
      relationships: {
        app: { data: { id: APP } },
        buildBetaDetail: { data: { id: "d", type: "buildBetaDetails" } },
        betaAppReviewSubmission: {
          data: { id: "r", type: "betaAppReviewSubmissions" },
        },
        betaGroups: { data: [{ id: "g", type: "betaGroups" }] },
      },
    },
    included: [
      {
        id: "d",
        type: "buildBetaDetails",
        attributes: {
          internalBuildState: "IN_BETA_TESTING",
          externalBuildState: "WAITING_FOR_BETA_REVIEW",
          opaque: "secret",
        },
      },
      {
        id: "r",
        type: "betaAppReviewSubmissions",
        attributes: { betaReviewState: "WAITING_FOR_REVIEW" },
      },
      {
        id: "g",
        type: "betaGroups",
        attributes: { name: "fixture", isInternalGroup: true },
      },
    ],
  };
  const run = (f) =>
    inspectState(async (path) =>
      path.startsWith("/v1/builds/") ? f : { data: [] },
    );
  const out = await run(fixture);
  assert.equal(
    out.beta.detail.attributes.internalBuildState,
    "IN_BETA_TESTING",
  );
  assert.equal(
    out.beta.review.attributes.betaReviewState,
    "WAITING_FOR_REVIEW",
  );
  assert.deepEqual(out.beta.groups, [
    { id: "g", name: "fixture", isInternalGroup: true },
  ]);
  assert.ok(!JSON.stringify(out).includes("secret"));
  for (const change of [
    (f) => (f.data.id = "other"),
    (f) => (f.data.relationships.app.data.id = "other"),
    (f) => f.included.pop(),
    (f) => f.included.push(f.included[0]),
    (f) => (f.data.relationships.betaGroups.links = { next: "truncated" }),
    (f) => delete f.data.relationships.betaGroups,
  ]) {
    const copy = structuredClone(fixture);
    change(copy);
    await assert.rejects(run(copy));
  }
});

test("original group verification checks both identities and complete exact-build memberships using GET only", async () => {
  const calls = [];
  const fixture = async (path) => {
    calls.push(path);
    const group = ORIGINAL_GROUPS.find((g) =>
      path.startsWith("/v1/betaGroups/" + g.id),
    );
    assert.ok(group);
    return path.includes("/builds")
      ? {
          data: [{ type: "builds", id: BUILD }],
          meta: { paging: { total: 1 } },
        }
      : {
          data: {
            id: group.id,
            type: "betaGroups",
            attributes: { name: group.name, isInternalGroup: group.internal },
            relationships: { app: { data: { id: APP } } },
          },
        };
  };
  const groups = await inspectOriginalGroups(fixture);
  assert.equal(calls.length, 4);
  assert.ok(groups.every((g) => g.assigned && g.complete));
  const missing = await inspectOriginalGroups((path) =>
    path.includes("/builds") ? { data: [] } : fixture(path),
  );
  assert.ok(missing.every((g) => !g.assigned && g.complete));
  for (const mutate of [
    (b) => (b.data.relationships.app.data.id = "other"),
    (b) => (b.data.attributes.name = "other"),
    (b) =>
      (b.data.attributes.isInternalGroup = !b.data.attributes.isInternalGroup),
  ]) {
    await assert.rejects(
      inspectOriginalGroups(async (path) => {
        const body = await fixture(path);
        if (!path.includes("/builds")) mutate(body);
        return body;
      }),
    );
  }
});
test("group build lists reject truncation, duplicates, foreign pagination and cycles", async () => {
  const group = ORIGINAL_GROUPS[0];
  const info = {
    data: {
      id: group.id,
      type: "betaGroups",
      attributes: { name: group.name, isInternalGroup: true },
      relationships: { app: { data: { id: APP } } },
    },
  };
  for (const builds of [
    { data: [], meta: { paging: { total: 1 } } },
    {
      data: [
        { type: "builds", id: BUILD },
        { type: "builds", id: BUILD },
      ],
    },
    {
      data: [],
      links: {
        next: "https://evil.invalid/v1/betaGroups/" + group.id + "/builds",
      },
    },
    { data: [], links: { next: "/v1/betaGroups/other/builds" } },
    {
      data: [],
      links: { next: "/v1/betaGroups/" + group.id + "/builds?limit=200" },
    },
  ])
    await assert.rejects(
      inspectOriginalGroups((path) =>
        path.includes("/builds") ? builds : info,
      ),
    );
});
test("transport allows only the two original group reads and denies foreign groups before network", async () => {
  let count = 0;
  const { get } = clients(
    "fixture",
    {},
    async () => {},
    async () => {
      count++;
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    },
  );
  await get("/v1/betaGroups/" + ORIGINAL_GROUPS[0].id + "?include=app");
  await get("/v1/betaGroups/" + ORIGINAL_GROUPS[1].id + "/builds?limit=200");
  assert.equal(count, 2);
  await assert.rejects(get("/v1/betaGroups/other/builds"));
  await assert.rejects(
    get("/v1/betaGroups/" + ORIGINAL_GROUPS[0].id + "/betaTesters"),
  );
  assert.equal(count, 2);
});

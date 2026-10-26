import test from "node:test";
import assert from "node:assert/strict";
import { clients } from "./run-kilowallet-compliance.mjs";
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

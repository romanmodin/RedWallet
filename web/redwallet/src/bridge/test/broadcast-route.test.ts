import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";
const fixture = JSON.parse(readFileSync(new URL("../../../../test/regtest/xbt-web-signed-20260929.json", import.meta.url), "utf8"));
const secret = "public-test-only-bridge-credential";

async function harness(enabled: boolean, checkpoint: boolean, wrongCheckpoint = false) {
  const calls: string[] = [];
  const config = loadConfig({ BRIDGE_SECRET: secret, FULCRUM_HOST: "127.0.0.1", FULCRUM_TLS: "false", ENABLE_BROADCAST: String(enabled) });
  const server = createServer({ config: { ...config, checkpoint: checkpoint ? { height: 961640, hash: "0".repeat(64), headerHex: "00".repeat(164) } : null }, upstream: {
    call: async (method, params) => {
      calls.push(method);
      if (method === "blockchain.block.header") return wrongCheckpoint ? "11".repeat(164) : "00".repeat(164);
      assert.equal(method, "blockchain.transaction.broadcast"); assert.deepEqual(params, [fixture.hex]); return fixture.txid;
    },
  } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  return { calls, close: () => new Promise<void>(resolve => server.close(() => resolve())), request: async (raw: string, authenticated = true) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify({ method: "transaction.broadcast", params: [raw] }) });
    return { status: response.status, body: await response.json() as { result?: { txid: string; outcome: string }; error?: { code: string } } };
  } };
}
test("broadcast is unreachable without both operator opt-in and a checkpoint", async () => {
  for (const [enabled, checkpoint] of [[false, true], [true, false], [false, false]]) {
    const h = await harness(enabled!, checkpoint!);
    try { const response = await h.request(fixture.hex); assert.equal(response.status, 400); assert.equal(response.body.error?.code, "method_not_allowed"); assert.deepEqual(h.calls, []); } finally { await h.close(); }
  }
});
test("auth and signed-shape rejection precede checkpoint or broadcast contact", async () => {
  const h = await harness(true, true);
  try {
    assert.equal((await h.request(fixture.hex, false)).status, 401);
    assert.equal((await h.request(fixture.bitcoinControlHex)).status, 400);
    assert.deepEqual(h.calls, []);
  } finally { await h.close(); }
});
test("verified checkpoint precedes exact signed bytes and repeated requests coalesce", async () => {
  const h = await harness(true, true);
  try {
    const results = await Promise.all([h.request(fixture.hex), h.request(fixture.hex)]);
    for (const result of results) assert.deepEqual(result, { status: 200, body: { result: { txid: fixture.txid, outcome: "acknowledged" } } });
    assert.deepEqual(h.calls, ["blockchain.block.header", "blockchain.transaction.broadcast"]);
  } finally { await h.close(); }
});
test("a wrong checkpoint prevents signed transaction submission", async () => {
  const h = await harness(true, true, true);
  try { assert.equal((await h.request(fixture.hex)).status, 502); assert.deepEqual(h.calls, ["blockchain.block.header"]); } finally { await h.close(); }
});

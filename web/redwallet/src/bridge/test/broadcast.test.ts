import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BroadcastCoordinator } from "../src/broadcast.js";
const fixture = JSON.parse(readFileSync(new URL("../../../../test/regtest/xbt-web-signed-20260929.json", import.meta.url), "utf8"));

test("coalesces identical in-flight submissions and requires the exact returned txid", async () => {
  let complete!: (value: unknown) => void; let calls = 0;
  const coordinator = new BroadcastCoordinator({ call: async (method, params) => {
    calls++; assert.equal(method, "blockchain.transaction.broadcast"); assert.deepEqual(params, [fixture.hex]);
    return new Promise(resolve => { complete = resolve; });
  } });
  const first = coordinator.submit(fixture.hex); const second = coordinator.submit(fixture.hex);
  complete(fixture.txid);
  assert.deepEqual(await first, { txid: fixture.txid, outcome: "acknowledged" });
  assert.deepEqual(await second, await coordinator.submit(fixture.hex)); assert.equal(calls, 1);
});
test("uncertain results reconcile without automatically rebroadcasting", async () => {
  const calls: string[] = []; let available = false;
  const coordinator = new BroadcastCoordinator({ call: async (method) => {
    calls.push(method); if (method === "blockchain.transaction.broadcast") throw Error("reply lost");
    if (!available) throw Error("not found or offline"); return fixture.hex;
  } });
  assert.equal((await coordinator.submit(fixture.hex)).outcome, "unknown");
  assert.equal((await coordinator.submit(fixture.hex)).outcome, "unknown");
  available = true; assert.equal((await coordinator.submit(fixture.hex)).outcome, "acknowledged");
  assert.deepEqual(calls, ["blockchain.transaction.broadcast", "blockchain.transaction.get", "blockchain.transaction.get"]);
});
test("a wrong txid remains unknown and invalid signed shapes never contact upstream", async () => {
  let calls = 0;
  const coordinator = new BroadcastCoordinator({ call: async () => { calls++; return "f".repeat(64); } });
  assert.equal((await coordinator.submit(fixture.hex)).outcome, "unknown");
  await assert.rejects(coordinator.submit(fixture.bitcoinControlHex)); await assert.rejects(coordinator.submit("00"));
  assert.equal(calls, 1);
});

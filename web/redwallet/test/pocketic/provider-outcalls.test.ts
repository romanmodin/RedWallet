/** Real compiled-canister calls with deterministic HTTPS responses, no live RPC. */
import { PocketIc } from "@dfinity/pic";
import type { Actor, DeferredActor, PendingHttpsOutcall } from "@dfinity/pic";
import { Principal } from "@icp-sdk/core/principal";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

const ADMIN = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
const ENDPOINT = "https://adapter.example.invalid";
const FIXTURE_SECRET = "public-test-fixture-token-32-characters";
const PIN = "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb";
let pic: PocketIc;
let actor: Actor<_SERVICE>;
let deferred: DeferredActor<_SERVICE>;

beforeAll(async () => {
  pic = await PocketIc.create(process.env.POCKET_IC_URL ?? "");
  const fixture = await pic.setupCanister<_SERVICE>({
    idlFactory, wasm: process.env.BACKEND_WASM ?? "", sender: ADMIN, controllers: [ADMIN],
  });
  actor = fixture.actor;
  deferred = pic.createDeferredActor<_SERVICE>(idlFactory, fixture.canisterId);
  actor.setPrincipal(ADMIN);
  await pic.setTime(new Date("2026-09-30T22:00:00Z"));
});
beforeEach(async () => {
  await actor.clearBridgeConfig();
  // Also expires the separate five-minute market quote throttle between tests.
  await pic.advanceTime(301_000);
});
afterAll(async () => { await pic?.tearDown(); });

async function pending(): Promise<PendingHttpsOutcall> {
  for (let round = 0; round < 12; round++) {
    await pic.tick(1);
    const calls = await pic.getPendingHttpsOutcalls();
    if (calls.length) { expect(calls).toHaveLength(1); return calls[0]; }
  }
  throw new Error("Expected HTTPS outcall was not queued");
}
async function answer(call: PendingHttpsOutcall, body: unknown, statusCode = 200) {
  await pic.mockPendingHttpsOutcall({
    requestId: call.requestId, subnetId: call.subnetId,
    response: { type: "success", statusCode, headers: [["date", "volatile"]],
      body: new TextEncoder().encode(JSON.stringify(body)) },
  });
}
async function metadata(extra: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id: 1, result: {
    serverVersion: "Fulcrum fixture", protocolVersion: "1.4", height: 974914,
    checkpointVerified: true, checkpointHeight: 961640, checkpointHash: PIN,
    fulcrumHost: "fulcrum.example", fulcrumPort: 55001, fulcrumTls: false,
    tipTimestamp: Math.floor((await pic.getTime()) / 1000), ...extra,
  } };
}
async function configure() { await actor.setBridgeConfig(ENDPOINT, FIXTURE_SECRET); }

it("provider info fails explicitly before configuration", async () => {
  expect(await actor.getProviderInfo()).toEqual({ err: { not_configured: null } });
  expect(await pic.getPendingHttpsOutcalls()).toHaveLength(0);
});
it("executes the configured HTTPS route and returns public identity without its token", async () => {
  await configure();
  const finish = await deferred.getProviderInfo();
  const call = await pending();
  expect(call.url).toBe(`${ENDPOINT}/rpc`);
  expect(call.httpMethod).toBe("POST");
  expect(JSON.parse(new TextDecoder().decode(call.body))).toMatchObject({ method: "server.status", params: [] });
  expect(call.headers).toContainEqual(["authorization", `Bearer ${FIXTURE_SECRET}`]);
  await answer(call, await metadata());
  const result = await finish();
  expect(result).toMatchObject({ ok: { endpoint: ENDPOINT, host: "fulcrum.example", port: 55001n,
    tls: false, checkpointHeight: 961640n, checkpointHash: PIN } });
  expect(JSON.stringify(result, (_, value) => typeof value === "bigint" ? value.toString() : value)).not.toContain(FIXTURE_SECRET);
});
it.each(["wrong-pin", "old-tip", "future-tip", "below-pin"])("rejects %s in actual provider API", async (kind) => {
  await configure();
  const now = Math.floor((await pic.getTime()) / 1000);
  const extra = kind === "wrong-pin" ? { checkpointHash: "a".repeat(64) }
    : kind === "old-tip" ? { tipTimestamp: now - 7201 }
    : kind === "future-tip" ? { tipTimestamp: now + 7201 }
    : { height: 961639 };
  const finish = await deferred.getProviderInfo();
  await answer(await pending(), await metadata(extra));
  expect(await finish()).toEqual({ err: { backend_unavailable: "wrong XBT chain or stale chain tip" } });
});
it("rejects adapters missing the header timestamp", async () => {
  await configure();
  const finish = await deferred.getProviderInfo();
  await answer(await pending(), await metadata({ tipTimestamp: null }));
  expect(await finish()).toHaveProperty("err.malformed_response");
});
it("discards a reply after operator configuration changes during the outcall", async () => {
  await configure();
  const finish = await deferred.getProviderInfo();
  const call = await pending();
  await actor.clearBridgeConfig();
  await answer(call, await metadata());
  expect(await finish()).toEqual({ err: { backend_unavailable: "bridge configuration changed; refresh" } });
});
it("handles failed HTTPS without leaking configured credentials", async () => {
  await configure();
  const finish = await deferred.getProviderInfo();
  await answer(await pending(), { token: FIXTURE_SECRET }, 503);
  const result = await finish();
  expect(result).toHaveProperty("err.backend_unavailable");
  expect(JSON.stringify(result)).not.toContain(FIXTURE_SECRET);
});
it("fetches only the fixed public price endpoint and caches without wallet/operator data", async () => {
  const finish = await deferred.getNeoxexPrice();
  const call = await pending();
  expect(call.url).toBe("https://neoxa.exchange/api/exchange/trades/BTCB2_USDC?limit=1");
  expect(call.httpMethod).toBe("GET");
  expect(call.maxResponseBytes).toBe(16384);
  expect(call.body).toHaveLength(0);
  expect(call.headers.map(([name]) => name.toLowerCase())).not.toContain("authorization");
  const quote = { success: true, pair: "BTCB2_USDC", trades: [{ price: 362.82 }] };
  await answer(call, quote);
  const result = await finish();
  expect(result).toEqual({ ok: JSON.stringify(quote) });
  expect(await actor.getNeoxexPrice()).toEqual(result);
  expect(await pic.getPendingHttpsOutcalls()).toHaveLength(0);
});
it("throttles a failed price call instead of creating another paid request", async () => {
  const finish = await deferred.getNeoxexPrice();
  await answer(await pending(), {}, 503);
  const result = await finish();
  expect(result).toHaveProperty("err");
  expect(await actor.getNeoxexPrice()).toEqual(result);
  expect(await pic.getPendingHttpsOutcalls()).toHaveLength(0);
});

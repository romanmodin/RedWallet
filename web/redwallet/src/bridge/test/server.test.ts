/**
 * Integration tests for the bridge HTTP server.
 *
 * Each test starts a real bridge server on an ephemeral port and talks to it
 * over HTTP. Upstreams are local mocks; no real network is contacted.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { loadConfig, type BridgeConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { FulcrumClient } from "../src/upstream.js";
import {
  startMockUpstream,
  startSelfSignedTlsUpstream,
  type MockUpstream,
} from "./helpers.js";

const SECRET = "0123456789abcdef0123456789abcdef";

interface Harness {
  readonly baseUrl: string;
  close(): Promise<void>;
}

async function startBridge(
  overrides: Partial<BridgeConfig> = {},
  upstream?: MockUpstream,
): Promise<Harness> {
  const config: BridgeConfig = {
    ...loadConfig({
      BRIDGE_SECRET: SECRET,
      FULCRUM_HOST: "127.0.0.1",
      FULCRUM_PORT: String(upstream?.port ?? 1),
      FULCRUM_TLS: "false",
    }),
    ...overrides,
  };
  const server: http.Server = createServer({ config });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

async function rpc(
  baseUrl: string,
  body: unknown,
  secret: string | null = SECRET,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret !== null) headers["authorization"] = `Bearer ${secret}`;
  const response = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("health: reports liveness and no secrets", async () => {
  const bridge = await startBridge();
  try {
    const response = await fetch(`${bridge.baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body["status"], "ok");
    assert.equal(body["upstreamConfigured"], true);
    const text = JSON.stringify(body);
    assert.equal(text.includes(SECRET), false);
    assert.equal(text.includes("127.0.0.1"), false);
  } finally {
    await bridge.close();
  }
});

test("health: reports not configured when no upstream is set", async () => {
  const bridge = await startBridge({ fulcrumHost: "" });
  try {
    const response = await fetch(`${bridge.baseUrl}/health`);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body["upstreamConfigured"], false);
  } finally {
    await bridge.close();
  }
});

test("auth: rejects a missing secret before upstream contact", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, { method: "server.version", params: [] }, null);
    assert.equal(status, 401);
    assert.equal((json as { error: { code: string } }).error.code, "unauthorized");
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("auth: rejects a wrong secret", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(
      bridge.baseUrl,
      { method: "server.version", params: [] },
      "wrong-secret-wrong-secret",
    );
    assert.equal(status, 401);
    assert.equal((json as { error: { code: string } }).error.code, "unauthorized");
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("not configured: reads fail explicitly with no upstream", async () => {
  const bridge = await startBridge({ fulcrumHost: "" });
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "server.version",
      params: [],
    });
    assert.equal(status, 503);
    assert.equal((json as { error: { code: string } }).error.code, "not_configured");
  } finally {
    await bridge.close();
  }
});

test("success: forwards an allowlisted method and returns the result", async () => {
  const upstream = await startMockUpstream({
    handler: (method) => (method === "server.version" ? ["Fulcrum 1.9", "1.4"] : null),
  });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "server.version",
      params: [],
    });
    assert.equal(status, 200);
    assert.deepEqual((json as { result: unknown }).result, ["Fulcrum 1.9", "1.4"]);
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0]?.method, "server.version");
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("success: maps address.balance to the fixed upstream method", async () => {
  const upstream = await startMockUpstream({
    handler: () => ({ confirmed: 1000, unconfirmed: 0 }),
  });
  const bridge = await startBridge({}, upstream);
  try {
    const { status } = await rpc(bridge.baseUrl, {
      method: "address.balance",
      params: ["1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"],
    });
    assert.equal(status, 200);
    assert.equal(
      upstream.requests[0]?.method,
      "blockchain.scripthash.get_balance",
    );
    const scripthash = upstream.requests[0]?.params[0];
    assert.match(String(scripthash), /^[0-9a-f]{64}$/);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("invalid address: rejected before upstream contact", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "address.history",
      params: ["xbt-demo-address-not-valid"],
    });
    assert.equal(status, 400);
    assert.equal((json as { error: { code: string } }).error.code, "invalid_request");
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("unreachable upstream: maps to upstream_unavailable", async () => {
  // Port 1 on loopback is not listening.
  const bridge = await startBridge({ fulcrumPort: 1 });
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "server.version",
      params: [],
    });
    assert.equal(status, 502);
    assert.equal(
      (json as { error: { code: string } }).error.code,
      "upstream_unavailable",
    );
  } finally {
    await bridge.close();
  }
});

test("malformed upstream response: maps to upstream_malformed", async () => {
  const upstream = await startMockUpstream({ malformed: true });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "server.version",
      params: [],
    });
    assert.equal(status, 502);
    assert.equal(
      (json as { error: { code: string } }).error.code,
      "upstream_malformed",
    );
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("upstream error object: maps to upstream_unavailable", async () => {
  const upstream = await startMockUpstream({
    handler: () => {
      throw new Error("upstream says no");
    },
  });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "server.version",
      params: [],
    });
    assert.equal(status, 502);
    assert.equal(
      (json as { error: { code: string } }).error.code,
      "upstream_unavailable",
    );
    // The upstream's own message must not leak.
    assert.equal(JSON.stringify(json).includes("upstream says no"), false);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("timeout: a silent upstream maps to upstream_timeout", async () => {
  const upstream = await startMockUpstream({ silent: true });
  const bridge = await startBridge({ requestTimeoutMs: 200 }, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "server.version",
      params: [],
    });
    assert.equal(status, 504);
    assert.equal(
      (json as { error: { code: string } }).error.code,
      "upstream_timeout",
    );
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("size limit: an oversized body is rejected", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({ maxRequestBytes: 128 }, upstream);
  try {
    const big = "x".repeat(4096);
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "server.version",
      params: [big],
    });
    assert.equal(status, 413);
    assert.equal(
      (json as { error: { code: string } }).error.code,
      "payload_too_large",
    );
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("rate limit: excess requests are rejected", async () => {
  const upstream = await startMockUpstream({ handler: () => 0.001 });
  const bridge = await startBridge({ rateLimitMax: 2, rateLimitWindowMs: 60_000 }, upstream);
  try {
    const first = await rpc(bridge.baseUrl, { method: "fee.estimate", params: [1] });
    const second = await rpc(bridge.baseUrl, { method: "fee.estimate", params: [2] });
    const third = await rpc(bridge.baseUrl, { method: "fee.estimate", params: [3] });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.equal(
      (third.json as { error: { code: string } }).error.code,
      "rate_limited",
    );
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("routing: GET /rpc is rejected and unknown paths 404", async () => {
  const bridge = await startBridge();
  try {
    const getRpc = await fetch(`${bridge.baseUrl}/rpc`);
    assert.equal(getRpc.status, 405);
    const unknown = await fetch(`${bridge.baseUrl}/sign`);
    assert.equal(unknown.status, 404);
  } finally {
    await bridge.close();
  }
});

test("TLS verification: a self-signed upstream certificate is rejected", async () => {
  const upstream = await startSelfSignedTlsUpstream();
  const client = new FulcrumClient({
    host: "127.0.0.1",
    port: upstream.port,
    tls: true,
    timeoutMs: 2000,
  });
  try {
    await assert.rejects(
      () => client.call("server.version", []),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, "upstream_tls_error");
        return true;
      },
    );
  } finally {
    await upstream.close();
  }
});


const CHECKPOINT = {
  height: 961640,
  hash: "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
  // Knots and Fulcrum independently returned this exact extended header on 2026-09-29.
  headerHex: "000000a0657e02138733654183a2c7320d85ca9d743fe139c4bb01000000000000000000c137a8515a0f6b3aaf6049cc7611787c022ad523d51094be0a0363d0dc0bc7684dca936a4f8d001a5671798c84daeb494dca936a00000000b1ccf00d0300000000000000000000001e0300000000000000000000000000000000000068ac0e000000000000000000000000000000000000000000000000000000000000000000",
};

test("status: verifies the exact extended XBT checkpoint and reports actual upstream tip", async () => {
  const upstream = await startMockUpstream({ handler: method => method === "blockchain.block.header" ? CHECKPOINT.headerHex : method === "blockchain.headers.subscribe" ? { height: 982345, hex: "00" } : ["Fulcrum", "1.4"] });
  const bridge = await startBridge({checkpoint: CHECKPOINT}, upstream);
  try {
    const response = await rpc(bridge.baseUrl, { method: "server.status", params: [] });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {result: {height: 982345, serverVersion: "Fulcrum", protocolVersion: "1.4", checkpointVerified: true, checkpointHeight: CHECKPOINT.height, checkpointHash: CHECKPOINT.hash}});
    assert.deepEqual(upstream.requests[0], {method: "blockchain.block.header", params: [961640]});
  } finally { await bridge.close(); await upstream.close(); }
});

test("checkpoint: a different chain header blocks address reads", async () => {
  const upstream = await startMockUpstream({ handler: () => "00".repeat(164) });
  const bridge = await startBridge({checkpoint: CHECKPOINT}, upstream);
  try {
    const response = await rpc(bridge.baseUrl, {method: "address.balance", params: ["bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"]});
    assert.equal(response.status, 502);
    assert.deepEqual(upstream.requests.map(r => r.method), ["blockchain.block.header"]);
  } finally { await bridge.close(); await upstream.close(); }
});

test("IC fanout: identical replica requests coalesce into one upstream query", async () => {
  const upstream = await startMockUpstream({handler: () => ["Fulcrum", "1.4"]});
  const bridge = await startBridge({rateLimitMax: 1}, upstream);
  try {
    const replies = await Promise.all(Array.from({length: 34}, () => rpc(bridge.baseUrl, {method: "server.version", params: []})));
    assert.ok(replies.every(r => r.status === 200));
    assert.ok(replies.every(r => JSON.stringify(r.json) === JSON.stringify(replies[0]?.json)));
    assert.equal(upstream.requests.length, 1);
  } finally { await bridge.close(); await upstream.close(); }
});


test("RPC: rejects wrong IDs and non-object response envelopes", async () => {
  for (const response of [{jsonrpc: "2.0", id: 999, result: "wrong"}, [], {jsonrpc: "1.0", id: 1, result: "wrong"}]) {
    const upstream = await startMockUpstream({response});
    const client = new FulcrumClient({host: "127.0.0.1", port: upstream.port, tls: false, timeoutMs: 1000});
    try { await assert.rejects(() => client.call("server.version", []), (error: unknown) => (error as {code: string}).code === "upstream_malformed"); }
    finally { await upstream.close(); }
  }
});

const VALID_ADDRESS = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const VALID_TXID = "ab".repeat(32);

test("address.utxos: rejects malformed listunspent entries", async () => {
  const malformed = [
    "not-an-array",
    [{ tx_hash: "AB".repeat(32), tx_pos: 0, height: 1, value: 1 }], // uppercase txid
    [{ tx_hash: "ab".repeat(31), tx_pos: 0, height: 1, value: 1 }], // short txid
    [{ tx_hash: VALID_TXID, tx_pos: -1, height: 1, value: 1 }], // negative vout
    [{ tx_hash: VALID_TXID, tx_pos: 4294967296, height: 1, value: 1 }], // vout > uint32
    [{ tx_hash: VALID_TXID, tx_pos: 0, height: -1, value: 1 }], // negative height
    [{ tx_hash: VALID_TXID, tx_pos: 0, height: 1, value: -1 }], // negative value
    [{ tx_hash: VALID_TXID, tx_pos: 0, height: 1, value: 2_100_000_000_000_001 }], // value over cap
    [{ tx_hash: VALID_TXID, tx_pos: 0, height: 1, value: 1.5 }], // non-integer value
    [{ tx_hash: VALID_TXID, tx_pos: 0, height: 1, value: 1, extra: true }], // extra field
    [{ tx_hash: VALID_TXID, tx_pos: 0, height: 1 }], // missing value
    [{ tx_hash: VALID_TXID, tx_pos: 0, height: 1, value: 1 }, { tx_hash: VALID_TXID, tx_pos: 0, height: 2, value: 2 }], // duplicate outpoint
  ];
  for (const result of malformed) {
    const upstream = await startMockUpstream({ handler: () => result });
    const bridge = await startBridge({}, upstream);
    try {
      const { status, json } = await rpc(bridge.baseUrl, { method: "address.utxos", params: [VALID_ADDRESS] });
      assert.equal(status, 502, JSON.stringify(result));
      assert.equal((json as { error: { code: string } }).error.code, "upstream_malformed");
    } finally {
      await bridge.close();
      await upstream.close();
    }
  }
});

test("address.utxos: more than 1000 entries is an explicit error, not a truncation", async () => {
  const entries = Array.from({ length: 1001 }, (_, i) => ({ tx_hash: VALID_TXID, tx_pos: i, height: 1, value: 1 }));
  const upstream = await startMockUpstream({ handler: () => entries });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, { method: "address.utxos", params: [VALID_ADDRESS] });
    assert.equal(status, 502);
    assert.equal((json as { error: { code: string } }).error.code, "upstream_malformed");
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("address.utxos: exactly 1000 entries is accepted", async () => {
  const entries = Array.from({ length: 1000 }, (_, i) => ({ tx_hash: VALID_TXID, tx_pos: i, height: 1, value: 1 }));
  const upstream = await startMockUpstream({ handler: () => entries });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, { method: "address.utxos", params: [VALID_ADDRESS] });
    assert.equal(status, 200);
    assert.equal((json as { result: unknown[] }).result.length, 1000);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("transaction.raw: rejects verbose objects and malformed hex", async () => {
  const malformed = [
    { hex: "00", txid: VALID_TXID }, // verbose object
    "",
    "abc", // odd length
    "zz", // non-hex
    "AB", // uppercase
    "00".repeat(100_001), // over 200000 hex chars
  ];
  for (const result of malformed) {
    const upstream = await startMockUpstream({ handler: () => result });
    const bridge = await startBridge({}, upstream);
    try {
      const { status, json } = await rpc(bridge.baseUrl, { method: "transaction.raw", params: [VALID_TXID] });
      assert.equal(status, 502, JSON.stringify(result).slice(0, 40));
      assert.equal((json as { error: { code: string } }).error.code, "upstream_malformed");
    } finally {
      await bridge.close();
      await upstream.close();
    }
  }
});

test("transaction.raw: a bad txid is rejected before upstream contact", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, { method: "transaction.raw", params: ["not-a-txid"] });
    assert.equal(status, 400);
    assert.equal((json as { error: { code: string } }).error.code, "invalid_request");
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("allowlist: no broadcast, signing, or private-key method is reachable", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({}, upstream);
  try {
    for (const method of ["blockchain.transaction.broadcast", "signrawtransaction", "dumpprivkey", "wallet.send"]) {
      const { status, json } = await rpc(bridge.baseUrl, { method, params: [] });
      assert.equal(status, 400, method);
      assert.equal((json as { error: { code: string } }).error.code, "method_not_allowed", method);
    }
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

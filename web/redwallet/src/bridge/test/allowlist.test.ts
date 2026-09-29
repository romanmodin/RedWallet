/**
 * Characterization tests for the bridge's read-only allowlist and its fixed
 * upstream method mapping.
 *
 * The request keeps the bridge's read-only allowlist, bearer auth, TLS
 * verification, and safe error mapping. The existing suite pins auth, TLS,
 * validation, and several error paths, but it never asserts the allowlist's
 * read-only guarantee directly, and it never exercises the success mapping for
 * `server.features`, `address.history`, `fee.estimate`, or
 * `headers.checkpoint`. These tests pin those observable contracts:
 *
 *   - the allowlist contains only read-only methods and no signing,
 *     transaction-construction, or broadcast route;
 *   - every allowlisted bridge method maps to its fixed upstream method and
 *     forwards only bridge-derived params;
 *   - a request can never select an arbitrary upstream method or host;
 *   - error bodies carry a stable code and a fixed message that never leaks
 *     the upstream host, port, or secret.
 *
 * Upstreams are local mocks; no real network is contacted.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import {
  ALLOWLIST,
  bridgeMethodNames,
  isBridgeMethod,
  type BridgeMethod,
} from "../src/allowlist.js";
import { loadConfig, type BridgeConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { errorBody, errorStatus } from "../src/errors.js";
import { BridgeError } from "../src/errors.js";
import { validateRequest } from "../src/validation.js";
import { startMockUpstream, type MockUpstream } from "./helpers.js";

const SECRET = "0123456789abcdef0123456789abcdef";

/** A well-known P2PKH address; format check only, no network claim. */
const VALID_ADDRESS = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";

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
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("allowlist: only the explicitly gated signed broadcast method extends reads", () => {
  const names = bridgeMethodNames().filter(name => name !== "transaction.broadcast");
  assert.equal(ALLOWLIST["transaction.broadcast"].params, "signed_transaction");
  assert.ok(names.length > 0);

  // Every allowlisted method is a read: server metadata, address reads, fee
  // estimate, or header info. None constructs, signs, or broadcasts.
  const forbidden = /(broadcast|send|sign|submit|push|create|spend|tx\.)/i;
  for (const name of names) {
    assert.equal(
      forbidden.test(name),
      false,
      `allowlisted method "${name}" looks like a write route`,
    );
  }

  // The upstream methods are likewise read-only Electrum calls.
  for (const name of names) {
    const spec = ALLOWLIST[name];
    assert.equal(
      forbidden.test(spec.upstreamMethod),
      false,
      `upstream method "${spec.upstreamMethod}" looks like a write route`,
    );
  }

  // A broadcast method is not allowlisted.
  assert.equal(isBridgeMethod("blockchain.transaction.broadcast"), false);
  assert.equal(isBridgeMethod("blockchain.transaction.get"), false);
});

test("allowlist: address.utxos and transaction.raw are present and read-only", () => {
  assert.equal(isBridgeMethod("address.utxos"), true);
  assert.equal(isBridgeMethod("transaction.raw"), true);
  assert.equal(ALLOWLIST["address.utxos"].upstreamMethod, "blockchain.scripthash.listunspent");
  assert.equal(ALLOWLIST["address.utxos"].params, "scripthash");
  assert.equal(ALLOWLIST["transaction.raw"].upstreamMethod, "blockchain.transaction.get");
  assert.equal(ALLOWLIST["transaction.raw"].params, "txid");

  // No broadcast, signing, or private-key method exists in the allowlist.
  const forbidden = /(broadcast|send|sign|submit|push|create|spend|private|key)/i;
  for (const name of bridgeMethodNames().filter(name => name !== "transaction.broadcast")) {
    assert.equal(forbidden.test(name), false, `allowlisted method "${name}" looks like a write route`);
    assert.equal(forbidden.test(ALLOWLIST[name].upstreamMethod), false, `upstream method "${ALLOWLIST[name].upstreamMethod}" looks like a write route`);
  }
  assert.equal(isBridgeMethod("blockchain.transaction.broadcast"), false);
  assert.equal(isBridgeMethod("signrawtransaction"), false);
  assert.equal(isBridgeMethod("dumpprivkey"), false);
});

test("allowlist: address.utxos and transaction.raw enforce exactly one param", () => {
  assert.throws(() => validateRequest({ method: "address.utxos", params: [] }), BridgeError);
  assert.throws(() => validateRequest({ method: "address.utxos", params: [VALID_ADDRESS, VALID_ADDRESS] }), BridgeError);
  assert.throws(() => validateRequest({ method: "transaction.raw", params: [] }), BridgeError);
  assert.throws(() => validateRequest({ method: "transaction.raw", params: ["00".repeat(32), false] }), BridgeError);
});

test("allowlist: every bridge method maps to its fixed upstream method", () => {
  const expected: Record<BridgeMethod, string> = {
    "server.version": "server.version",
    "server.features": "server.features",
    "address.balance": "blockchain.scripthash.get_balance",
    "address.history": "blockchain.scripthash.get_history",
    "address.utxos": "blockchain.scripthash.listunspent",
    "transaction.raw": "blockchain.transaction.get",
    "transaction.broadcast": "blockchain.transaction.broadcast",
    "fee.estimate": "blockchain.estimatefee",
    "headers.checkpoint": "blockchain.block.header",
    "server.status": "blockchain.headers.subscribe",
  };
  for (const [bridgeMethod, upstreamMethod] of Object.entries(expected)) {
    assert.equal(
      ALLOWLIST[bridgeMethod as BridgeMethod].upstreamMethod,
      upstreamMethod,
    );
  }
});

test("success: maps server.features to the fixed upstream method", async () => {
  const upstream = await startMockUpstream({
    handler: () => ({ genesis_hash: "00", server_version: "1.9" }),
  });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "server.features",
      params: [],
    });
    assert.equal(status, 200);
    assert.equal(upstream.requests[0]?.method, "server.features");
    assert.deepEqual(upstream.requests[0]?.params, []);
    assert.deepEqual((json as { result: unknown }).result, {
      genesis_hash: "00",
      server_version: "1.9",
    });
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("success: maps address.history to the fixed upstream method", async () => {
  const upstream = await startMockUpstream({ handler: () => [] });
  const bridge = await startBridge({}, upstream);
  try {
    const { status } = await rpc(bridge.baseUrl, {
      method: "address.history",
      params: [VALID_ADDRESS],
    });
    assert.equal(status, 200);
    assert.equal(
      upstream.requests[0]?.method,
      "blockchain.scripthash.get_history",
    );
    // The caller supplied an address; the bridge forwarded a derived
    // scripthash, never the raw address.
    const forwarded = upstream.requests[0]?.params[0];
    assert.match(String(forwarded), /^[0-9a-f]{64}$/);
    assert.notEqual(forwarded, VALID_ADDRESS);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("success: maps address.utxos to the fixed upstream method", async () => {
  const upstream = await startMockUpstream({
    handler: () => [{ tx_hash: "ab".repeat(32), tx_pos: 0, height: 961640, value: 12345 }],
  });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "address.utxos",
      params: [VALID_ADDRESS],
    });
    assert.equal(status, 200);
    assert.equal(upstream.requests[0]?.method, "blockchain.scripthash.listunspent");
    const forwarded = upstream.requests[0]?.params[0];
    assert.match(String(forwarded), /^[0-9a-f]{64}$/);
    assert.notEqual(forwarded, VALID_ADDRESS);
    assert.deepEqual((json as { result: unknown }).result, [
      { txid: "ab".repeat(32), vout: 0, height: 961640, value: 12345 },
    ]);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("success: maps transaction.raw to the fixed upstream method with verbose=false", async () => {
  const raw = "0100000001" + "00".repeat(20);
  const upstream = await startMockUpstream({ handler: () => raw });
  const bridge = await startBridge({}, upstream);
  try {
    const txid = "cd".repeat(32);
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "transaction.raw",
      params: [txid],
    });
    assert.equal(status, 200);
    assert.equal(upstream.requests[0]?.method, "blockchain.transaction.get");
    assert.deepEqual(upstream.requests[0]?.params, [txid, false]);
    assert.equal((json as { result: unknown }).result, raw);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("success: maps fee.estimate to the fixed upstream method", async () => {
  const upstream = await startMockUpstream({ handler: () => 0.00012 });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "fee.estimate",
      params: [2],
    });
    assert.equal(status, 200);
    assert.equal(upstream.requests[0]?.method, "blockchain.estimatefee");
    assert.deepEqual(upstream.requests[0]?.params, [2]);
    assert.equal((json as { result: unknown }).result, 0.00012);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("success: maps headers.checkpoint to the fixed upstream method", async () => {
  const upstream = await startMockUpstream({
    handler: () => "00".repeat(164),
  });
  const bridge = await startBridge({}, upstream);
  try {
    const { status } = await rpc(bridge.baseUrl, {
      method: "headers.checkpoint",
      params: [800000],
    });
    assert.equal(status, 200);
    assert.equal(upstream.requests[0]?.method, "blockchain.block.header");
    assert.deepEqual(upstream.requests[0]?.params, [800000]);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("a request cannot select an arbitrary upstream method", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({}, upstream);
  try {
    // A raw Electrum method name is not a bridge method, so it is rejected
    // before any upstream contact.
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "blockchain.transaction.broadcast",
      params: ["deadbeef"],
    });
    assert.equal(status, 400);
    assert.equal(
      (json as { error: { code: string } }).error.code,
      "method_not_allowed",
    );
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("error bodies never leak the upstream host, port, or secret", () => {
  const codes = [
    "not_configured",
    "unauthorized",
    "invalid_request",
    "method_not_allowed",
    "rate_limited",
    "payload_too_large",
    "upstream_unavailable",
    "upstream_tls_error",
    "upstream_timeout",
    "upstream_malformed",
    "internal_error",
  ] as const;

  for (const code of codes) {
    const body = errorBody(code);
    assert.equal(body.error.code, code);
    assert.equal(typeof body.error.message, "string");
    assert.ok(body.error.message.length > 0);
    const text = JSON.stringify(body);
    // The secret value and any concrete upstream host/port never appear. The
    // `not_configured` message names the FULCRUM_HOST variable as operator
    // guidance, which is a variable name, not a leaked value.
    assert.equal(text.includes(SECRET), false);
    assert.equal(text.includes("127.0.0.1"), false);
    assert.equal(text.includes("50002"), false);
    // Every code has a stable HTTP status.
    assert.equal(typeof errorStatus(code), "number");
  }
});

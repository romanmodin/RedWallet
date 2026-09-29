/**
 * Boundary and unsafe-input tests for the two read-only spending-data methods.
 *
 * The existing suite pins the happy path, the malformed-result shapes, and the
 * 1000-entry cap. These tests close the remaining gaps in the accepted
 * contract for `address.utxos` and `transaction.raw`:
 *
 *   - unsafe numeric input (NaN, Infinity, non-integer, huge) and non-string
 *     params are rejected before any upstream contact;
 *   - the raw-transaction hex length bound is inclusive at 200000 and rejects
 *     anything longer;
 *   - a non-array UTXO result and non-object entries are explicit errors;
 *   - a non-string raw-transaction result (number, boolean, null) is rejected.
 *
 * Upstreams are local mocks; no real network is contacted.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { loadConfig, type BridgeConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { startMockUpstream, type MockUpstream } from "./helpers.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const VALID_ADDRESS = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const VALID_TXID = "ab".repeat(32);

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

test("address.utxos: unsafe numeric and non-string params are rejected before upstream contact", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({}, upstream);
  try {
    const unsafe = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      0,
      -1,
      true,
      null,
      { address: VALID_ADDRESS },
      [VALID_ADDRESS],
    ];
    for (const value of unsafe) {
      const { status, json } = await rpc(bridge.baseUrl, {
        method: "address.utxos",
        params: [value],
      });
      assert.equal(status, 400, JSON.stringify(value));
      assert.equal(
        (json as { error: { code: string } }).error.code,
        "invalid_request",
        JSON.stringify(value),
      );
    }
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("transaction.raw: unsafe numeric and non-string params are rejected before upstream contact", async () => {
  const upstream = await startMockUpstream();
  const bridge = await startBridge({}, upstream);
  try {
    const unsafe = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      0,
      -1,
      true,
      null,
      { txid: VALID_TXID },
      [VALID_TXID],
    ];
    for (const value of unsafe) {
      const { status, json } = await rpc(bridge.baseUrl, {
        method: "transaction.raw",
        params: [value],
      });
      assert.equal(status, 400, JSON.stringify(value));
      assert.equal(
        (json as { error: { code: string } }).error.code,
        "invalid_request",
        JSON.stringify(value),
      );
    }
    assert.equal(upstream.requests.length, 0);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test("transaction.raw: the 200000-char hex bound is inclusive and longer results are rejected", async () => {
  const atBound = "00".repeat(100_000);
  assert.equal(atBound.length, 200_000);
  const upstream = await startMockUpstream({ handler: () => atBound });
  const bridge = await startBridge({}, upstream);
  try {
    const { status, json } = await rpc(bridge.baseUrl, {
      method: "transaction.raw",
      params: [VALID_TXID],
    });
    assert.equal(status, 200);
    assert.equal((json as { result: unknown }).result, atBound);
  } finally {
    await bridge.close();
    await upstream.close();
  }

  const overBound = "00".repeat(100_001);
  const overUpstream = await startMockUpstream({ handler: () => overBound });
  const overBridge = await startBridge({}, overUpstream);
  try {
    const { status, json } = await rpc(overBridge.baseUrl, {
      method: "transaction.raw",
      params: [VALID_TXID],
    });
    assert.equal(status, 502);
    assert.equal(
      (json as { error: { code: string } }).error.code,
      "upstream_malformed",
    );
  } finally {
    await overBridge.close();
    await overUpstream.close();
  }
});

test("address.utxos: a non-array result and non-object entries are explicit errors", async () => {
  const malformed = [
    { txid: VALID_TXID, vout: 0, height: 1, value: 1 }, // object, not array
    "not-an-array",
    null,
    [null],
    [["nested"]],
    [42],
    ["entry"],
  ];
  for (const result of malformed) {
    const upstream = await startMockUpstream({ handler: () => result });
    const bridge = await startBridge({}, upstream);
    try {
      const { status, json } = await rpc(bridge.baseUrl, {
        method: "address.utxos",
        params: [VALID_ADDRESS],
      });
      assert.equal(status, 502, JSON.stringify(result));
      assert.equal(
        (json as { error: { code: string } }).error.code,
        "upstream_malformed",
        JSON.stringify(result),
      );
    } finally {
      await bridge.close();
      await upstream.close();
    }
  }
});

test("address.utxos: unsafe-integer heights are rejected and safe-integer heights are accepted", async () => {
  const entry = (height: unknown) => ({
    tx_hash: VALID_TXID,
    tx_pos: 0,
    height,
    value: 1,
  });

  // Unsafe or non-integer heights must be rejected as malformed.
  const unsafeHeights: unknown[] = [
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER + 2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    -1,
    "1",
    null,
  ];
  for (const height of unsafeHeights) {
    const upstream = await startMockUpstream({
      handler: () => [entry(height)],
    });
    const bridge = await startBridge({}, upstream);
    try {
      const { status, json } = await rpc(bridge.baseUrl, {
        method: "address.utxos",
        params: [VALID_ADDRESS],
      });
      assert.equal(status, 502, JSON.stringify(height));
      assert.equal(
        (json as { error: { code: string } }).error.code,
        "upstream_malformed",
        JSON.stringify(height),
      );
    } finally {
      await bridge.close();
      await upstream.close();
    }
  }

  // Valid non-negative safe-integer heights must still be accepted.
  const safeHeights = [0, 1, 850_000, Number.MAX_SAFE_INTEGER];
  for (const height of safeHeights) {
    const upstream = await startMockUpstream({
      handler: () => [entry(height)],
    });
    const bridge = await startBridge({}, upstream);
    try {
      const { status, json } = await rpc(bridge.baseUrl, {
        method: "address.utxos",
        params: [VALID_ADDRESS],
      });
      assert.equal(status, 200, JSON.stringify(height));
      assert.deepEqual(
        (json as { result: unknown }).result,
        [{ txid: VALID_TXID, vout: 0, height, value: 1 }],
        JSON.stringify(height),
      );
    } finally {
      await bridge.close();
      await upstream.close();
    }
  }
});

test("transaction.raw: a non-string result is rejected", async () => {
  const malformed = [42, true, null, ["00"], { hex: "00" }];
  for (const result of malformed) {
    const upstream = await startMockUpstream({ handler: () => result });
    const bridge = await startBridge({}, upstream);
    try {
      const { status, json } = await rpc(bridge.baseUrl, {
        method: "transaction.raw",
        params: [VALID_TXID],
      });
      assert.equal(status, 502, JSON.stringify(result));
      assert.equal(
        (json as { error: { code: string } }).error.code,
        "upstream_malformed",
        JSON.stringify(result),
      );
    } finally {
      await bridge.close();
      await upstream.close();
    }
  }
});

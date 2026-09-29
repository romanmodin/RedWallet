/**
 * Unit tests for configuration loading and request validation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigError, isUpstreamConfigured } from "../src/config.js";
import {
  validateRequest,
  addressToScripthash,
  decodeAddress,
} from "../src/validation.js";
import { BridgeError } from "../src/errors.js";

const SECRET = "0123456789abcdef0123456789abcdef";

test("config: refuses to start without a secret", () => {
  assert.throws(() => loadConfig({}), ConfigError);
});

test("config: refuses a short secret", () => {
  assert.throws(() => loadConfig({ BRIDGE_SECRET: "short" }), ConfigError);
});

test("config: starts with no upstream configured", () => {
  const config = loadConfig({ BRIDGE_SECRET: SECRET });
  assert.equal(config.fulcrumHost, "");
  assert.equal(isUpstreamConfigured(config), false);
});

test("config: reads upstream from the environment only", () => {
  const config = loadConfig({
    BRIDGE_SECRET: SECRET,
    FULCRUM_HOST: "127.0.0.1",
    FULCRUM_PORT: "55001",
    FULCRUM_TLS: "false",
  });
  assert.equal(config.fulcrumHost, "127.0.0.1");
  assert.equal(config.fulcrumPort, 55001);
  assert.equal(config.fulcrumTls, false);
  assert.equal(isUpstreamConfigured(config), true);
});

test("config: rejects an invalid port", () => {
  assert.throws(
    () => loadConfig({ BRIDGE_SECRET: SECRET, FULCRUM_PORT: "99999" }),
    ConfigError,
  );
});

test("validation: rejects a non-object body", () => {
  assert.throws(() => validateRequest("nope"), BridgeError);
  assert.throws(() => validateRequest(null), BridgeError);
});

test("validation: rejects an unknown method", () => {
  try {
    validateRequest({ method: "blockchain.transaction.broadcast", params: [] });
    assert.fail("expected a BridgeError");
  } catch (error) {
    assert.ok(error instanceof BridgeError);
    assert.equal(error.code, "method_not_allowed");
  }
});

test("validation: rejects a non-string method", () => {
  try {
    validateRequest({ method: 42, params: [] });
    assert.fail("expected a BridgeError");
  } catch (error) {
    assert.ok(error instanceof BridgeError);
    assert.equal(error.code, "invalid_request");
  }
});

test("validation: server.version takes no params", () => {
  const request = validateRequest({ method: "server.version", params: [] });
  assert.deepEqual(request.upstreamParams, []);
  assert.throws(
    () => validateRequest({ method: "server.version", params: ["x"] }),
    BridgeError,
  );
});

test("validation: rejects a malformed address", () => {
  try {
    validateRequest({ method: "address.balance", params: ["not-an-address"] });
    assert.fail("expected a BridgeError");
  } catch (error) {
    assert.ok(error instanceof BridgeError);
    assert.equal(error.code, "invalid_request");
  }
});

test("validation: derives a scripthash from a valid address", () => {
  // A well-known P2PKH address; format check only, no network claim.
  const address = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
  const request = validateRequest({ method: "address.balance", params: [address] });
  assert.equal(request.upstreamParams.length, 1);
  const scripthash = request.upstreamParams[0];
  assert.equal(typeof scripthash, "string");
  assert.match(scripthash as string, /^[0-9a-f]{64}$/);
  assert.equal(scripthash, addressToScripthash(address));
});

test("validation: rejects a bad base58 checksum", () => {
  // Same address with the final character changed.
  assert.equal(decodeAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3"), null);
});

test("validation: accepts a bech32 address", () => {
  const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
  assert.notEqual(addressToScripthash(address), null);
});

test("validation: fee.estimate bounds the target", () => {
  const ok = validateRequest({ method: "fee.estimate", params: [2] });
  assert.deepEqual(ok.upstreamParams, [2]);
  assert.throws(
    () => validateRequest({ method: "fee.estimate", params: [0] }),
    BridgeError,
  );
  assert.throws(
    () => validateRequest({ method: "fee.estimate", params: [99999] }),
    BridgeError,
  );
  assert.throws(
    () => validateRequest({ method: "fee.estimate", params: ["2"] }),
    BridgeError,
  );
});

test("validation: headers.checkpoint requires exactly one height", () => {
  assert.throws(() => validateRequest({ method: "headers.checkpoint", params: [] }), BridgeError);
  assert.deepEqual(
    validateRequest({ method: "headers.checkpoint", params: [800000] })
      .upstreamParams,
    [800000],
  );
  assert.throws(
    () => validateRequest({ method: "headers.checkpoint", params: [-1] }),
    BridgeError,
  );
});

test("validation: rejects a non-array params field", () => {
  assert.throws(
    () => validateRequest({ method: "server.version", params: "x" }),
    BridgeError,
  );
});


test("address: BIP350 native SegWit vector has the correct script and scripthash", () => {
  assert.equal(addressToScripthash("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"), "9623df75239b5daa7f5f03042d325b51498c4bb7059c7748b17049bf96f73888");
});

test("address: rejects checksum/version mismatches, mixed case, invalid v0 length and other networks", () => {
  const invalid = [
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh",
    "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd",
    "bC1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    "BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P",
    "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf",
    "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
  ];
  for (const address of invalid) assert.equal(addressToScripthash(address), null, address);
});

test("config: plaintext is restricted to literal loopback and listener defaults to loopback", () => {
  assert.equal(loadConfig({ BRIDGE_SECRET: SECRET }).listenHost, "127.0.0.1");
  assert.throws(() => loadConfig({ BRIDGE_SECRET: SECRET, FULCRUM_TLS: "false", FULCRUM_HOST: "example.com" }), ConfigError);
  assert.equal(loadConfig({ BRIDGE_SECRET: SECRET, FULCRUM_TLS: "false", FULCRUM_HOST: "::1" }).fulcrumHost, "::1");
  assert.equal(loadConfig({ BRIDGE_SECRET: SECRET, LISTEN_HOST: "::1" }).listenHost, "::1");
});

test("config: partial checkpoints fail startup", () => {
  assert.throws(() => loadConfig({ BRIDGE_SECRET: SECRET, CHECKPOINT_HEIGHT: "961640" }), ConfigError);
});

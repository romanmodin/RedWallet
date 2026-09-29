/**
 * PocketIC backend lane for the RedWallet bridge client.
 *
 * Installs the app's own compiled `src/backend/dist/backend.wasm` into the
 * platform's PocketIC replica and calls the real public API. This is the only
 * place the backend's bridge methods are executed for real — the frontend suite
 * mocks the actor, so it would pass identically against a canister whose
 * methods are unimplemented stubs.
 *
 * The runner supplies `POCKET_IC_URL` and `BACKEND_WASM`; it declines cleanly
 * (exit 0) when the wasm or the replica is unavailable, so this file never has
 * to guard its own environment.
 *
 * Every runtime import here is `@dfinity/pic`, `@icp-sdk/core` (a dependency of
 * `@dfinity/pic`, hoisted to the app root and therefore resolvable from this
 * directory), `vitest`, or the app's own generated declarations.
 */

import { PocketIc } from "@dfinity/pic";
import type { Actor } from "@dfinity/pic";
import { Principal } from "@icp-sdk/core/principal";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/**
 * A non-anonymous principal. `AccessControl.initialize` returns early for the
 * anonymous principal, so the first *non-anonymous* caller becomes admin.
 */
const ADMIN = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
const OTHER = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
/** A principal that is never promoted to bridge operator by any test. */
const STRANGER = Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai");

const DEMO_ADDRESS = "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4";
/** A syntactically valid 64-character lowercase hex txid (all zeros). */
const DEMO_TXID = "0".repeat(64);
const BRIDGE_URL = "https://bridge.example.invalid";
const BRIDGE_SECRET = "super-secret-deployment-token-32-characters";

let pic: PocketIc | undefined;
let actor: Actor<_SERVICE>;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  const fixture = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
    sender: ADMIN,
    controllers: [ADMIN],
  });
  actor = fixture.actor;
  // The fixture's actor defaults to the anonymous principal; the admin
  // bootstrap below must run as the same non-anonymous principal that will
  // configure the bridge.
  actor.setPrincipal(ADMIN);
  await actor._initialize_access_control();
});

afterAll(async () => {
  // `?.` because `beforeAll` may not have got that far; a failed
  // `PocketIc.create` otherwise buries the real error under a TypeError.
  await pic?.tearDown();
});

it("reports an unconfigured bridge without trapping", async () => {
  const status = await actor.getBridgeStatus();
  expect(status.configured).toBe(false);
  expect(status.checkpointConfigured).toBe(false);
});

it("returns an explicit not-configured error for every read before configuration", async () => {
  const balance = await actor.getAddressBalance(DEMO_ADDRESS);
  expect(balance).toEqual({ err: { not_configured: null } });

  const history = await actor.getAddressHistory(DEMO_ADDRESS);
  expect(history).toEqual({ err: { not_configured: null } });

  const fee = await actor.getFeeEstimate();
  expect(fee).toEqual({ err: { not_configured: null } });

  const server = await actor.getServerStatus();
  expect(server).toEqual({ err: { not_configured: null } });

  const utxos = await actor.getAddressUtxos(DEMO_ADDRESS);
  expect(utxos).toEqual({ err: { not_configured: null } });

  const raw = await actor.getRawTransaction(DEMO_TXID);
  expect(raw).toEqual({ err: { not_configured: null } });
});

it("rejects an empty address as invalid input without contacting the bridge", async () => {
  const balance = await actor.getAddressBalance("");
  expect(balance).toEqual({ err: { invalid_input: "invalid address format" } });

  const history = await actor.getAddressHistory("");
  expect(history).toEqual({ err: { invalid_input: "invalid address format" } });

  const utxos = await actor.getAddressUtxos("");
  expect(utxos).toEqual({ err: { invalid_input: "invalid address format" } });
});

it("rejects a malformed transaction id as invalid input before any upstream call", async () => {
  // Non-hex, odd-length, empty, and wrong-length ids must all be rejected by
  // the cheap pre-outcall check, so an unconfigured bridge never matters here.
  const malformed = [
    "",
    "not-hex",
    "0".repeat(63),
    "0".repeat(65),
    "g".repeat(64),
    "A".repeat(64),
    "0".repeat(63) + "z",
  ];
  for (const txid of malformed) {
    const raw = await actor.getRawTransaction(txid);
    expect(raw).toEqual({ err: { invalid_input: "invalid transaction id" } });
  }
});

it("rejects a non-HTTPS bridge base URL", async () => {
  await expect(actor.setBridgeConfig("http://bridge.example.invalid", BRIDGE_SECRET)).rejects.toThrow();
  // The rejected configuration must not have taken effect.
  const status = await actor.getBridgeStatus();
  expect(status.configured).toBe(false);
});

it("only an admin can configure or clear the bridge", async () => {
  actor.setPrincipal(OTHER);
  await expect(actor.setBridgeConfig(BRIDGE_URL, BRIDGE_SECRET)).rejects.toThrow();
  await expect(actor.clearBridgeConfig()).rejects.toThrow();
  actor.setPrincipal(ADMIN);
});

it("never returns the bridge URL or secret in a frontend-facing response", async () => {
  await actor.setBridgeConfig(BRIDGE_URL, BRIDGE_SECRET);

  const status = await actor.getBridgeStatus();
  const serialized = JSON.stringify(status);
  expect(serialized).not.toContain(BRIDGE_URL);
  expect(serialized).not.toContain(BRIDGE_SECRET);
  expect(status.configured).toBe(true);

  await actor.clearBridgeConfig();
  const cleared = await actor.getBridgeStatus();
  expect(cleared.configured).toBe(false);
});

// The configured-but-unreachable path is deliberately NOT exercised here.
// Reaching it requires a real HTTPS outcall to a host that never answers, and
// PocketIC cannot complete that ingress message: the outcall never returns, so
// the update exhausts the replica's 100-round budget and the call fails with
// `BadIngressMessage("Failed to answer to ingress ... after 100 rounds.")`
// rather than the canister's own `backend_unavailable` result. That is a
// property of the replica, not of the app, so the lane cannot assert it.
// The mapping is covered instead by the pure Motoko unit tests in
// `src/backend/test/bridge.test.mo` (non-2xx and error envelopes ->
// `backend_unavailable`) and at the frontend service seam in
// `src/frontend/src/test/bridge-service.test.ts`.

it("documents admin as operator-assigned, not first-user promotion", async () => {
  const doc = await actor.getApiDoc();
  expect(doc).toContain("pre-assigned by the operator configuration/migration");
  expect(doc).toContain("first-user admin promotion is disabled");
  // The corrected prose must not claim registration order grants admin.
  expect(doc).not.toMatch(/first (user|caller)[^.]*becomes? admin/i);
  expect(doc).not.toMatch(/first (user|caller)[^.]*is (made )?admin/i);
});

it("documents the two read-only methods and the absence of any write endpoint", async () => {
  const doc = await actor.getApiDoc();
  expect(doc).toContain("getAddressUtxos");
  expect(doc).toContain("getRawTransaction");
  expect(doc).toContain("no broadcast, signing, or private-key endpoint");
});

it("strips volatile headers in the consensus transform", async () => {
  const transformed = await actor.transformBridgeResponse({
    context: new Uint8Array(),
    response: {
      status: 200n,
      body: new Uint8Array([1, 2, 3]),
      headers: [{ name: "date", value: "now" }],
    },
  });
  expect(transformed.status).toBe(200n);
  expect(Array.from(transformed.body)).toEqual([1, 2, 3]);
  expect(transformed.headers).toEqual([]);
});

it("public role bootstrap cannot grant bridge configuration authority", async () => {
  actor.setPrincipal(OTHER);
  await actor._initialize_access_control();
  expect((await actor.getBridgeOperatorStatus()).isOperator).toBe(false);
  await expect(actor.setBridgeConfig(BRIDGE_URL, BRIDGE_SECRET)).rejects.toThrow();
  await expect(actor.setBridgeOperator(OTHER)).rejects.toThrow();
  actor.setPrincipal(ADMIN);
  await actor.setBridgeOperator(OTHER);
  actor.setPrincipal(OTHER);
  expect((await actor.getBridgeOperatorStatus()).isOperator).toBe(true);
  await actor.setBridgeConfig(BRIDGE_URL, BRIDGE_SECRET);
  await actor.clearBridgeConfig();
  actor.setPrincipal(ADMIN);
});

it("a non-operator caller cannot grant itself bridge authority for the new reads", async () => {
  // A principal that no earlier test promoted to operator.
  actor.setPrincipal(STRANGER);
  await actor._initialize_access_control();
  // The new read-only methods are unrestricted reads, but they must not confer
  // or accept bridge authority: a public caller still cannot configure the
  // bridge or appoint itself operator.
  expect((await actor.getBridgeOperatorStatus()).isOperator).toBe(false);
  await expect(actor.setBridgeConfig(BRIDGE_URL, BRIDGE_SECRET)).rejects.toThrow();
  await expect(actor.setBridgeOperator(STRANGER)).rejects.toThrow();
  // With no bridge configured, the new reads return the explicit not-configured
  // error rather than succeeding or leaking configuration.
  expect(await actor.getAddressUtxos(DEMO_ADDRESS)).toEqual({ err: { not_configured: null } });
  expect(await actor.getRawTransaction(DEMO_TXID)).toEqual({ err: { not_configured: null } });
  actor.setPrincipal(ADMIN);
});

it("never leaks the bridge URL or secret through the new read error paths", async () => {
  await actor.setBridgeConfig(BRIDGE_URL, BRIDGE_SECRET);

  // Invalid input is rejected before any outcall, so the error carries only the
  // fixed message and never the configured URL or secret.
  const badAddress = await actor.getAddressUtxos("");
  expect(JSON.stringify(badAddress)).not.toContain(BRIDGE_URL);
  expect(JSON.stringify(badAddress)).not.toContain(BRIDGE_SECRET);

  const badTxid = await actor.getRawTransaction("not-hex");
  expect(JSON.stringify(badTxid)).not.toContain(BRIDGE_URL);
  expect(JSON.stringify(badTxid)).not.toContain(BRIDGE_SECRET);

  await actor.clearBridgeConfig();
});

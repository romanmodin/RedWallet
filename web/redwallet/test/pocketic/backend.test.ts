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

const DEMO_ADDRESS = "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4";
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
});

it("rejects an empty address as invalid input without contacting the bridge", async () => {
  const balance = await actor.getAddressBalance("");
  expect(balance).toEqual({ err: { invalid_input: "invalid address format" } });

  const history = await actor.getAddressHistory("");
  expect(history).toEqual({ err: { invalid_input: "invalid address format" } });
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

/**
 * Read-only spending-data seam tests.
 *
 * Covers the two new read-only bridge adapters on `BridgeWalletService`:
 * `getAddressUtxos` and `getRawTransaction`. Both are service-layer
 * capabilities only — no page, hook, or context may reference them, and the
 * result is never used to construct, sign, or broadcast a spend.
 *
 * The actor mock mirrors the pattern in `bridge-service.test.ts`; the
 * `BridgeActor` literal must include every method the service reads.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { BridgeActor } from "@/services/bridgeService";
import { BridgeWalletService } from "@/services/bridgeService";
import { describe, expect, it, vi } from "vitest";

const ADDRESS = "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4";
const TXID = "a".repeat(64);

function makeActor(overrides: Partial<BridgeActor> = {}): BridgeActor {
  return {
    getBridgeStatus: vi.fn(async () => ({
      configured: true,
      checkpointConfigured: true,
    })),
    getAddressBalance: vi.fn(async () => ({
      __kind__: "ok" as const,
      ok: { confirmed: 100000000n, unconfirmed: 0n },
    })),
    getAddressHistory: vi.fn(async () => ({
      __kind__: "ok" as const,
      ok: { entries: [] },
    })),
    getAddressUtxos: vi.fn(async () => ({
      __kind__: "ok" as const,
      ok: {
        utxos: [
          { txid: TXID, vout: 0, height: 974000n, value: 100000000n },
          { txid: TXID, vout: 1, height: 0n, value: 546n },
        ],
      },
    })),
    getRawTransaction: vi.fn(async () => ({
      __kind__: "ok" as const,
      ok: { hex: "0200000001" },
    })),
    getFeeEstimate: vi.fn(async () => ({
      __kind__: "ok" as const,
      ok: { satoshisPerKb: 12000n },
    })),
    getServerStatus: vi.fn(async () => ({
      __kind__: "ok" as const,
      ok: {
        serverVersion: "Fulcrum",
        protocolVersion: "1.4",
        height: 974001n,
        checkpointConfigured: true,
        checkpointHeight: 973440n,
        checkpointHash: "b".repeat(64),
      },
    })),
    ...overrides,
  };
}

describe("getAddressUtxos (read-only)", () => {
  it("returns ok with the typed UTXO list for a valid address", async () => {
    const actor = makeActor();
    const service = new BridgeWalletService(async () => actor);
    const result = await service.getAddressUtxos(ADDRESS);
    expect(result).toEqual({
      ok: true,
      value: {
        utxos: [
          { txid: TXID, vout: 0, height: 974000n, value: 100000000n },
          { txid: TXID, vout: 1, height: 0n, value: 546n },
        ],
      },
    });
    expect(actor.getAddressUtxos).toHaveBeenCalledWith(ADDRESS);
  });

  it("trims surrounding whitespace before the read", async () => {
    const actor = makeActor();
    const service = new BridgeWalletService(async () => actor);
    await service.getAddressUtxos(`  ${ADDRESS}  `);
    expect(actor.getAddressUtxos).toHaveBeenCalledWith(ADDRESS);
  });

  it("rejects an empty address without contacting the bridge", async () => {
    const actor = makeActor();
    const service = new BridgeWalletService(async () => actor);
    expect(await service.getAddressUtxos("   ")).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(actor.getAddressUtxos).not.toHaveBeenCalled();
  });

  it("maps a not_configured err result to a ServiceError", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getBridgeStatus: vi.fn(async () => ({
          configured: false,
          checkpointConfigured: false,
        })),
      }),
    );
    expect(await service.getAddressUtxos(ADDRESS)).toMatchObject({
      ok: false,
      error: { code: "not_configured" },
    });
  });

  it("maps a backend_unavailable err result to a ServiceError", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getAddressUtxos: vi.fn(async () => ({
          __kind__: "err" as const,
          err: {
            __kind__: "backend_unavailable" as const,
            backend_unavailable: "bridge offline",
          },
        })),
      }),
    );
    expect(await service.getAddressUtxos(ADDRESS)).toMatchObject({
      ok: false,
      error: { code: "backend_unavailable", message: "bridge offline" },
    });
  });

  it("maps an invalid_input err result to a ServiceError", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getAddressUtxos: vi.fn(async () => ({
          __kind__: "err" as const,
          err: {
            __kind__: "invalid_input" as const,
            invalid_input: "invalid address format",
          },
        })),
      }),
    );
    expect(await service.getAddressUtxos(ADDRESS)).toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: "invalid address format" },
    });
  });

  it("maps a malformed_response err result to an unknown ServiceError", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getAddressUtxos: vi.fn(async () => ({
          __kind__: "err" as const,
          err: {
            __kind__: "malformed_response" as const,
            malformed_response: "bad utxo payload",
          },
        })),
      }),
    );
    expect(await service.getAddressUtxos(ADDRESS)).toMatchObject({
      ok: false,
      error: { code: "unknown" },
    });
  });

  it("never throws to the UI when the actor rejects", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getAddressUtxos: vi.fn(async () => {
          throw new Error("transport exploded");
        }),
      }),
    );
    await expect(service.getAddressUtxos(ADDRESS)).resolves.toMatchObject({
      ok: false,
      error: { code: "backend_unavailable" },
    });
  });

  it("reports backend_unavailable when no actor can be resolved", async () => {
    const service = new BridgeWalletService(async () => null);
    expect(await service.getAddressUtxos(ADDRESS)).toMatchObject({
      ok: false,
      error: { code: "backend_unavailable" },
    });
  });
});

describe("getRawTransaction (read-only)", () => {
  it("returns ok with the hex for a valid txid", async () => {
    const actor = makeActor({
      getRawTransaction: vi.fn(async () => ({
        __kind__: "ok" as const,
        ok: { hex: "0200000001abcdef" },
      })),
    });
    const service = new BridgeWalletService(async () => actor);
    const result = await service.getRawTransaction(TXID);
    expect(result).toEqual({ ok: true, value: { hex: "0200000001abcdef" } });
    expect(actor.getRawTransaction).toHaveBeenCalledWith(TXID);
  });

  it("rejects a non-64-character or non-lowercase-hex txid without a read", async () => {
    const actor = makeActor();
    const service = new BridgeWalletService(async () => actor);
    for (const bad of [
      "",
      "abc",
      "A".repeat(64),
      "g".repeat(64),
      `${"a".repeat(63)}z`,
    ]) {
      expect(await service.getRawTransaction(bad)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
    expect(actor.getRawTransaction).not.toHaveBeenCalled();
  });

  it("maps a not_configured err result to a ServiceError", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getBridgeStatus: vi.fn(async () => ({
          configured: false,
          checkpointConfigured: false,
        })),
      }),
    );
    expect(await service.getRawTransaction(TXID)).toMatchObject({
      ok: false,
      error: { code: "not_configured" },
    });
  });

  it("maps a backend_unavailable err result to a ServiceError", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getRawTransaction: vi.fn(async () => ({
          __kind__: "err" as const,
          err: {
            __kind__: "backend_unavailable" as const,
            backend_unavailable: "bridge offline",
          },
        })),
      }),
    );
    expect(await service.getRawTransaction(TXID)).toMatchObject({
      ok: false,
      error: { code: "backend_unavailable", message: "bridge offline" },
    });
  });

  it("maps an invalid_input err result to a ServiceError", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getRawTransaction: vi.fn(async () => ({
          __kind__: "err" as const,
          err: {
            __kind__: "invalid_input" as const,
            invalid_input: "invalid transaction id",
          },
        })),
      }),
    );
    expect(await service.getRawTransaction(TXID)).toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: "invalid transaction id" },
    });
  });

  it("maps a malformed_response err result to an unknown ServiceError", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getRawTransaction: vi.fn(async () => ({
          __kind__: "err" as const,
          err: {
            __kind__: "malformed_response" as const,
            malformed_response: "bad raw payload",
          },
        })),
      }),
    );
    expect(await service.getRawTransaction(TXID)).toMatchObject({
      ok: false,
      error: { code: "unknown" },
    });
  });

  it("never throws to the UI when the actor rejects", async () => {
    const service = new BridgeWalletService(async () =>
      makeActor({
        getRawTransaction: vi.fn(async () => {
          throw new Error("transport exploded");
        }),
      }),
    );
    await expect(service.getRawTransaction(TXID)).resolves.toMatchObject({
      ok: false,
      error: { code: "backend_unavailable" },
    });
  });

  it("reports backend_unavailable when no actor can be resolved", async () => {
    const service = new BridgeWalletService(async () => null);
    expect(await service.getRawTransaction(TXID)).toMatchObject({
      ok: false,
      error: { code: "backend_unavailable" },
    });
  });
});

describe("read-only spending-data invariant", () => {
  const FRONTEND_SRC = resolve(process.cwd(), "src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === "dist") continue;
        walk(full, out);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  it("is not referenced by any page, hook, or context", () => {
    const offenders: string[] = [];
    for (const file of walk(FRONTEND_SRC)) {
      const rel = relative(FRONTEND_SRC, file).split("\\").join("/");
      // The generated bindings and the service seam are the only permitted
      // references; pages, hooks, contexts, and components must not reach in.
      if (
        rel.startsWith("test/") ||
        rel.startsWith("lib/") ||
        rel === "backend.ts" ||
        rel === "backend.d.ts" ||
        rel.startsWith("declarations/") ||
        rel === "services/bridgeService.ts"
      )
        continue;
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        if (/getAddressUtxos|getRawTransaction/.test(line)) {
          offenders.push(`${rel}: ${trimmed}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BridgeActor } from "@/services/bridgeService";
import { describe, expect, it, vi } from "vitest";
import type { AccountSnapshot } from "./account-reader";
import { IssuedAddresses } from "./issued-addresses";
import { publicAddress } from "./key-material";
import { SpendPreparation } from "./spend-preparation";
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../test/regtest/xbt-web-signed-20260929.json"),
    "utf8",
  ),
);
function setup() {
  const xpub = fixture.plan.accountXpub;
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const book = new IssuedAddresses(
    xpub,
    storage,
    async (_name, fn) => await fn(),
  );
  const used = fixture.plan.inputs.map(
    (c: { branch: 0 | 1; index: number }) => ({
      branch: c.branch,
      index: c.index,
      address: publicAddress(xpub, c.branch, c.index),
    }),
  );
  const snapshot: AccountSnapshot = {
    branches: [
      {
        used,
        next: { branch: 0, index: 2, address: publicAddress(xpub, 0, 2) },
        scanned: 22,
      },
      {
        used: [],
        next: { branch: 1, index: 0, address: publicAddress(xpub, 1, 0) },
        scanned: 20,
      },
    ],
    confirmed: 100000n,
    unconfirmed: 0n,
    history: [],
    height: 974750,
    observedAt: Date.now(),
  };
  const actor = {
    getServerStatus: vi.fn(async () => ({
      __kind__: "ok",
      ok: {
        height: 974750n,
        checkpointConfigured: true,
        checkpointHeight: 961640n,
        checkpointHash:
          "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
        broadcastEnabled: true,
      },
    })),
    getFeeEstimate: vi.fn(async () => ({
      __kind__: "ok",
      ok: { satoshisPerKb: 1000n },
    })),
    getAddressUtxos: vi.fn(async (address: string) => ({
      __kind__: "ok",
      ok: {
        utxos: fixture.plan.inputs
          .filter(
            (c: { branch: 0 | 1; index: number }) =>
              publicAddress(xpub, c.branch, c.index) === address,
          )
          .map(
            (c: {
              txid: string;
              vout: number;
              value: string;
              height: number;
            }) => ({
              txid: c.txid,
              vout: c.vout,
              value: BigInt(c.value),
              height: BigInt(c.height),
            }),
          ),
      },
    })),
    getRawTransaction: vi.fn(async () => ({
      __kind__: "ok",
      ok: { hex: fixture.plan.inputs[0].parentHex },
    })),
  };
  let clock = 0;
  const reader = new SpendPreparation(
    xpub,
    actor as unknown as BridgeActor,
    book,
    () => clock,
    async (ms) => {
      clock += ms;
    },
  );
  return { reader, actor, snapshot, book };
}
describe("live public spend preparation", () => {
  it("verifies parents, deduplicates raw reads and reserves change before review", async () => {
    const f = setup();
    const { review, suggestedFeeRate } = await f.reader.prepare(
      f.snapshot,
      fixture.plan.destination,
      "0.00090000",
      1,
    );
    expect(review.plan.amount).toBe("90000");
    expect(review.plan.fee).toBe("211");
    expect(review.plan.change).toBe("9789");
    expect(f.book.read()[1]).toBe(0);
    expect(suggestedFeeRate).toBe(1);
    expect(f.actor.getRawTransaction).toHaveBeenCalledTimes(1);
    expect(f.actor.getServerStatus).toHaveBeenCalledTimes(2);
  });
  it("fails closed when operator disabled sending, checkpoint wrong or snapshot stale", async () => {
    const f = setup();
    const status = await f.actor.getServerStatus();
    f.actor.getServerStatus.mockResolvedValue({
      ...status,
      ok: { ...status.ok, broadcastEnabled: false },
    });
    await expect(
      f.reader.prepare(f.snapshot, fixture.plan.destination, "0.00090000", 1),
    ).rejects.toThrow(/not enabled/);
    expect(f.actor.getAddressUtxos).not.toHaveBeenCalled();
    f.actor.getServerStatus.mockResolvedValue({
      ...status,
      ok: { ...status.ok, checkpointHash: "b".repeat(64) },
    });
    await expect(
      f.reader.prepare(f.snapshot, fixture.plan.destination, "0.00090000", 1),
    ).rejects.toThrow(/checkpoint/);
    f.snapshot.observedAt = Date.now() - 300001;
    await expect(
      f.reader.prepare(f.snapshot, fixture.plan.destination, "0.00090000", 1),
    ).rejects.toThrow(/Scan/);
  });
  it("never creates a review or consumes change for a substituted raw parent", async () => {
    const f = setup();
    f.actor.getRawTransaction.mockResolvedValue({
      __kind__: "ok",
      ok: { hex: "00" },
    });
    await expect(
      f.reader.prepare(f.snapshot, fixture.plan.destination, "0.00090000", 1),
    ).rejects.toThrow();
    expect(f.book.read()[1]).toBe(-1);
  });
});

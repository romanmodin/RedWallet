import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BridgeActor } from "@/services/bridgeService";
import { Transaction, address, script } from "bitcoinjs-lib";
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
    getAddressHistory: vi.fn(async () => ({
      __kind__: "ok",
      ok: { entries: [] as { txid: string; height: bigint }[] },
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
  it("fails closed when operator disabled sending, checkpoint wrong or invalid cached observations", async () => {
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
    f.snapshot.observedAt = Number.NaN;
    await expect(
      f.reader.prepare(f.snapshot, fixture.plan.destination, "0.00090000", 1),
    ).rejects.toThrow(/saved account/);
  });
  it("revalidates an old scan against live coins instead of requiring full discovery", async () => {
    const f = setup();
    f.snapshot.observedAt = Date.now() - 86400000;
    f.snapshot.confirmed = 2100000000000000n; // cached balance is never an input
    const result = await f.reader.prepare(
      f.snapshot,
      fixture.plan.destination,
      "0.00090000",
      1,
    );
    expect(result.review.plan.amount).toBe("90000");
    expect(f.actor.getRawTransaction).toHaveBeenCalled();
    expect(f.actor.getServerStatus).toHaveBeenCalledTimes(2);
    f.actor.getAddressUtxos.mockResolvedValue({
      __kind__: "ok",
      ok: { utxos: [] },
    });
    await expect(
      f.reader.prepare(f.snapshot, fixture.plan.destination, "0.00090000", 1),
    ).rejects.toThrow();
  });
  it("checks locally issued addresses absent from historical used-address hints", async () => {
    const f = setup();
    await f.book.reserve(0, 1);
    f.snapshot.branches[0].used = [];
    const result = await f.reader.prepare(
      f.snapshot,
      fixture.plan.destination,
      "0.00090000",
      1,
    );
    expect(result.review.plan.amount).toBe("90000");
  });
  it("skips reserved change with live history despite an old scan", async () => {
    const f = setup();
    f.actor.getAddressHistory.mockResolvedValueOnce({
      __kind__: "ok",
      ok: { entries: [{ txid: "a".repeat(64), height: 974750n }] },
    });
    const { review } = await f.reader.prepare(
      f.snapshot,
      fixture.plan.destination,
      "0.00090000",
      1,
    );
    expect(review.plan.changeIndex).toBe(1);
    expect(f.actor.getAddressHistory).toHaveBeenCalledTimes(2);
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

it("skips verified immature rewards while ordinary coins remain spendable, and rejects forged age", async () => {
  const f = setup();
  const input = fixture.plan.inputs[0];
  const reward = new Transaction();
  reward.version = 2;
  reward.addInput(
    new Uint8Array(32),
    0xffffffff,
    undefined,
    script.compile([script.number.encode(974700)]),
  );
  reward.addOutput(
    address.toOutputScript(
      publicAddress(fixture.plan.accountXpub, input.branch, input.index),
    ),
    200000n,
  );
  const ordinaryRead = f.actor.getAddressUtxos.getMockImplementation()!;
  const ordinaryRaw = f.actor.getRawTransaction.getMockImplementation()!;
  let fakeHeight = 974700n;
  let onlyReward = false;
  f.actor.getAddressUtxos.mockImplementation(async (addr: string) => {
    const result = await ordinaryRead(addr);
    if (
      addr ===
      publicAddress(fixture.plan.accountXpub, input.branch, input.index)
    )
      result.ok.utxos = [
        ...(onlyReward ? [] : result.ok.utxos),
        { txid: reward.getId(), vout: 0, value: 200000n, height: fakeHeight },
      ];
    else if (onlyReward) result.ok.utxos = [];
    return result;
  });
  f.actor.getRawTransaction.mockImplementation(async (...args: unknown[]) =>
    args[0] === reward.getId()
      ? { __kind__: "ok", ok: { hex: reward.toHex() } }
      : ordinaryRaw(),
  );
  const result = await f.reader.prepare(
    f.snapshot,
    fixture.plan.destination,
    "0.00090000",
    1,
  );
  expect(
    result.review.plan.inputs.some((coin) => coin.txid === reward.getId()),
  ).toBe(false);
  fakeHeight = 960000n;
  await expect(
    f.reader.prepare(f.snapshot, fixture.plan.destination, "0.00090000", 1),
  ).rejects.toThrow(/height does not match/);
  fakeHeight = 974700n;
  onlyReward = true;
  await expect(
    f.reader.prepare(f.snapshot, fixture.plan.destination, "0.00090000", 1),
  ).rejects.toThrow(/Only immature mining rewards/);
});

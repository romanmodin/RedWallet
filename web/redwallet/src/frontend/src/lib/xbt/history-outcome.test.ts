import { Buffer } from "buffer";
import type { BridgeActor } from "@/services/bridgeService";
import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it, vi } from "vitest";
import {
  HistoryReader,
  HistoryTransactions,
  historyOutcome,
  historyTransaction,
  parentId,
} from "./history-outcome";

const own = Buffer.from(`0014${"11".repeat(20)}`, "hex");
const external = Buffer.from(`0014${"22".repeat(20)}`, "hex");
const scripts = new Set([own.toString("hex")]);
function transaction(
  inputs: { id: string; index: number }[],
  outputs: { script: Uint8Array; value: bigint }[],
) {
  const tx = new Transaction();
  for (const input of inputs)
    tx.addInput(Buffer.from(input.id, "hex").reverse(), input.index);
  for (const output of outputs) tx.addOutput(output.script, output.value);
  return tx;
}
const funding = transaction(
  [{ id: "a".repeat(64), index: 0 }],
  [{ script: external, value: 2000000n }],
);
const receive = transaction(
  [{ id: funding.getId(), index: 0 }],
  [
    { script: own, value: 1000000n },
    { script: external, value: 999800n },
  ],
);
const send = transaction(
  [{ id: receive.getId(), index: 0 }],
  [
    { script: external, value: 500000n },
    { script: own, value: 499858n },
  ],
);
const parents = new Map([
  [funding.getId(), funding.toHex()],
  [receive.getId(), receive.toHex()],
]);
const outcome = (tx: Transaction, proofs = parents) =>
  historyOutcome(tx.getId(), tx.toHex(), proofs, scripts);

describe("verified transaction history accounting", () => {
  it("shows received amounts and sent amounts excluding change, with exact fee and balance change", () => {
    expect(outcome(receive)).toEqual({
      kind: "received",
      amount: 1000000n,
      balanceChange: 1000000n,
      fee: null,
    });
    expect(outcome(send)).toEqual({
      kind: "sent",
      amount: -500000n,
      balanceChange: -500142n,
      fee: 142n,
    });
  });
  it("does not count self-transfer outputs as another incoming payment", () => {
    const tx = transaction(
      [{ id: receive.getId(), index: 0 }],
      [{ script: own, value: 999900n }],
    );
    expect(outcome(tx)).toEqual({
      kind: "self",
      amount: 0n,
      balanceChange: -100n,
      fee: 100n,
    });
  });
  it("reports net change for mixed ownership without assigning another participant's fee", () => {
    const tx = transaction(
      [
        { id: receive.getId(), index: 0 },
        { id: funding.getId(), index: 0 },
      ],
      [
        { script: own, value: 900000n },
        { script: external, value: 2099700n },
      ],
    );
    expect(outcome(tx)).toEqual({
      kind: "net",
      amount: -100000n,
      balanceChange: -100000n,
      fee: null,
    });
  });
  it("handles coinbase receipts without fabricated parents or fees", () => {
    const tx = transaction(
      [{ id: "0".repeat(64), index: 0xffffffff }],
      [{ script: own, value: 1000000n }],
    );
    expect(outcome(tx, new Map())).toMatchObject({
      kind: "received",
      amount: 1000000n,
      fee: null,
    });
  });
  it("rejects missing, altered and invalid parent outputs rather than inventing zero amounts", () => {
    expect(() => outcome(send, new Map())).toThrow(/unavailable/);
    const altered = receive.clone();
    altered.outs[0].value = 2000000n;
    expect(() =>
      outcome(send, new Map([[receive.getId(), altered.toHex()]])),
    ).toThrow(/verified/);
    const invalid = transaction(
      [{ id: receive.getId(), index: 9 }],
      [{ script: external, value: 1n }],
    );
    expect(() => outcome(invalid)).toThrow(/parent output/);
  });
  it("rejects duplicate inputs, impossible totals and transactions outside the discovered account", () => {
    const duplicate = transaction(
      [
        { id: receive.getId(), index: 0 },
        { id: receive.getId(), index: 0 },
      ],
      [{ script: external, value: 1n }],
    );
    expect(() => outcome(duplicate)).toThrow(/Duplicate/);
    const impossible = transaction(
      [{ id: receive.getId(), index: 0 }],
      [{ script: external, value: 1000001n }],
    );
    expect(() => outcome(impossible)).toThrow(/accounting/);
    expect(() =>
      historyOutcome(receive.getId(), receive.toHex(), parents, new Set()),
    ).toThrow(/match/);
    expect(() =>
      historyTransaction(send.getId(), `${send.toHex()}00`),
    ).toThrow();
  });
  it("restores raw proofs and recomputes amounts; damaged cache never overrides scan or vault storage", () => {
    const cache = new HistoryTransactions("public-test-scope");
    for (const [id, hex] of parents) cache.raw.set(id, hex);
    cache.raw.set(send.getId(), send.toHex());
    cache.save();
    const restored = new HistoryTransactions("public-test-scope");
    expect(restored.outcome(send.getId(), scripts)?.amount).toBe(-500000n);
    expect(restored.outcome(send.getId(), new Set())).toBeNull();
    localStorage.setItem(
      cache.key,
      JSON.stringify([[send.getId(), receive.toHex()]]),
    );
    expect(new HistoryTransactions("public-test-scope").raw.size).toBe(0);
    expect(localStorage.getItem(cache.key)).not.toBeNull();
  });
  it("deduplicates parents and resumes saved amounts without fetching completed entries", async () => {
    const cache = new HistoryTransactions("public-reader-scope");
    const raw = new Map([...parents, [send.getId(), send.toHex()]]);
    const actor = {
      getServerStatus: vi.fn(async () => ({
        __kind__: "ok",
        ok: {
          height: 974890n,
          checkpointConfigured: true,
          checkpointHeight: 961640n,
          checkpointHash:
            "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
        },
      })),
      getRawTransaction: vi.fn(async (id: string) => ({
        __kind__: "ok",
        ok: { hex: raw.get(id) },
      })),
    } as unknown as BridgeActor;
    let now = 0;
    const wait = vi.fn(async (ms: number) => {
      now += ms;
    });
    const reader = new HistoryReader(actor, cache, () => now, wait);
    await reader.load([receive.getId(), send.getId()], scripts);
    expect(actor.getRawTransaction).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledWith(3500, undefined);
    expect(parentId(send.ins[0].hash)).toBe(receive.getId());
    await reader.load([send.getId()], scripts);
    expect(actor.getRawTransaction).toHaveBeenCalledTimes(3);
  });
  it("requires the XBT checkpoint, respects cancellation and does not broadcast", async () => {
    const cache = new HistoryTransactions("public-error-scope");
    const actor = {
      getServerStatus: vi.fn(async () => ({
        __kind__: "ok",
        ok: { height: 974890n, checkpointConfigured: false },
      })),
      getRawTransaction: vi.fn(),
      broadcastSignedTransaction: vi.fn(),
    } as unknown as BridgeActor;
    const reader = new HistoryReader(actor, cache);
    await expect(reader.load([send.getId()], scripts)).rejects.toThrow(
      /checkpoint/,
    );
    expect(actor.getRawTransaction).not.toHaveBeenCalled();
    const abort = new AbortController();
    abort.abort();
    await expect(
      reader.load([send.getId()], scripts, abort.signal),
    ).rejects.toThrow(/paused/);
    expect((actor as any).broadcastSignedTransaction).not.toHaveBeenCalled();
  });
});

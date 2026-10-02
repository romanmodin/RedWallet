import type { BridgeActor } from "@/services/bridgeService";
import { describe, expect, it, vi } from "vitest";
import { AccountReader } from "./account-reader";
import {
  accountViewSession,
  clearAccountViewSessions,
} from "./account-view-session";
import { XbtKeySession, publicAddress } from "./key-material";
import {
  type ScanCheckpoint,
  loadScanCheckpoint,
  saveScanCheckpoint,
} from "./scan-checkpoint";

function fixture() {
  const keys = new XbtKeySession(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  const xpub = keys.account.accountXpub;
  keys.destroy();
  const used = new Set([publicAddress(xpub, 0, 0), publicAddress(xpub, 1, 0)]);
  const actor = {
    getServerStatus: vi.fn(async () => ({
      __kind__: "ok",
      ok: {
        height: 974742n,
        checkpointConfigured: true,
        checkpointHeight: 961640n,
        checkpointHash:
          "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
        protocolVersion: "1.4",
        serverVersion: "fixture",
      },
    })),
    getAddressHistory: vi.fn(async (address: string) => ({
      __kind__: "ok",
      ok: {
        entries: used.has(address)
          ? [{ txid: "a".repeat(64), height: 974000n }]
          : [],
      },
    })),
    getAddressBalance: vi.fn(async () => ({
      __kind__: "ok",
      ok: { confirmed: 900719925474n, unconfirmed: -1n },
    })),
  };
  let clock = 0;
  const starts: number[] = [];
  const reader = () =>
    new AccountReader(
      xpub,
      actor as unknown as BridgeActor,
      { issuedThrough: [0, -1] },
      () => clock,
      async (ms) => {
        starts.push(ms);
        clock += ms;
      },
    );
  return { actor, reader, starts, xpub };
}
describe("public account discovery and aggregation", () => {
  it("paces public reads, requires the XBT checkpoint and deduplicates shared history", async () => {
    const f = fixture();
    const snapshot = await f.reader().scan();
    expect(snapshot.confirmed).toBe(1801439850948n);
    expect(snapshot.unconfirmed).toBe(-2n);
    expect(snapshot.history).toEqual([
      { txid: "a".repeat(64), height: 974000n },
    ]);
    expect(snapshot.branches.map((b) => b.used.length)).toEqual([1, 1]);
    expect(f.actor.getAddressBalance).toHaveBeenCalledTimes(2);
    expect(f.actor.getServerStatus).toHaveBeenCalledTimes(2);
    expect(f.starts.every((ms) => ms === 3500)).toBe(true);
  });
  it("never treats wrong checkpoints or failed history as an empty wallet", async () => {
    const f = fixture();
    f.actor.getServerStatus.mockResolvedValueOnce({
      __kind__: "ok",
      ok: {
        height: 974742n,
        checkpointConfigured: true,
        checkpointHeight: 961640n,
        checkpointHash: "b".repeat(64),
        protocolVersion: "1.4",
        serverVersion: "fixture",
      },
    });
    await expect(f.reader().scan()).rejects.toThrow(/checkpoint/);
    expect(f.actor.getAddressHistory).not.toHaveBeenCalled();
    f.actor.getAddressHistory.mockRejectedValueOnce(Error("offline"));
    await expect(f.reader().scan()).rejects.toThrow("offline");
    expect(f.actor.getAddressBalance).not.toHaveBeenCalled();
  });
  it("cancels an in-flight read without starting another until it settles", async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    f.actor.getAddressHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ __kind__: "ok", ok: { entries: [] } });
        }),
    );
    const reader = f.reader();
    const abort = new AbortController();
    const scanning = reader.scan(abort.signal);
    const failure = expect(scanning).rejects.toThrow(/cancelled/);
    await vi.waitFor(() => expect(finish).toBeDefined());
    abort.abort();
    await failure;
    await expect(reader.scan()).rejects.toThrow(/still finishing/);
    expect(f.actor.getAddressHistory).toHaveBeenCalledTimes(1);
    finish?.();
  });
});

it("saves each successful address and resumes after reload/reconnect without repeating history or pacing cached reads", async () => {
  localStorage.clear();
  const f = fixture();
  const startedAt = Date.now();
  const abort = new AbortController();
  let time = 0;
  const wait = vi.fn(async (ms: number) => {
    time += ms;
  });
  const save = (checkpoint: ScanCheckpoint) => {
    saveScanCheckpoint(f.xpub, checkpoint);
    if (checkpoint.history.length === 6) abort.abort();
  };
  const first = new AccountReader(
    f.xpub,
    f.actor as unknown as BridgeActor,
    {},
    () => time,
    wait,
    { onCheckpoint: save },
  );
  await expect(first.scan(abort.signal)).rejects.toThrow(/cancelled/);
  expect(f.actor.getAddressHistory).toHaveBeenCalledTimes(6);
  const checkpoint = loadScanCheckpoint(f.xpub)!;
  expect(checkpoint.history).toHaveLength(6);
  expect(checkpoint.startedAt).toBeGreaterThanOrEqual(startedAt);
  clearAccountViewSessions(true);
  const nextActor = { ...f.actor } as unknown as BridgeActor;
  const session = accountViewSession(nextActor, f.xpub);
  expect(session.checked).toBe(6);
  expect(session.checkpoint).toEqual(checkpoint);
  // Model an overnight pause. A checkpoint is historical, not freshly stamped.
  time += 86400000;
  const progress = vi.fn();
  wait.mockClear();
  const second = new AccountReader(f.xpub, nextActor, {}, () => time, wait, {
    checkpoint: session.checkpoint,
    onCheckpoint: (value) => saveScanCheckpoint(f.xpub, value),
  });
  const result = await second.scan(undefined, progress);
  expect(f.actor.getAddressHistory).toHaveBeenCalledTimes(42);
  expect(
    new Set(f.actor.getAddressHistory.mock.calls.map(([address]) => address))
      .size,
  ).toBe(42);
  expect(progress.mock.calls.every(([value]) => value.checked >= 6)).toBe(true);
  expect(wait).toHaveBeenCalledTimes(39); // 36 new histories, 2 balances, final status
  expect(result.observedAt).toBe(checkpoint.startedAt);
  expect(result.history).toEqual([{ txid: "a".repeat(64), height: 974000n }]);
  localStorage.clear();
});
it("resumes balance aggregation after discovery completed and keeps fresh balance/checkpoint reads", async () => {
  const f = fixture();
  f.actor.getAddressBalance.mockRejectedValueOnce(Error("connection closed"));
  const reader = f.reader();
  await expect(reader.scan()).rejects.toThrow("connection closed");
  const historyCalls = f.actor.getAddressHistory.mock.calls.length;
  const snapshot = await reader.scan();
  expect(f.actor.getAddressHistory).toHaveBeenCalledTimes(historyCalls);
  expect(f.actor.getAddressBalance).toHaveBeenCalledTimes(3);
  expect(f.actor.getServerStatus).toHaveBeenCalledTimes(3);
  expect(snapshot.history).toHaveLength(1);
});

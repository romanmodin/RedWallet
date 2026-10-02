import { afterEach, expect, it, vi } from "vitest";
import { publicStorageKey } from "./public-wallet-storage";
import { loadScanCheckpoint, saveScanCheckpoint } from "./scan-checkpoint";
const address = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("round-trips bounded public history and isolates accounts", () => {
  const value = {
    startedAt: Date.now(),
    gap: 20,
    cap: 1000,
    history: [[address, [{ txid: "a".repeat(64), height: 974000n }]]],
  } as const;
  saveScanCheckpoint("account-a", {
    ...value,
    history: [[address, [...value.history[0][1]]]],
  });
  expect(loadScanCheckpoint("account-a")).toEqual(value);
  expect(loadScanCheckpoint("account-b")).toBeNull();
});
it("rejects malformed, oversized, duplicate, future and invalid-height records", () => {
  const valid = {
    startedAt: Date.now(),
    gap: 20,
    cap: 1000,
    history: [[address, [{ txid: "a".repeat(64), height: "974000" }]]],
  };
  for (const value of [
    { ...valid, startedAt: Date.now() + 60000 },
    { ...valid, gap: 0 },
    { ...valid, cap: 999999 },
    { ...valid, history: [...valid.history, ...valid.history] },
    {
      ...valid,
      history: [[address, [{ txid: "a".repeat(64), height: "-2" }]]],
    },
    { ...valid, history: [[address, [{ txid: "bad", height: "1" }]]] },
    { ...valid, history: [["bad", []]] },
  ]) {
    localStorage.setItem(
      publicStorageKey("account-a", "partial"),
      JSON.stringify(value),
    );
    expect(loadScanCheckpoint("account-a")).toBeNull();
  }
  localStorage.setItem(
    publicStorageKey("account-a", "partial"),
    "x".repeat(2000001),
  );
  expect(loadScanCheckpoint("account-a")).toBeNull();
});
it("reports refused storage instead of claiming progress was saved", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  expect(() =>
    saveScanCheckpoint("account-a", {
      startedAt: Date.now(),
      gap: 20,
      cap: 1000,
      history: [],
    }),
  ).toThrow("could not be saved");
});

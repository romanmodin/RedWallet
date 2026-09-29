import type { BridgeActor } from "@/services/bridgeService";
import { BridgeWalletService, mapBridgeError } from "@/services/bridgeService";
import { settingsService } from "@/services/settingsService";
import { describe, expect, it, vi } from "vitest";

const ADDRESS = "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4";
function makeActor(overrides: Partial<BridgeActor> = {}): BridgeActor {
  return {
    getBridgeStatus: vi.fn(async () => ({
      configured: true,
      checkpointConfigured: true,
    })),
    getAddressBalance: vi.fn(async () => ({
      __kind__: "ok" as const,
      ok: { confirmed: 100000000n, unconfirmed: -25000000n },
    })),
    getAddressHistory: vi.fn(async () => ({
      __kind__: "ok" as const,
      ok: {
        entries: [{ txid: "a".repeat(64), height: 974000n, value: undefined }],
      },
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
function seedWatch() {
  localStorage.setItem(
    "redwallet.watch-wallets.v1",
    JSON.stringify([{ id: "watch-test", name: "My XBT", address: ADDRESS }]),
  );
  localStorage.setItem("redwallet.active-wallet.v1", "watch-test");
}

describe("Live watched addresses", () => {
  it("validates an address with the bridge before storing only public metadata", async () => {
    const actor = makeActor();
    const service = new BridgeWalletService(async () => actor);
    const result = await service.addWatchWallet("My XBT", ADDRESS);
    expect(result.ok).toBe(true);
    expect(actor.getAddressBalance).toHaveBeenCalledWith(ADDRESS);
    const stored = JSON.parse(
      localStorage.getItem("redwallet.watch-wallets.v1")!,
    );
    expect(Object.keys(stored[0]).sort()).toEqual(["address", "id", "name"]);
  });
  it("never saves an address rejected by checksum/network validation", async () => {
    const actor = makeActor({
      getAddressBalance: vi.fn(async () => ({
        __kind__: "err" as const,
        err: {
          __kind__: "invalid_input" as const,
          invalid_input: "Invalid address",
        },
      })),
    });
    const service = new BridgeWalletService(async () => actor);
    expect((await service.addWatchWallet("bad", ADDRESS)).ok).toBe(false);
    expect(localStorage.getItem("redwallet.watch-wallets.v1")).toBeNull();
  });
  it("subtracts negative unconfirmed balance instead of rejecting it", async () => {
    seedWatch();
    const service = new BridgeWalletService(async () => makeActor());
    expect(await service.getBalance("watch-test")).toEqual({
      ok: true,
      value: 0.75,
    });
  });
  it("does not replace unavailable live balances/history with demo data", async () => {
    seedWatch();
    const service = new BridgeWalletService(async () => null);
    expect(await service.getBalance("watch-test")).toMatchObject({
      ok: false,
      error: { code: "backend_unavailable" },
    });
    expect(await service.listTransactions("watch-test")).toMatchObject({
      ok: false,
      error: { code: "backend_unavailable" },
    });
    const active = await service.getActiveWallet();
    expect(active.ok).toBe(true);
    if (active.ok) {
      expect(active.value.isDemo).toBe(false);
      expect(active.value.balanceXbt).toBeNaN();
      expect(active.value.balanceError).toBeTruthy();
    }
  });
  it("shows a not-configured error for a real address without a bridge", async () => {
    seedWatch();
    const service = new BridgeWalletService(async () =>
      makeActor({
        getBridgeStatus: vi.fn(async () => ({
          configured: false,
          checkpointConfigured: false,
        })),
      }),
    );
    expect(await service.getBalance("watch-test")).toMatchObject({
      ok: false,
      error: { code: "not_configured" },
    });
  });
  it("leaves history amount, direction, fee and time unknown", async () => {
    seedWatch();
    const service = new BridgeWalletService(async () => makeActor());
    const history = await service.listTransactions("watch-test");
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.value[0]).toMatchObject({
      isLive: true,
      txid: "a".repeat(64),
      blockHeight: 974000,
      direction: "unknown",
      status: "confirmed",
    });
    for (const key of [
      "amountXbt",
      "feeXbt",
      "fiatUsd",
      "timestamp",
      "confirmations",
    ] as const)
      expect(history.value[0][key]).toBeNaN();
    const reloaded = new BridgeWalletService(async () => makeActor());
    expect(await reloaded.getTransaction(history.value[0].id)).toMatchObject({
      ok: true,
      value: { txid: "a".repeat(64) },
    });
  });
  it("keeps explicitly demo accounts simulated even when bridge is connected", async () => {
    const service = new BridgeWalletService(async () => makeActor());
    expect(await service.getBalance("wlt-primary")).toEqual({
      ok: true,
      value: 1.2485,
    });
  });
  it("does not use a Bitcoin demo price for live XBT", async () => {
    const service = new BridgeWalletService(async () => makeActor());
    expect((await service.getFiatRate()).ok).toBe(false);
    settingsService.updateSettings({ manualUsdPerXbt: 375 });
    expect(await service.getFiatRate()).toMatchObject({
      ok: true,
      value: { source: "manual", usdPerXbt: 375 },
    });
  });
  it("rejects send attempts for a watch-only wallet", async () => {
    const service = new BridgeWalletService(async () => makeActor());
    expect(
      await service.sendDemoTransaction({
        walletId: "watch-test",
        recipientAddress: ADDRESS,
        amountXbt: 0.1,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
  it("gets real height while leaving unavailable peer count unknown", async () => {
    const service = new BridgeWalletService(async () => makeActor());
    const result = await service.getNetworkStatus();
    expect(result).toMatchObject({
      ok: true,
      value: {
        state: "connected",
        blockHeight: 974001,
        checkpointConfigured: true,
      },
    });
    if (result.ok) expect(result.value.peers).toBeNaN();
  });
  it("maps safe bridge failures", () => {
    expect(
      mapBridgeError({
        __kind__: "malformed_response",
        malformed_response: "bad",
      }).code,
    ).toBe("unknown");
  });
});

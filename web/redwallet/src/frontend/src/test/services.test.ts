/**
 * Typed service-layer contract tests.
 *
 * These exercise the mock wallet service and the localStorage settings
 * service directly — the seam every screen consumes. They assert observable
 * behavior (result shapes, filtering, validation, persistence) rather than
 * implementation details, and they never touch the network.
 */

import { formatAmount, formatFiat, formatRelativeDate } from "@/lib/format";
import {
  DEFAULT_SETTINGS,
  LocalSettingsService,
} from "@/services/settingsService";
import type { Transaction } from "@/services/types";
import { MockWalletService } from "@/services/walletService";
import { describe, expect, it } from "vitest";

describe("MockWalletService", () => {
  it("lists demo wallets and reports the first as active", async () => {
    const service = new MockWalletService();
    const list = await service.listWallets();
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    expect(list.value.length).toBeGreaterThanOrEqual(3);
    expect(list.value.every((wallet) => wallet.isDemo)).toBe(true);

    const active = await service.getActiveWallet();
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect(active.value.id).toBe(list.value[0].id);
  });

  it("switches the active wallet and reflects the new balance", async () => {
    const service = new MockWalletService();
    const list = await service.listWallets();
    if (!list.ok) throw new Error("expected wallets");

    const target = list.value[1];
    const switched = await service.setActiveWallet(target.id);
    expect(switched.ok).toBe(true);

    const active = await service.getActiveWallet();
    if (!active.ok) throw new Error("expected active wallet");
    expect(active.value.id).toBe(target.id);
    expect(active.value.balanceXbt).toBe(target.balanceXbt);
  });

  it("rejects an unknown wallet id without throwing", async () => {
    const service = new MockWalletService();
    const result = await service.setActiveWallet("does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });

  it("filters transactions by status, direction, and query", async () => {
    const service = new MockWalletService();
    const all = await service.listTransactions("wlt-primary");
    if (!all.ok) throw new Error("expected transactions");
    expect(all.value.length).toBeGreaterThan(0);

    const pending = await service.listTransactions("wlt-primary", {
      status: "pending",
    });
    if (!pending.ok) throw new Error("expected pending");
    expect(pending.value.length).toBeGreaterThan(0);
    expect(pending.value.every((tx) => tx.status === "pending")).toBe(true);

    const received = await service.listTransactions("wlt-primary", {
      direction: "receive",
    });
    if (!received.ok) throw new Error("expected received");
    expect(received.value.every((tx) => tx.direction === "receive")).toBe(true);

    const searched = await service.listTransactions("wlt-primary", {
      query: "invoice",
    });
    if (!searched.ok) throw new Error("expected search");
    expect(searched.value.length).toBeGreaterThan(0);
    expect(
      searched.value.every((tx) =>
        `${tx.counterpartyAddress} ${tx.note}`
          .toLowerCase()
          .includes("invoice"),
      ),
    ).toBe(true);
  });

  it("returns transactions newest-first", async () => {
    const service = new MockWalletService();
    const result = await service.listTransactions("wlt-primary");
    if (!result.ok) throw new Error("expected transactions");
    const timestamps = result.value.map((tx) => tx.timestamp);
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });

  it("uses only the invalid XBT demo address in transaction example data", async () => {
    const service = new MockWalletService();
    const result = await service.listTransactions("wlt-primary");
    if (!result.ok) throw new Error("expected transactions");
    expect(result.value.length).toBeGreaterThan(0);
    // No bc1-prefixed example address survives the accepted change.
    expect(
      result.value.every(
        (tx) => tx.counterpartyAddress === "xbt-demo-address-not-valid",
      ),
    ).toBe(true);
    expect(
      result.value.some((tx) => tx.counterpartyAddress.startsWith("bc1")),
    ).toBe(false);
  });

  it("returns a not_found error for an unknown transaction id", async () => {
    const service = new MockWalletService();
    const result = await service.getTransaction("tx-nope");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });

  it("estimates a positive fee for a valid amount and rejects zero", async () => {
    const service = new MockWalletService();
    const estimate = await service.estimateFee(0.5);
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;
    expect(estimate.value.feeXbt).toBeGreaterThan(0);
    expect(estimate.value.satPerVbyte).toBeGreaterThan(0);

    const invalid = await service.estimateFee(0);
    expect(invalid.ok).toBe(false);
  });

  it("never broadcasts: sendDemoTransaction is demo-only", async () => {
    const service = new MockWalletService();
    const result = await service.sendDemoTransaction({
      walletId: "wlt-primary",
      recipientAddress: "xbt-demo-address-not-valid",
      amountXbt: 0.01,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.broadcast).toBe(false);
    expect(result.value.demo).toBe(true);
    expect(result.value.transaction.status).toBe("pending");
  });

  it("rejects a send that exceeds the demo balance", async () => {
    const service = new MockWalletService();
    const result = await service.sendDemoTransaction({
      walletId: "wlt-primary",
      recipientAddress: "xbt-demo-address-not-valid",
      amountXbt: 999,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("reports a connection test result for a valid and an invalid config", async () => {
    const service = new MockWalletService();

    const okResult = await service.testServerConnection({
      network: "unconfigured",
      host: "electrum.example.org",
      port: 50002,
      tls: true,
    });
    expect(okResult.ok).toBe(true);
    if (!okResult.ok) return;
    expect(okResult.value.ok).toBe(true);
    expect(okResult.value.state).toBe("connected");

    const badPort = await service.testServerConnection({
      network: "unconfigured",
      host: "electrum.example.org",
      port: 0,
      tls: true,
    });
    expect(badPort.ok).toBe(true);
    if (!badPort.ok) return;
    expect(badPort.value.ok).toBe(false);
    expect(badPort.value.state).toBe("error");
  });

  it("reports offline network status with no configured host", async () => {
    const service = new MockWalletService();
    const result = await service.getNetworkStatus();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("offline");
    expect(result.value.host).toBe("");
  });
});

describe("LocalSettingsService", () => {
  it("returns safe defaults with no silent server host", () => {
    const service = new LocalSettingsService();
    const result = service.getSettings();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(DEFAULT_SETTINGS);
    expect(result.value.serverHost).toBe("");
  });

  it("persists an update and reads it back", () => {
    const service = new LocalSettingsService();
    const saved = service.updateSettings({
      displayUnit: "BTC",
      network: "unconfigured",
      serverHost: "electrum.example.org",
      serverPort: 50001,
      serverTls: false,
    });
    expect(saved.ok).toBe(true);

    const reread = service.getSettings();
    if (!reread.ok) throw new Error("expected settings");
    expect(reread.value.displayUnit).toBe("BTC");
    expect(reread.value.network).toBe("unconfigured");
    expect(reread.value.serverHost).toBe("electrum.example.org");
    expect(reread.value.serverPort).toBe(50001);
    expect(reread.value.serverTls).toBe(false);
  });

  it("normalizes corrupt stored values back to defaults", () => {
    window.localStorage.setItem(
      "redwallet.settings.v1",
      JSON.stringify({ displayUnit: "DOGE", serverPort: -5, theme: "neon" }),
    );
    const service = new LocalSettingsService();
    const result = service.getSettings();
    if (!result.ok) throw new Error("expected settings");
    expect(result.value.displayUnit).toBe(DEFAULT_SETTINGS.displayUnit);
    expect(result.value.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.value.serverPort).toBe(DEFAULT_SETTINGS.serverPort);
  });

  it("resets back to defaults", () => {
    const service = new LocalSettingsService();
    service.updateSettings({ displayUnit: "BTC" });
    const reset = service.resetSettings();
    if (!reset.ok) throw new Error("expected reset");
    expect(reset.value).toEqual(DEFAULT_SETTINGS);
    const reread = service.getSettings();
    if (!reread.ok) throw new Error("expected settings");
    expect(reread.value.displayUnit).toBe("XBT");
  });
});

describe("format helpers", () => {
  it("formats an amount with its display unit", () => {
    expect(formatAmount(0.5, "XBT")).toBe("0.50000000 XBT");
    expect(formatAmount(0.5, "BTC")).toBe("0.50000000 BTC");
  });

  it("formats fiat as USD currency", () => {
    expect(formatFiat(48120.55)).toBe("$48,120.55");
  });

  it("formats relative dates across buckets", () => {
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);
    expect(formatRelativeDate(now - 10_000, now)).toBe("just now");
    expect(formatRelativeDate(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeDate(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeDate(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

/**
 * Compile-time guard: the service result carries the expected transaction
 * shape. Kept local (not exported) so the test file stays lint-clean; the
 * typed parameter fails the type-check if `Transaction` drifts.
 */
const _transactionShapeGuard = (tx: Transaction): Transaction => tx;
void _transactionShapeGuard;

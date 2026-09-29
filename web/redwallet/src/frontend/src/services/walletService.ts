/**
 * Mock wallet service.
 *
 * `WalletService` is the typed contract every screen consumes. The
 * `MockWalletService` implementation below is backed entirely by in-memory
 * demo data and is designed to be replaced by a real Fulcrum/Electrum
 * adapter or an ICP canister adapter without changing any UI component.
 *
 * This layer contains NO signing, key handling, transaction construction,
 * or broadcast logic. `sendDemoTransaction` returns a local demo record and
 * never touches a network.
 */

import {
  type ConnectionState,
  type DemoSendResult,
  type FeeEstimate,
  type FiatRate,
  type NetworkConfig,
  type NetworkStatus,
  type ServerTestResult,
  type ServiceResult,
  type Transaction,
  type TransactionFilters,
  type Wallet,
  err,
  ok,
} from "./types";

/** Fixed fallback fiat rate used when the live rate is unavailable. */
export const FALLBACK_USD_PER_XBT = 64_250;

/** The typed contract every screen depends on. */
export interface WalletService {
  listWallets(): Promise<ServiceResult<Wallet[]>>;
  getActiveWallet(): Promise<ServiceResult<Wallet>>;
  setActiveWallet(walletId: string): Promise<ServiceResult<Wallet>>;
  addDemoWallet(name: string): Promise<ServiceResult<Wallet>>;
  addWatchWallet?(
    name: string,
    address: string,
  ): Promise<ServiceResult<Wallet>>;
  getBalance(walletId: string): Promise<ServiceResult<number>>;
  listTransactions(
    walletId: string,
    filters?: TransactionFilters,
  ): Promise<ServiceResult<Transaction[]>>;
  getTransaction(id: string): Promise<ServiceResult<Transaction>>;
  estimateFee(amountXbt: number): Promise<ServiceResult<FeeEstimate>>;
  sendDemoTransaction(input: {
    walletId: string;
    recipientAddress: string;
    amountXbt: number;
    note?: string;
  }): Promise<ServiceResult<DemoSendResult>>;
  getNetworkStatus(): Promise<ServiceResult<NetworkStatus>>;
  testServerConnection(
    config: NetworkConfig,
  ): Promise<ServiceResult<ServerTestResult>>;
  getFiatRate(): Promise<ServiceResult<FiatRate>>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Deterministic demo clock so relative dates stay stable within a session. */
const DEMO_NOW = Date.now();

interface DemoWalletSeed {
  id: string;
  name: string;
  shortId: string;
  balanceXbt: number;
}

const DEMO_WALLET_SEEDS: DemoWalletSeed[] = [
  {
    id: "wlt-primary",
    name: "Primary Vault",
    shortId: "Demo address — not real",
    balanceXbt: 1.2485,
  },
  {
    id: "wlt-savings",
    name: "Cold Savings",
    shortId: "Demo address — not real",
    balanceXbt: 4.6021,
  },
  {
    id: "wlt-spending",
    name: "Daily Spending",
    shortId: "Demo address — not real",
    balanceXbt: 0.0873,
  },
];

interface DemoTransactionSeed {
  walletId: string;
  direction: Transaction["direction"];
  status: Transaction["status"];
  amountXbt: number;
  ageMs: number;
  counterpartyAddress: string;
  note: string;
  feeXbt: number;
  confirmations: number;
}

const DEMO_TRANSACTION_SEEDS: DemoTransactionSeed[] = [
  {
    walletId: "wlt-primary",
    direction: "receive",
    status: "confirmed",
    amountXbt: 0.42,
    ageMs: 2 * HOUR,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Invoice #2041 settlement",
    feeXbt: 0.000021,
    confirmations: 18,
  },
  {
    walletId: "wlt-primary",
    direction: "send",
    status: "pending",
    amountXbt: 0.075,
    ageMs: 5 * HOUR,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Hardware wallet top-up",
    feeXbt: 0.000034,
    confirmations: 0,
  },
  {
    walletId: "wlt-primary",
    direction: "receive",
    status: "confirmed",
    amountXbt: 0.15,
    ageMs: 1 * DAY + 3 * HOUR,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Consulting retainer",
    feeXbt: 0.000019,
    confirmations: 142,
  },
  {
    walletId: "wlt-primary",
    direction: "send",
    status: "failed",
    amountXbt: 0.03,
    ageMs: 2 * DAY,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Replaced by higher fee",
    feeXbt: 0.000012,
    confirmations: 0,
  },
  {
    walletId: "wlt-primary",
    direction: "receive",
    status: "confirmed",
    amountXbt: 0.88,
    ageMs: 4 * DAY,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Quarterly payout",
    feeXbt: 0.000027,
    confirmations: 610,
  },
  {
    walletId: "wlt-savings",
    direction: "receive",
    status: "confirmed",
    amountXbt: 2.5,
    ageMs: 6 * DAY,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Cold storage transfer",
    feeXbt: 0.000045,
    confirmations: 902,
  },
  {
    walletId: "wlt-savings",
    direction: "receive",
    status: "confirmed",
    amountXbt: 1.2,
    ageMs: 12 * DAY,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Monthly savings",
    feeXbt: 0.000038,
    confirmations: 1_840,
  },
  {
    walletId: "wlt-savings",
    direction: "send",
    status: "confirmed",
    amountXbt: 0.35,
    ageMs: 18 * DAY,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Equipment purchase",
    feeXbt: 0.000029,
    confirmations: 2_610,
  },
  {
    walletId: "wlt-savings",
    direction: "receive",
    status: "confirmed",
    amountXbt: 0.75,
    ageMs: 26 * DAY,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Bonus allocation",
    feeXbt: 0.000031,
    confirmations: 3_740,
  },
  {
    walletId: "wlt-spending",
    direction: "send",
    status: "confirmed",
    amountXbt: 0.012,
    ageMs: 8 * HOUR,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Coffee subscription",
    feeXbt: 0.000008,
    confirmations: 6,
  },
  {
    walletId: "wlt-spending",
    direction: "receive",
    status: "confirmed",
    amountXbt: 0.05,
    ageMs: 2 * DAY + 6 * HOUR,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Refund from merchant",
    feeXbt: 0.000011,
    confirmations: 288,
  },
  {
    walletId: "wlt-spending",
    direction: "send",
    status: "pending",
    amountXbt: 0.004,
    ageMs: 40 * 60_000,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Tip jar",
    feeXbt: 0.000006,
    confirmations: 0,
  },
  {
    walletId: "wlt-spending",
    direction: "send",
    status: "confirmed",
    amountXbt: 0.021,
    ageMs: 9 * DAY,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Domain renewal",
    feeXbt: 0.000014,
    confirmations: 1_290,
  },
  {
    walletId: "wlt-spending",
    direction: "receive",
    status: "confirmed",
    amountXbt: 0.1,
    ageMs: 21 * DAY,
    counterpartyAddress: "xbt-demo-address-not-valid",
    note: "Peer transfer",
    feeXbt: 0.000017,
    confirmations: 3_020,
  },
];

function buildWallets(): Wallet[] {
  return DEMO_WALLET_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    shortId: seed.shortId,
    balanceXbt: seed.balanceXbt,
    fiatValueUsd: seed.balanceXbt * FALLBACK_USD_PER_XBT,
    isDemo: true,
  }));
}

function buildTransactions(): Transaction[] {
  return DEMO_TRANSACTION_SEEDS.map((seed, index) => {
    const timestamp = DEMO_NOW - seed.ageMs;
    return {
      id: `tx-${String(index + 1).padStart(3, "0")}`,
      walletId: seed.walletId,
      direction: seed.direction,
      status: seed.status,
      amountXbt: seed.amountXbt,
      fiatUsd: seed.amountXbt * FALLBACK_USD_PER_XBT,
      timestamp,
      counterpartyAddress: seed.counterpartyAddress,
      note: seed.note,
      feeXbt: seed.feeXbt,
      confirmations: seed.confirmations,
      txid: `0x${(index + 1).toString(16).padStart(4, "0")}${"a1b2c3d4e5f6".repeat(4).slice(0, 60)}`,
    };
  }).sort((a, b) => b.timestamp - a.timestamp);
}

/** In-memory demo implementation of `WalletService`. */
export class MockWalletService implements WalletService {
  private wallets: Wallet[] = buildWallets();
  private transactions: Transaction[] = buildTransactions();
  private activeWalletId = DEMO_WALLET_SEEDS[0].id;
  private demoWalletCounter = 0;

  async listWallets(): Promise<ServiceResult<Wallet[]>> {
    return ok(this.wallets.map((wallet) => ({ ...wallet })));
  }

  async getActiveWallet(): Promise<ServiceResult<Wallet>> {
    const wallet = this.wallets.find((w) => w.id === this.activeWalletId);
    if (!wallet) {
      return err("not_found", "No active demo wallet is selected.");
    }
    return ok({ ...wallet });
  }

  async setActiveWallet(walletId: string): Promise<ServiceResult<Wallet>> {
    const wallet = this.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      return err("not_found", `Demo wallet "${walletId}" was not found.`);
    }
    this.activeWalletId = walletId;
    return ok({ ...wallet });
  }

  async addDemoWallet(name: string): Promise<ServiceResult<Wallet>> {
    const trimmed = name.trim();
    if (!trimmed) {
      return err("invalid_input", "Enter a name for the demo wallet.");
    }
    this.demoWalletCounter += 1;
    const suffix = this.demoWalletCounter.toString(16).padStart(4, "0");
    const wallet: Wallet = {
      id: `wlt-demo-${suffix}`,
      name: trimmed,
      shortId: "Demo address — not real",
      balanceXbt: 0,
      fiatValueUsd: 0,
      isDemo: true,
    };
    this.wallets = [...this.wallets, wallet];
    return ok({ ...wallet });
  }

  async getBalance(walletId: string): Promise<ServiceResult<number>> {
    const wallet = this.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      return err("not_found", `Demo wallet "${walletId}" was not found.`);
    }
    return ok(wallet.balanceXbt);
  }

  async listTransactions(
    walletId: string,
    filters: TransactionFilters = {},
  ): Promise<ServiceResult<Transaction[]>> {
    const wallet = this.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      return err("not_found", `Demo wallet "${walletId}" was not found.`);
    }

    const query = filters.query?.trim().toLowerCase() ?? "";
    const filtered = this.transactions.filter((tx) => {
      if (tx.walletId !== walletId) return false;
      if (
        filters.status &&
        filters.status !== "all" &&
        tx.status !== filters.status
      ) {
        return false;
      }
      if (
        filters.direction &&
        filters.direction !== "all" &&
        tx.direction !== filters.direction
      ) {
        return false;
      }
      if (query) {
        const haystack = `${tx.counterpartyAddress} ${tx.note}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    return ok(filtered.map((tx) => ({ ...tx })));
  }

  async getTransaction(id: string): Promise<ServiceResult<Transaction>> {
    const tx = this.transactions.find((t) => t.id === id);
    if (!tx) {
      return err("not_found", `Transaction "${id}" was not found.`);
    }
    return ok({ ...tx });
  }

  async estimateFee(amountXbt: number): Promise<ServiceResult<FeeEstimate>> {
    if (!Number.isFinite(amountXbt) || amountXbt <= 0) {
      return err("invalid_input", "Enter an amount greater than zero.");
    }
    const satPerVbyte = 12;
    const estimatedVbytes = 140 + Math.round(amountXbt * 4);
    const feeXbt = (satPerVbyte * estimatedVbytes) / 100_000_000;
    return ok({
      feeXbt,
      feeUsd: feeXbt * FALLBACK_USD_PER_XBT,
      satPerVbyte,
      estimatedBlocks: 2,
    });
  }

  async sendDemoTransaction(input: {
    walletId: string;
    recipientAddress: string;
    amountXbt: number;
    note?: string;
  }): Promise<ServiceResult<DemoSendResult>> {
    const wallet = this.wallets.find((w) => w.id === input.walletId);
    if (!wallet) {
      return err("not_found", `Demo wallet "${input.walletId}" was not found.`);
    }
    if (!input.recipientAddress.trim()) {
      return err("invalid_input", "Enter a recipient address.");
    }
    if (!Number.isFinite(input.amountXbt) || input.amountXbt <= 0) {
      return err("invalid_input", "Enter an amount greater than zero.");
    }
    if (input.amountXbt > wallet.balanceXbt) {
      return err("invalid_input", "Amount exceeds the demo wallet balance.");
    }

    const fee = await this.estimateFee(input.amountXbt);
    const feeXbt = fee.ok ? fee.value.feeXbt : 0.00002;
    const transaction: Transaction = {
      id: `tx-demo-${Date.now().toString(36)}`,
      walletId: wallet.id,
      direction: "send",
      status: "pending",
      amountXbt: input.amountXbt,
      fiatUsd: input.amountXbt * FALLBACK_USD_PER_XBT,
      timestamp: Date.now(),
      counterpartyAddress: input.recipientAddress.trim(),
      note: input.note?.trim() ?? "",
      feeXbt,
      confirmations: 0,
      txid: `demo-${Date.now().toString(16)}`,
    };

    return ok({
      broadcast: false,
      demo: true,
      transaction,
      message:
        "Demo only — no transaction was created, signed, or broadcast to any network.",
    });
  }

  async getNetworkStatus(): Promise<ServiceResult<NetworkStatus>> {
    return ok({
      network: "unconfigured",
      host: "",
      port: 50002,
      tls: true,
      state: "offline",
      blockHeight: 2_864_120,
      lastSyncedAt: DEMO_NOW - 4 * 60_000,
      peers: 0,
      checkpointConfigured: false,
    });
  }

  async testServerConnection(
    config: NetworkConfig,
  ): Promise<ServiceResult<ServerTestResult>> {
    if (!config.host.trim()) {
      return ok({
        ok: false,
        state: "offline",
        message: "Enter a server host to test the connection.",
        latencyMs: null,
      });
    }
    if (
      !Number.isInteger(config.port) ||
      config.port <= 0 ||
      config.port > 65535
    ) {
      return ok({
        ok: false,
        state: "error",
        message: "Enter a valid port between 1 and 65535.",
        latencyMs: null,
      });
    }
    return ok({
      ok: true,
      state: "connected",
      message: `Demo connection to ${config.host}:${config.port} succeeded.`,
      latencyMs: 42,
    });
  }

  async getFiatRate(): Promise<ServiceResult<FiatRate>> {
    return ok({
      usdPerXbt: FALLBACK_USD_PER_XBT,
      source: "fallback",
      fetchedAt: DEMO_NOW,
    });
  }
}

/** Shared singleton used by the app until a real adapter replaces it. */
export const walletService: WalletService = new MockWalletService();

/** Re-exported for callers that need the connection-state union. */
export type { ConnectionState };

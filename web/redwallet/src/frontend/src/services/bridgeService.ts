/** Read-only Fulcrum adapter. Public watch addresses are stored locally;
 * live reads never use simulated fallback balances or history. Demo wallets
 * remain explicitly simulated. No key material or signing is handled here.
 */

import { createActor } from "@/backend";
import type { BridgeError, backendInterface } from "@/backend";
type BridgeResult = Awaited<ReturnType<backendInterface["getServerStatus"]>>;
type FeeBridgeResult = Awaited<ReturnType<backendInterface["getFeeEstimate"]>>;
import { createActorWithConfig } from "@caffeineai/core-infrastructure";
import { settingsService } from "./settingsService";
import {
  type AddressUtxos,
  type DemoSendResult,
  type FeeEstimate,
  type FiatRate,
  type NetworkConfig,
  type NetworkStatus,
  type RawTransaction,
  type ServerTestResult,
  type ServiceError,
  type ServiceResult,
  type Transaction,
  type TransactionFilters,
  type Wallet,
  err,
  ok,
} from "./types";
import { MockWalletService, type WalletService } from "./walletService";

/** The subset of the generated backend actor the bridge reads use. */
export type BridgeActor = Pick<
  backendInterface,
  | "getBridgeStatus"
  | "getAddressBalance"
  | "getAddressHistory"
  | "getAddressUtxos"
  | "getFeeEstimate"
  | "getRawTransaction"
  | "getServerStatus"
>;

/** Map a bridge error variant onto the service-layer error shape. */
export function mapBridgeError(error: BridgeError): ServiceError {
  switch (error.__kind__) {
    case "not_configured":
      return {
        code: "not_configured",
        message: "The bridge is not configured yet.",
      };
    case "backend_unavailable":
      return {
        code: "backend_unavailable",
        message:
          error.backend_unavailable ||
          "The bridge is unreachable. Try again in a moment.",
      };
    case "invalid_input":
      return {
        code: "invalid_input",
        message: error.invalid_input || "The request was rejected.",
      };
    case "malformed_response":
      return {
        code: "unknown",
        message: "The bridge returned an unexpected response.",
      };
    default:
      return {
        code: "unknown",
        message: "The bridge returned an unexpected response.",
      };
  }
}

/**
 * Resolve the canister actor once and cache the result. A missing canister
 * configuration is a permanent condition for this session, so the failure is
 * cached too; live address reads then report backend unavailable.
 */
let actorPromise: Promise<BridgeActor | null> | null = null;

export function resolveBridgeActor(): Promise<BridgeActor | null> {
  if (!actorPromise) {
    actorPromise = createActorWithConfig(createActor)
      .then((actor) => actor as BridgeActor)
      .catch(() => null);
  }
  return actorPromise;
}

/** Live address reads and explicitly selected demo accounts share the same
 * screen contract. A failed live read always remains an error.
 */
export class BridgeWalletService implements WalletService {
  private readonly demo = new MockWalletService();
  private readonly resolveActor: () => Promise<BridgeActor | null>;

  constructor(
    resolveActor: () => Promise<BridgeActor | null> = resolveBridgeActor,
  ) {
    this.resolveActor = resolveActor;
  }

  /** The actor when the bridge is configured, otherwise null. */
  private async configuredActor(): Promise<BridgeActor | null> {
    const actor = await this.resolveActor();
    if (!actor) return null;
    try {
      const status = await actor.getBridgeStatus();
      return status.configured ? actor : null;
    } catch {
      return null;
    }
  }

  private readonly storageKey = "redwallet.watch-wallets.v1";
  private activeId: string | null = null;
  private networkRequest: Promise<ServiceResult<NetworkStatus>> | null = null;

  private watchWallets(): Wallet[] {
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(
          (w) =>
            typeof w.id === "string" &&
            w.id.startsWith("watch-") &&
            typeof w.name === "string" &&
            typeof w.address === "string" &&
            w.address.length >= 26 &&
            w.address.length <= 90 &&
            /^[a-zA-Z0-9]+$/.test(w.address),
        )
        .map((w) => ({
          id: w.id,
          name: w.name,
          address: w.address,
          shortId: `${w.address.slice(0, 10)}…${w.address.slice(-6)}`,
          isDemo: false,
          balanceXbt: Number.NaN,
          fiatValueUsd: Number.NaN,
        }));
    } catch {
      return [];
    }
  }

  private async liveActor(): Promise<ServiceResult<BridgeActor>> {
    try {
      const actor = await this.resolveActor();
      if (!actor)
        return err("backend_unavailable", "The wallet backend is unavailable.");
      const status = await actor.getBridgeStatus();
      if (!status.configured)
        return err("not_configured", "The bridge is not configured yet.");
      return ok(actor);
    } catch {
      return err(
        "backend_unavailable",
        "The wallet backend is unreachable. Retry when connected.",
      );
    }
  }

  async listWallets(): Promise<ServiceResult<Wallet[]>> {
    const demos = await this.demo.listWallets();
    return ok([...this.watchWallets(), ...(demos.ok ? demos.value : [])]);
  }

  async getActiveWallet(): Promise<ServiceResult<Wallet>> {
    const id =
      this.activeId ?? localStorage.getItem("redwallet.active-wallet.v1");
    const watch = this.watchWallets().find((w) => w.id === id);
    if (!watch) return this.demo.getActiveWallet();
    const balance = await this.getBalance(watch.id);
    const rate = await this.getFiatRate();
    return ok({
      ...watch,
      balanceXbt: balance.ok ? balance.value : Number.NaN,
      fiatValueUsd:
        balance.ok && rate.ok
          ? balance.value * rate.value.usdPerXbt
          : Number.NaN,
      balanceError: balance.ok ? undefined : balance.error.message,
    });
  }

  async setActiveWallet(walletId: string): Promise<ServiceResult<Wallet>> {
    if (this.watchWallets().some((w) => w.id === walletId)) {
      this.activeId = walletId;
      localStorage.setItem("redwallet.active-wallet.v1", walletId);
      return this.getActiveWallet();
    }
    const result = await this.demo.setActiveWallet(walletId);
    if (result.ok) {
      this.activeId = walletId;
      localStorage.setItem("redwallet.active-wallet.v1", walletId);
    }
    return result;
  }

  async addDemoWallet(name: string): Promise<ServiceResult<Wallet>> {
    return this.demo.addDemoWallet(name);
  }

  async addWatchWallet(
    rawName: string,
    rawAddress: string,
  ): Promise<ServiceResult<Wallet>> {
    const name = rawName.trim();
    const address = rawAddress.trim();
    if (
      !name ||
      name.length > 100 ||
      address.length < 26 ||
      address.length > 90 ||
      !/^[a-zA-Z0-9]+$/.test(address)
    ) {
      return err(
        "invalid_input",
        "Enter a wallet name and a valid public XBT address.",
      );
    }
    const live = await this.liveActor();
    if (!live.ok) return live;
    // The bridge checks the full checksum and network before any address is saved.
    try {
      const checked = await live.value.getAddressBalance(address);
      if (checked.__kind__ === "err") {
        const e = mapBridgeError(checked.err);
        return err(e.code, e.message);
      }
      const wallets = this.watchWallets();
      const existing = wallets.find((w) => w.address === address);
      if (existing)
        return err(
          "invalid_input",
          "This address is already in your wallet list.",
        );
      const wallet: Wallet = {
        id: `watch-${crypto.randomUUID()}`,
        name,
        address,
        shortId: `${address.slice(0, 10)}…${address.slice(-6)}`,
        balanceXbt: Number.NaN,
        fiatValueUsd: Number.NaN,
        isDemo: false,
      };
      localStorage.setItem(
        this.storageKey,
        JSON.stringify(
          [...wallets, wallet].map(({ id, name, address }) => ({
            id,
            name,
            address,
          })),
        ),
      );
      return ok(wallet);
    } catch {
      return err(
        "backend_unavailable",
        "Could not validate and save this address. Check your connection and retry.",
      );
    }
  }

  async getBalance(walletId: string): Promise<ServiceResult<number>> {
    const wallet = this.watchWallets().find((w) => w.id === walletId);
    if (!wallet) return this.demo.getBalance(walletId);
    const live = await this.liveActor();
    if (!live.ok) return live;
    try {
      const result = await live.value.getAddressBalance(wallet.address!);
      if (result.__kind__ === "err") {
        const e = mapBridgeError(result.err);
        return err(e.code, e.message);
      }
      const total = result.ok.confirmed + result.ok.unconfirmed;
      if (
        result.ok.confirmed < 0n ||
        total < 0n ||
        total > BigInt(Number.MAX_SAFE_INTEGER)
      )
        return err("unknown", "The backend returned an invalid balance.");
      return ok(Number(total) / 100_000_000);
    } catch {
      return err(
        "backend_unavailable",
        "Balance unavailable. Retry when the backend is connected.",
      );
    }
  }

  /**
   * Read the unspent outputs for a watched address. Read-only: the result is
   * never used to construct, sign, or broadcast a spend. Not wired into any
   * page or hook — it is a service-layer capability only.
   */
  async getAddressUtxos(address: string): Promise<ServiceResult<AddressUtxos>> {
    const trimmed = address.trim();
    if (!trimmed) {
      return err("invalid_input", "Enter a public XBT address.");
    }
    const live = await this.liveActor();
    if (!live.ok) return live;
    try {
      const result = await live.value.getAddressUtxos(trimmed);
      if (result.__kind__ === "err") {
        const e = mapBridgeError(result.err);
        return err(e.code, e.message);
      }
      return ok({ utxos: result.ok.utxos });
    } catch {
      return err(
        "backend_unavailable",
        "Unspent outputs unavailable. Retry when the backend is connected.",
      );
    }
  }

  /**
   * Read the raw hex bytes of a transaction. Read-only: the app never parses
   * this into a spend or broadcasts it. Not wired into any page or hook — it
   * is a service-layer capability only.
   */
  async getRawTransaction(
    txid: string,
  ): Promise<ServiceResult<RawTransaction>> {
    const trimmed = txid.trim();
    if (!/^[0-9a-f]{64}$/.test(trimmed)) {
      return err(
        "invalid_input",
        "Enter a 64-character lowercase hex transaction id.",
      );
    }
    const live = await this.liveActor();
    if (!live.ok) return live;
    try {
      const result = await live.value.getRawTransaction(trimmed);
      if (result.__kind__ === "err") {
        const e = mapBridgeError(result.err);
        return err(e.code, e.message);
      }
      return ok({ hex: result.ok.hex });
    } catch {
      return err(
        "backend_unavailable",
        "Raw transaction unavailable. Retry when the backend is connected.",
      );
    }
  }

  async listTransactions(
    walletId: string,
    filters: TransactionFilters = {},
  ): Promise<ServiceResult<Transaction[]>> {
    const wallet = this.watchWallets().find((w) => w.id === walletId);
    if (!wallet) return this.demo.listTransactions(walletId, filters);
    const live = await this.liveActor();
    if (!live.ok) return live;
    try {
      const result = await live.value.getAddressHistory(wallet.address!);
      if (result.__kind__ === "err") {
        const e = mapBridgeError(result.err);
        return err(e.code, e.message);
      }
      const transactions: Transaction[] = result.ok.entries.map((entry) => ({
        id: `${walletId}:${entry.txid}`,
        walletId,
        txid: entry.txid,
        isLive: true,
        direction: "unknown",
        status: entry.height > 0n ? "confirmed" : "pending",
        amountXbt: Number.NaN,
        fiatUsd: Number.NaN,
        timestamp: Number.NaN,
        feeXbt: Number.NaN,
        confirmations: Number.NaN,
        counterpartyAddress: "",
        blockHeight: Number(entry.height),
        note:
          entry.height > 0n
            ? `Block ${entry.height}`
            : "Unconfirmed transaction",
      }));
      transactions.sort((a, b) => {
        if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
        return (
          (b.blockHeight ?? 0) - (a.blockHeight ?? 0) ||
          a.txid.localeCompare(b.txid)
        );
      });
      return ok(
        transactions.filter(
          (tx) =>
            (!filters.status ||
              filters.status === "all" ||
              tx.status === filters.status) &&
            (!filters.direction ||
              filters.direction === "all" ||
              tx.direction === filters.direction) &&
            (!filters.query ||
              `${tx.txid} ${tx.note}`
                .toLowerCase()
                .includes(filters.query.trim().toLowerCase())),
        ),
      );
    } catch {
      return err(
        "backend_unavailable",
        "Transaction history unavailable. Retry when the backend is connected.",
      );
    }
  }

  async getTransaction(id: string): Promise<ServiceResult<Transaction>> {
    if (!id.startsWith("watch-")) return this.demo.getTransaction(id);
    const walletId = id.split(":")[0];
    const history = await this.listTransactions(walletId);
    if (!history.ok) return history;
    const tx = history.value.find((t) => t.id === id);
    return tx
      ? ok(tx)
      : err("not_found", "Transaction not found for this watched address.");
  }

  async estimateFee(amountXbt: number): Promise<ServiceResult<FeeEstimate>> {
    if (!Number.isFinite(amountXbt) || amountXbt <= 0) {
      return err("invalid_input", "Enter an amount greater than zero.");
    }

    const actor = await this.configuredActor();
    if (!actor) return this.demo.estimateFee(amountXbt);

    let result: FeeBridgeResult;
    try {
      result = await actor.getFeeEstimate();
    } catch {
      return err(
        "backend_unavailable",
        "The bridge is unreachable. Try again in a moment.",
      );
    }
    if (result.__kind__ === "err") {
      const mapped = mapBridgeError(result.err);
      return err(mapped.code, mapped.message);
    }

    const satoshisPerKb = Number(result.ok.satoshisPerKb);
    if (!Number.isFinite(satoshisPerKb) || satoshisPerKb <= 0) {
      return err("unknown", "The bridge returned an unusable fee estimate.");
    }

    const satPerVbyte = satoshisPerKb / 1000;
    const estimatedVbytes = 140 + Math.round(amountXbt * 4);
    const feeXbt = (satPerVbyte * estimatedVbytes) / 100_000_000;
    const rate = await this.getFiatRate();
    return ok({
      feeXbt,
      feeUsd: rate.ok ? feeXbt * rate.value.usdPerXbt : Number.NaN,
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
    if (input.walletId.startsWith("watch-"))
      return err(
        "invalid_input",
        "Watch-only wallets cannot sign or send. Use the wallet that owns this address.",
      );
    return this.demo.sendDemoTransaction(input);
  }

  /**
   * Read the network status. Concurrent callers share one in-flight promise,
   * so the shared network-status source never issues duplicate concurrent
   * reads. The promise is cleared once it settles, so a later refresh starts a
   * fresh read.
   */
  getNetworkStatus(): Promise<ServiceResult<NetworkStatus>> {
    if (!this.networkRequest)
      this.networkRequest = this.readNetworkStatus().finally(() => {
        this.networkRequest = null;
      });
    return this.networkRequest;
  }

  private async readNetworkStatus(): Promise<ServiceResult<NetworkStatus>> {
    const actor = await this.configuredActor();
    if (!actor)
      return ok({
        network: "unconfigured",
        host: "",
        port: 0,
        tls: true,
        state: "offline",
        blockHeight: Number.NaN,
        lastSyncedAt: Number.NaN,
        peers: Number.NaN,
        checkpointConfigured: false,
      });

    let result: BridgeResult;
    try {
      result = await actor.getServerStatus();
    } catch {
      return err(
        "backend_unavailable",
        "The bridge is unreachable. Try again in a moment.",
      );
    }
    if (result.__kind__ === "err") {
      const mapped = mapBridgeError(result.err);
      return err(mapped.code, mapped.message);
    }

    const height = Number(result.ok.height);
    return ok({
      network: "unconfigured",
      // The bridge base URL is never surfaced; the configured server host is a
      // separate, user-owned setting.
      host: "",
      port: 50002,
      tls: true,
      state: "connected",
      blockHeight: Number.isFinite(height) ? height : 0,
      lastSyncedAt: Date.now(),
      peers: Number.NaN,
      checkpointConfigured: result.ok.checkpointConfigured,
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

    const actor = await this.configuredActor();
    if (!actor)
      return ok({
        ok: false,
        state: "offline",
        message: "The deployed bridge is not configured or is unreachable.",
        latencyMs: null,
      });

    const started = Date.now();
    let result: BridgeResult;
    try {
      result = await actor.getServerStatus();
    } catch {
      return ok({
        ok: false,
        state: "offline",
        message: "The bridge is unreachable. Try again in a moment.",
        latencyMs: null,
      });
    }
    if (result.__kind__ === "err") {
      const mapped = mapBridgeError(result.err);
      return ok({
        ok: false,
        state: mapped.code === "backend_unavailable" ? "offline" : "error",
        message: mapped.message,
        latencyMs: null,
      });
    }

    return ok({
      ok: true,
      state: "connected",
      message: `Bridge reachable — server ${
        result.ok.serverVersion || "unknown"
      }, protocol ${result.ok.protocolVersion || "unknown"}.`,
      latencyMs: Date.now() - started,
    });
  }

  async getFiatRate(): Promise<ServiceResult<FiatRate>> {
    const settings = settingsService.getSettings();
    const price = settings.ok ? settings.value.manualUsdPerXbt : undefined;
    return price
      ? ok({ usdPerXbt: price, source: "manual", fetchedAt: Date.now() })
      : err(
          "not_configured",
          "No XBT fiat price is configured. Add a manual USD price in Settings.",
        );
  }
}

/** Shared singleton used by the app. */
export const bridgeWalletService: WalletService = new BridgeWalletService();

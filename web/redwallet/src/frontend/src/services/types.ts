/** Shared data shapes for watch-only addresses and explicitly simulated wallets.
 * Unknown numeric chain fields use NaN and render as unavailable; they are
 * never persisted as balances, prices, or transaction metadata.
 */

/** Display unit for XBT amounts. XBT is the ISO-style code for the unit. */
export type DisplayUnit = "XBT" | "BTC";

/** Theme preference persisted by the settings service. */
export type ThemePreference = "light" | "dark" | "system";

/**
 * XBT network the demo wallet is pointed at.
 *
 * This build has no real XBT backend, so the only valid value is
 * `"unconfigured"`. No network is selected or claimed until a real backend
 * is connected.
 */
export type NetworkName = "unconfigured";

/** Direction of a transaction relative to the active wallet. */
export type TransactionDirection = "send" | "receive" | "unknown";

/** Lifecycle status of a transaction. */
export type TransactionStatus = "confirmed" | "pending" | "failed";

/**
 * Connection state for the configured backend server.
 *
 * `connecting` is a transient UI state shown while a read is in flight;
 * `offline` is the offline-by-design state when no bridge is configured;
 * `error` is a failed read. A `connected` state is only ever reported from an
 * actual successful read — it is never fabricated.
 */
export type ConnectionState = "connected" | "connecting" | "offline" | "error";

/** A demo wallet / account. Never contains key material. */
export interface Wallet {
  id: string;
  name: string;
  /**
   * Neutral demo label shown in place of any address-like identifier.
   * Never an address and never derived from key material.
   */
  shortId: string;
  balanceXbt: number;
  fiatValueUsd: number;
  isDemo: boolean;
  /** Explicit user-provided public address. Never derived in this app. */
  address?: string;
  balanceError?: string;
  unconfirmedXbt?: number;
}

/** A single transaction record for a wallet. */
export interface Transaction {
  id: string;
  walletId: string;
  direction: TransactionDirection;
  status: TransactionStatus;
  amountXbt: number;
  fiatUsd: number;
  /** Unix epoch milliseconds. */
  timestamp: number;
  counterpartyAddress: string;
  note: string;
  feeXbt: number;
  confirmations: number;
  txid: string;
  isLive?: boolean;
  blockHeight?: number;
}

/** Electrum/Fulcrum server configuration. */
export interface NetworkConfig {
  network: NetworkName;
  host: string;
  port: number;
  tls: boolean;
}

/** Result of a fee estimation request. */
export interface FeeEstimate {
  feeXbt: number;
  feeUsd: number;
  satPerVbyte: number;
  estimatedBlocks: number;
}

/**
 * One unspent transaction output for a watched address, as reported by the
 * bridge. Read-only: this shape is never used to construct or sign a spend.
 *
 * `txid` is a 64-character lowercase hex string, `vout` is the output index
 * within that transaction, `height` is the confirming block height (0 for an
 * unconfirmed output), and `value` is the output amount in satoshis.
 */
export interface Utxo {
  txid: string;
  vout: number;
  height: bigint;
  value: bigint;
}

/** Unspent outputs for one address. Capped at 1000 entries by the bridge. */
export interface AddressUtxos {
  utxos: Utxo[];
}

/**
 * Raw transaction bytes as reported by the bridge, hex-encoded and lowercased.
 * Read-only: the app never parses this into a spend or broadcasts it.
 */
export interface RawTransaction {
  hex: string;
}

/** Result of a server connection test. */
export interface ServerTestResult {
  ok: boolean;
  state: ConnectionState;
  message: string;
  latencyMs: number | null;
}

/** Live network / backend status readout. */
export interface NetworkStatus {
  network: NetworkName;
  host: string;
  port: number;
  tls: boolean;
  state: ConnectionState;
  /** Demo block height readout. */
  blockHeight: number;
  /** Unix epoch milliseconds of the last successful sync. */
  lastSyncedAt: number;
  /** Demo peer count. */
  peers: number;
  /**
   * Whether a verified XBT checkpoint/network identity is configured. Always
   * false in this build — no checkpoint is inferred and no BTC compatibility
   * is claimed.
   */
  checkpointConfigured: boolean;
}

/** Fiat rate snapshot. */
export interface FiatRate {
  /** USD price of one XBT. */
  usdPerXbt: number;
  /** Where the rate came from. */
  source: "coingecko" | "fallback" | "manual";
  /** Unix epoch milliseconds the rate was observed. */
  fetchedAt: number;
}

/** Filters accepted by `listTransactions`. */
export interface TransactionFilters {
  status?: TransactionStatus | "all";
  direction?: TransactionDirection | "all";
  /** Free-text search across counterparty address and note. */
  query?: string;
}

/** Persisted user settings. */
export interface UserSettings {
  displayUnit: DisplayUnit;
  theme: ThemePreference;
  network: NetworkName;
  serverHost: string;
  serverPort: number;
  serverTls: boolean;
  manualUsdPerXbt?: number;
  manualPriceUpdatedAt?: number;
}

/** A demo-only send result. Never represents a broadcast transaction. */
export interface DemoSendResult {
  /** Always false — this build never broadcasts. */
  broadcast: false;
  /** Always true — the record is a local demo artifact. */
  demo: true;
  transaction: Transaction;
  message: string;
}

/** Error shape carried by a failed `ServiceResult`. */
export interface ServiceError {
  code:
    | "not_found"
    | "invalid_input"
    | "network"
    | "timeout"
    | "not_configured"
    | "backend_unavailable"
    | "unknown";
  message: string;
}

/**
 * Result-style wrapper for every service call. Services never throw to the
 * UI; they resolve to `{ ok: true, value }` or `{ ok: false, error }`.
 */
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ServiceError };

/** Convenience constructor for a successful result. */
export function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

/** Convenience constructor for a failed result. */
export function err<T = never>(
  code: ServiceError["code"],
  message: string,
): ServiceResult<T> {
  return { ok: false, error: { code, message } };
}

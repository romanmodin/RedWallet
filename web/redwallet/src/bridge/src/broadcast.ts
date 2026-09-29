/** Narrow broadcast coordinator; RPC stays disabled without operator opt-in.
 * Caller must authenticate, enforce paid-call limits, and verify the XBT
 * checkpoint before invoking. No automatic retries or replacement signing.
 */
import { BridgeError } from "./errors.js";
import { validateSignedWebTransaction } from "./transaction.js";

export interface BroadcastReceipt {
  readonly txid: string;
  readonly outcome: "acknowledged" | "unknown";
}
interface Entry {
  hex: string;
  receipt: BroadcastReceipt;
  expiresAt: number;
  pending: Promise<BroadcastReceipt> | null;
}
interface BroadcastUpstream { call(method: string, params: unknown[]): Promise<unknown> }
const WINDOW_MS = 10 * 60_000;

/** Unknown means the transaction MAY have been accepted: never call it rejected. */
export class BroadcastCoordinator {
  #entries = new Map<string, Entry>();
  constructor(private readonly upstream: BroadcastUpstream, private readonly now = () => Date.now()) {}

  async submit(raw: unknown): Promise<BroadcastReceipt> {
    const { hex, txid } = validateSignedWebTransaction(raw);
    const now = this.now();
    if (!Number.isFinite(now)) throw new BridgeError("upstream_unavailable");
    for (const [key, entry] of this.#entries) if (!entry.pending && entry.expiresAt <= now) this.#entries.delete(key);
    const existing = this.#entries.get(txid);
    if (existing) {
      // Same non-witness ID with different witness bytes is not an idempotent retry.
      if (existing.hex !== hex) throw new BridgeError("invalid_request");
      if (existing.pending) return existing.pending;
      if (existing.receipt.outcome === "acknowledged") return existing.receipt;
      // During the receipt window, repeat requests only reconcile, never rebroadcast.
      existing.pending = this.#reconcile(existing).finally(() => { existing.pending = null; });
      return existing.pending;
    }
    if (this.#entries.size >= 128) throw new BridgeError("rate_limited");
    const entry: Entry = { hex, receipt: Object.freeze({ txid, outcome: "unknown" }), expiresAt: now + WINDOW_MS, pending: null };
    this.#entries.set(txid, entry);
    entry.pending = this.#broadcast(entry).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  async #broadcast(entry: Entry): Promise<BroadcastReceipt> {
    try {
      const result = await this.upstream.call("blockchain.transaction.broadcast", [entry.hex]);
      if (typeof result === "string" && result.toLowerCase() === entry.receipt.txid) {
        entry.receipt = Object.freeze({ txid: entry.receipt.txid, outcome: "acknowledged" });
      }
    } catch { /* Timeout, RPC error, and lost reply cannot establish non-acceptance. */ }
    return entry.receipt;
  }

  async #reconcile(entry: Entry): Promise<BroadcastReceipt> {
    try {
      const result = await this.upstream.call("blockchain.transaction.get", [entry.receipt.txid, false]);
      if (typeof result === "string" && result.toLowerCase() === entry.hex) {
        entry.receipt = Object.freeze({ txid: entry.receipt.txid, outcome: "acknowledged" });
      }
    } catch { /* Not found and unavailable are both inconclusive here. */ }
    return entry.receipt;
  }
}

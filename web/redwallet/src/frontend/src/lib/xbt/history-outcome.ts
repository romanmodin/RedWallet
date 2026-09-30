/** Public transaction accounting only. No signing or spend authorization. */
import { Buffer } from "buffer";
import type { BridgeActor } from "@/services/bridgeService";
import { Transaction, address, networks } from "bitcoinjs-lib";
import type { AccountSnapshot } from "./account-reader";
import { IssuedAddresses } from "./issued-addresses";
import { publicAddress } from "./key-material";
import { publicStorageKey, validateSnapshot } from "./public-wallet-storage";

const MAX_MONEY = 2100000000000000n;
const CHECKPOINT =
  "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb";
export interface HistoryOutcome {
  kind: "received" | "sent" | "self" | "net";
  amount: bigint;
  balanceChange: bigint;
  fee: bigint | null;
}
export function historyTransaction(txid: string, hex: string): Transaction {
  if (
    !/^[0-9a-f]{64}$/.test(txid) ||
    typeof hex !== "string" ||
    hex.length > 200000 ||
    !/^(?:[0-9a-f]{2})+$/.test(hex)
  )
    throw Error("Transaction details are outside supported bounds");
  const tx = Transaction.fromHex(hex);
  if (
    tx.getId() !== txid ||
    tx.toHex() !== hex ||
    !tx.ins.length ||
    tx.ins.length > 64 ||
    !tx.outs.length ||
    tx.outs.length > 256
  )
    throw Error("Transaction details could not be verified");
  let total = 0n;
  for (const output of tx.outs) {
    if (output.value < 0n || output.value > MAX_MONEY)
      throw Error("Invalid transaction value");
    total += output.value;
  }
  if (total > MAX_MONEY) throw Error("Invalid transaction total");
  return tx;
}
export function parentId(hash: Uint8Array) {
  return Buffer.from(hash).reverse().toString("hex");
}
/** Scripts come from the authenticated public account and validated discovery. */
export function ownedHistoryScripts(
  xpub: string,
  snapshot: AccountSnapshot,
): Set<string> {
  validateSnapshot(xpub, snapshot);
  const issued = new IssuedAddresses(xpub, localStorage).read();
  const result = new Set<string>();
  for (const branch of [0, 1] as const) {
    const indices = new Set([
      ...snapshot.branches[branch].used.map((entry) => entry.index),
      snapshot.branches[branch].next.index,
    ]);
    for (let index = 0; index <= issued[branch]; index++) indices.add(index);
    for (const index of indices)
      result.add(
        Buffer.from(
          address.toOutputScript(
            publicAddress(xpub, branch, index),
            networks.bitcoin,
          ),
        ).toString("hex"),
      );
  }
  return result;
}
/** Verify every referenced parent, then exclude wallet change from sent amounts.
 * Mixed ownership reports only net wallet change; it cannot attribute the fee.
 */
export function historyOutcome(
  txid: string,
  hex: string,
  parents: ReadonlyMap<string, string>,
  owned: ReadonlySet<string>,
): HistoryOutcome {
  const tx = historyTransaction(txid, hex);
  const coinbase = tx.isCoinbase();
  let inputs = 0n;
  let ownedInputs = 0n;
  let ownedInputCount = 0;
  const spent = new Set<string>();
  if (!coinbase)
    for (const input of tx.ins) {
      const id = parentId(input.hash);
      const outpoint = `${id}:${input.index}`;
      if (spent.has(outpoint)) throw Error("Duplicate transaction input");
      spent.add(outpoint);
      const raw = parents.get(id);
      if (!raw)
        throw Error("A parent transaction is unavailable; amount is unknown");
      const prev = historyTransaction(id, raw).outs[input.index];
      if (!prev) throw Error("Invalid parent output");
      inputs += prev.value;
      if (owned.has(Buffer.from(prev.script).toString("hex"))) {
        ownedInputs += prev.value;
        ownedInputCount++;
      }
    }
  const outputs = tx.outs.reduce((sum, out) => sum + out.value, 0n);
  const ownedOutputs = tx.outs.reduce(
    (sum, out) =>
      sum +
      (owned.has(Buffer.from(out.script).toString("hex")) ? out.value : 0n),
    0n,
  );
  if (inputs > MAX_MONEY || (!coinbase && inputs < outputs))
    throw Error("Invalid transaction accounting");
  if (!ownedInputCount && ownedOutputs === 0n)
    throw Error("Transaction does not match this discovered account");
  const balanceChange = ownedOutputs - ownedInputs;
  if (!ownedInputCount)
    return { kind: "received", amount: ownedOutputs, balanceChange, fee: null };
  if (ownedInputCount !== tx.ins.length)
    return { kind: "net", amount: balanceChange, balanceChange, fee: null };
  const external = outputs - ownedOutputs;
  return {
    kind: external ? "sent" : "self",
    amount: -external,
    balanceChange,
    fee: inputs - outputs,
  };
}

/** Cache raw proofs, not trusted amount fields. Recompute for the current xpub.
 * One account's cache is capped at 1 MiB / 200 raw transactions.
 */
export class HistoryTransactions {
  readonly raw = new Map<string, string>();
  readonly key: string;
  constructor(
    xpub: string,
    private storage: Storage = localStorage,
  ) {
    this.key = publicStorageKey(xpub, "history-transactions");
    try {
      const saved = storage.getItem(this.key);
      if (!saved || saved.length > 1000000) return;
      const entries = JSON.parse(saved);
      if (!Array.isArray(entries) || entries.length > 200) return;
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2)
          throw Error("Invalid saved transaction");
        historyTransaction(entry[0], entry[1]);
        this.raw.set(entry[0], entry[1]);
      }
    } catch {
      this.raw.clear();
    }
  }
  save() {
    const raw = JSON.stringify([...this.raw]);
    if (this.raw.size > 200 || raw.length > 1000000)
      throw Error(
        "Transaction cache is full; amounts remain visible in this tab",
      );
    this.storage.setItem(this.key, raw);
    if (this.storage.getItem(this.key) !== raw)
      throw Error("Transaction amounts could not be saved on this device");
  }
  outcome(txid: string, owned: ReadonlySet<string>): HistoryOutcome | null {
    try {
      const raw = this.raw.get(txid);
      return raw ? historyOutcome(txid, raw, this.raw, owned) : null;
    } catch {
      return null;
    }
  }
}
type NetworkState = {
  last: number;
  pending: Promise<unknown> | null;
  busy: boolean;
};
const networksInFlight = new WeakMap<BridgeActor, NetworkState>();
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error("Transaction read paused"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(Error("Transaction read paused"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
/** Sequential public reads share their pace/pending guard across navigation. */
export class HistoryReader {
  readonly state: NetworkState;
  constructor(
    private actor: BridgeActor,
    private cache: HistoryTransactions,
    private clock = () => performance.now(),
    private wait = pause,
  ) {
    const existing = networksInFlight.get(actor);
    this.state = existing ?? {
      last: Number.NEGATIVE_INFINITY,
      pending: null,
      busy: false,
    };
    networksInFlight.set(actor, this.state);
  }
  async request<T>(call: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.state.pending)
      throw Error(
        "The previous transaction request is still finishing; retry shortly",
      );
    if (signal?.aborted) throw Error("Transaction read paused");
    const delay = 3500 - (this.clock() - this.state.last);
    if (delay > 0) await this.wait(delay, signal);
    if (signal?.aborted) throw Error("Transaction read paused");
    this.state.last = this.clock();
    const pending = Promise.resolve()
      .then(call)
      .finally(() => {
        if (this.state.pending === pending) this.state.pending = null;
      });
    this.state.pending = pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(Error("Transaction read paused"));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => reject(Error("Transaction details timed out; retry to continue")),
        35000,
      );
    });
    try {
      const result = await Promise.race([pending, interrupted]);
      if (signal?.aborted) throw Error("Transaction read paused");
      return result;
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
    }
  }
  async transaction(id: string, signal?: AbortSignal) {
    if (this.cache.raw.has(id)) return this.cache.raw.get(id)!;
    if (this.cache.raw.size >= 200)
      throw Error("Saved transaction details reached their supported limit");
    const result = await this.request(
      () => this.actor.getRawTransaction(id),
      signal,
    );
    if (result.__kind__ !== "ok")
      throw Error(
        "Transaction details are unavailable; saved history is unchanged",
      );
    historyTransaction(id, result.ok.hex);
    const size = [...this.cache.raw.values()].reduce(
      (n, hex) => n + hex.length + 80,
      0,
    );
    if (size + result.ok.hex.length + 80 > 1000000)
      throw Error(
        "Saved transaction details reached their supported size limit",
      );
    this.cache.raw.set(id, result.ok.hex);
    return result.ok.hex;
  }
  async load(
    ids: readonly string[],
    owned: ReadonlySet<string>,
    signal?: AbortSignal,
    progress?: (id: string, outcome: HistoryOutcome, saved: boolean) => void,
  ) {
    if (ids.length > 20) throw Error("Load up to 20 transactions at a time");
    if (this.state.busy) throw Error("Transaction amounts are already loading");
    this.state.busy = true;
    try {
      const result = await this.request(
        () => this.actor.getServerStatus(),
        signal,
      );
      if (
        result.__kind__ !== "ok" ||
        !result.ok.checkpointConfigured ||
        result.ok.checkpointHeight !== 961640n ||
        result.ok.checkpointHash !== CHECKPOINT ||
        result.ok.height < 961640n
      )
        throw Error("The XBT checkpoint could not be verified");
      for (const id of ids) {
        const hex = await this.transaction(id, signal);
        const tx = historyTransaction(id, hex);
        if (!tx.isCoinbase())
          for (const input of tx.ins)
            await this.transaction(parentId(input.hash), signal);
        const outcome = historyOutcome(id, hex, this.cache.raw, owned);
        let saved = true;
        try {
          this.cache.save();
        } catch {
          saved = false;
        }
        progress?.(id, outcome, saved);
      }
    } finally {
      this.state.busy = false;
    }
  }
}

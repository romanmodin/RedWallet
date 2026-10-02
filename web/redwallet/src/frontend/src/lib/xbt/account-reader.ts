/** Checkpoint-verified, paced public account reads. No private-key arguments. */
import type { BridgeActor } from "@/services/bridgeService";
import type { BranchDiscovery } from "./discovery";
import { type DiscoveryProgress, DiscoverySession } from "./discovery-session";
import type { ScanCheckpoint } from "./scan-checkpoint";

const CHECKPOINT_HEIGHT = 961640n;
const CHECKPOINT_HASH =
  "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb";
const MAX_MONEY = 2_100_000_000_000_000n;
export interface PublicHistoryRow {
  txid: string;
  height: bigint;
}
export interface AccountSnapshot {
  branches: readonly [BranchDiscovery, BranchDiscovery];
  confirmed: bigint;
  unconfirmed: bigint;
  history: readonly PublicHistoryRow[];
  height: number;
  observedAt: number;
}
type Wait = (ms: number, signal?: AbortSignal) => Promise<void>;
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error("Account read cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(Error("Account read cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function unwrap<T>(
  value: { __kind__: "ok"; ok: T } | { __kind__: "err"; err: unknown },
): T {
  if (value.__kind__ !== "ok")
    throw Error(
      "Account read failed; pause and retry when the bridge is available. No empty balance was assumed.",
    );
  return value.ok;
}
function checkHistory(rows: PublicHistoryRow[]) {
  if (!Array.isArray(rows) || rows.length > 1000)
    throw Error("Invalid or incomplete address history");
  const seen = new Set<string>();
  return rows.map((row) => {
    if (
      !/^[0-9a-f]{64}$/.test(row.txid) ||
      typeof row.height !== "bigint" ||
      row.height < -1n ||
      row.height > BigInt(Number.MAX_SAFE_INTEGER) ||
      seen.has(row.txid)
    )
      throw Error("Malformed address history");
    seen.add(row.txid);
    return Object.freeze({ txid: row.txid, height: row.height });
  });
}

/** One bounded discovery session. Construct a new reader for a fresh complete scan. */
export class AccountReader {
  #lastStart = Number.NEGATIVE_INFINITY;
  #pending: Promise<unknown> | null = null;
  #busy = false;
  #history = new Map<string, PublicHistoryRow[]>();
  readonly #discovery: DiscoverySession;
  #branches: readonly [BranchDiscovery, BranchDiscovery] | null = null;
  readonly #startedAt: number;
  constructor(
    readonly accountXpub: string,
    private readonly actor: BridgeActor,
    bounds: {
      gapLimit?: number;
      maxAddressesPerBranch?: number;
      issuedThrough?: readonly [number, number];
    } = {},
    private readonly clock: () => number = () => performance.now(),
    private readonly wait: Wait = pause,
    recovery?: {
      checkpoint?: ScanCheckpoint | null;
      onCheckpoint: (value: ScanCheckpoint) => void;
    },
  ) {
    const saved = recovery?.checkpoint;
    this.#startedAt = saved?.startedAt ?? Date.now();
    // A saved entry is used only when discovery derives that exact address from
    // the unlocked account. These are historical hints, never spendable coins.
    this.#history = new Map(saved?.history ?? []);
    this.#discovery = new DiscoverySession(
      accountXpub,
      async (address, signal) => {
        const history = unwrap(
          await this.#request(() => actor.getAddressHistory(address), signal),
        );
        const entries = checkHistory(history.entries);
        this.#history.set(address, entries);
        recovery?.onCheckpoint({
          startedAt: this.#startedAt,
          gap: bounds.gapLimit ?? 20,
          cap: bounds.maxAddressesPerBranch ?? 1000,
          history: [...this.#history],
        });
        return entries.length > 0;
      },
      bounds,
      clock,
      wait,
      (address) => {
        const cached = this.#history.get(address);
        return cached ? cached.length > 0 : undefined;
      },
    );
  }

  async #request<T>(call: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#pending)
      throw Error(
        "The previous network request is still finishing; wait before retrying",
      );
    if (signal?.aborted) throw Error("Account read cancelled");
    const remaining = 3500 - (this.clock() - this.#lastStart);
    if (remaining > 0) await this.wait(remaining, signal);
    if (signal?.aborted) throw Error("Account read cancelled");
    this.#lastStart = this.clock();
    const pending = Promise.resolve()
      .then(call)
      .finally(() => {
        if (this.#pending === pending) this.#pending = null;
      });
    this.#pending = pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(Error("Account read cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () =>
          reject(Error("Account read timed out; no empty result was assumed")),
        35_000,
      );
    });
    try {
      const result = await Promise.race([pending, interrupted]);
      if (signal?.aborted) throw Error("Account read cancelled");
      return result;
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
    }
  }

  async #height(signal?: AbortSignal): Promise<number> {
    const status = unwrap(
      await this.#request(() => this.actor.getServerStatus(), signal),
    );
    if (
      !status.checkpointConfigured ||
      status.checkpointHeight !== CHECKPOINT_HEIGHT ||
      status.checkpointHash !== CHECKPOINT_HASH ||
      typeof status.height !== "bigint" ||
      status.height < CHECKPOINT_HEIGHT ||
      status.height > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw Error("The configured XBT checkpoint could not be verified");
    return Number(status.height);
  }

  async scan(
    signal?: AbortSignal,
    progress?: (value: DiscoveryProgress) => void,
  ): Promise<AccountSnapshot> {
    if (this.#busy) throw Error("Account discovery is already running");
    this.#busy = true;
    try {
      await this.#height(signal);
      // Discovery may have completed before a later balance request failed.
      // Resume that phase instead of rerunning a completed DiscoverySession.
      const branches =
        this.#branches ??
        (await this.#discovery.run(signal, (value) =>
          progress?.({
            ...value,
            checked: Math.max(value.checked, this.#history.size),
          }),
        ));
      this.#branches = branches;
      let confirmed = 0n;
      let unconfirmed = 0n;
      const txs = new Map<string, PublicHistoryRow>();
      for (const branch of branches)
        for (const entry of branch.used) {
          const balance = unwrap(
            await this.#request(
              () => this.actor.getAddressBalance(entry.address),
              signal,
            ),
          );
          if (
            typeof balance.confirmed !== "bigint" ||
            typeof balance.unconfirmed !== "bigint" ||
            balance.confirmed < 0n ||
            balance.confirmed > MAX_MONEY ||
            balance.unconfirmed < -MAX_MONEY ||
            balance.unconfirmed > MAX_MONEY
          )
            throw Error("Malformed address balance");
          confirmed += balance.confirmed;
          unconfirmed += balance.unconfirmed;
          for (const row of this.#history.get(entry.address) ?? []) {
            const previous = txs.get(row.txid);
            if (previous && previous.height !== row.height)
              throw Error(
                "Transaction confirmation changed during discovery; start a fresh scan",
              );
            txs.set(row.txid, row);
          }
        }
      if (
        confirmed > MAX_MONEY ||
        unconfirmed < -MAX_MONEY ||
        unconfirmed > MAX_MONEY ||
        confirmed + unconfirmed < 0n ||
        confirmed + unconfirmed > MAX_MONEY
      )
        throw Error(
          "Inconsistent aggregate account balance; start a fresh scan",
        );
      const height = await this.#height(signal);
      if ([...txs.values()].some((row) => row.height > BigInt(height)))
        throw Error("Chain changed during discovery; start a fresh scan");
      return Object.freeze({
        branches,
        confirmed,
        unconfirmed,
        history: Object.freeze([...txs.values()]),
        height,
        observedAt: this.#startedAt,
      });
    } finally {
      this.#busy = false;
    }
  }
}

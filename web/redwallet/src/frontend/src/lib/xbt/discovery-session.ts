/** Resumable public-only discovery. In-memory observations never establish spendability. */
import {
  type DiscoveryOptions,
  type HistoryProbe,
  discoverAccount,
} from "./discovery";

export interface DiscoveryProgress {
  checked: number;
  reused: number;
}

/** Abortable pacing; no further paid request starts after cancellation. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error("Discovery cancelled"));
    const aborted = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      reject(Error("Discovery cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

/**
 * Reuses successful observations across pause/retry within this one scan only.
 * An optional caller-owned historical checkpoint can seed a resumed scan.
 * Never persists observations or returns a partial scan as complete. Start a
 * new session to refresh completed results. A five-minute pause discards the
 * cache; this is bounded recovery, not a live balance or freshness guarantee.
 *
 * Paces starts at least 3.5 seconds apart (below the canister's 20/minute
 * authenticated quota); other app reads can still cause explicit rate errors.
 * A cancelled in-flight probe must settle before another run can begin.
 */
export class DiscoverySession {
  #observations = new Map<string, boolean>();
  #busy = false;
  #completed = false;
  #lastStart = Number.NEGATIVE_INFINITY;
  #lastFinished = Number.NEGATIVE_INFINITY;
  readonly #bounds: Omit<DiscoveryOptions, "signal">;
  constructor(
    readonly accountXpub: string,
    private readonly probe: HistoryProbe,
    bounds: Omit<DiscoveryOptions, "signal"> = {},
    private readonly clock: () => number = () => performance.now(),
    private readonly wait: (
      ms: number,
      signal?: AbortSignal,
    ) => Promise<void> = delay,
    private readonly savedObservation?: (
      address: string,
    ) => boolean | undefined,
  ) {
    this.#bounds = {
      ...bounds,
      issuedThrough: bounds.issuedThrough
        ? [...bounds.issuedThrough]
        : undefined,
    };
  }
  get checked(): number {
    return this.#observations.size;
  }
  async run(
    signal?: AbortSignal,
    progress?: (value: DiscoveryProgress) => void,
  ) {
    if (this.#busy) throw Error("Discovery is already running");
    if (this.#completed)
      throw Error("Start a new session to refresh completed discovery");
    if (signal?.aborted) throw Error("Discovery cancelled");
    if (this.clock() - this.#lastFinished > 5 * 60_000)
      this.#observations.clear();
    this.#busy = true;
    let reused = 0;
    try {
      const result = await discoverAccount(
        this.accountXpub,
        async (address) => {
          if (signal?.aborted) throw Error("Discovery cancelled");
          if (this.#observations.has(address)) {
            reused++;
            progress?.({ checked: this.checked, reused });
            return this.#observations.get(address)!;
          }
          const saved = this.savedObservation?.(address);
          if (saved !== undefined) {
            this.#observations.set(address, saved);
            reused++;
            progress?.({ checked: this.checked, reused });
            return saved;
          }
          const remaining = 3500 - (this.clock() - this.#lastStart);
          if (remaining > 0) await this.wait(remaining, signal);
          if (signal?.aborted) throw Error("Discovery cancelled");
          this.#lastStart = this.clock();
          const active = await this.probe(address, signal);
          // Discard results arriving after cancellation; they must not silently
          // advance the next run's recovery state.
          if (signal?.aborted) throw Error("Discovery cancelled");
          if (typeof active !== "boolean")
            throw Error("Invalid history observation");
          this.#observations.set(address, active);
          progress?.({ checked: this.checked, reused });
          return active;
        },
        { ...this.#bounds, signal },
      );
      this.#completed = true;
      return result;
    } finally {
      this.#lastFinished = this.clock();
      this.#busy = false;
    }
  }
}

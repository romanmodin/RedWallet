/** Public data only: exact-parent verification before an immutable local review. */
import type { BridgeActor } from "@/services/bridgeService";
import type { AccountSnapshot } from "./account-reader";
import type { IssuedAddresses } from "./issued-addresses";
import { publicAddress } from "./key-material";
import { type CandidateCoin, planSpend, verifyCoin } from "./spend-plan";
import { SpendReview } from "./spend-review";
const CHECKPOINT =
  "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb";
function ok<T>(
  result: { __kind__: "ok"; ok: T } | { __kind__: "err"; err: unknown },
): T {
  if (result.__kind__ !== "ok")
    throw Error("Payment preparation could not verify the live XBT data");
  return result.ok;
}
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error("Payment preparation cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(Error("Payment preparation cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export class SpendPreparation {
  #pending: Promise<unknown> | null = null;
  #busy = false;
  #last = Number.NEGATIVE_INFINITY;
  constructor(
    readonly accountXpub: string,
    private actor: BridgeActor,
    private book: IssuedAddresses,
    private clock = () => performance.now(),
    private pause = wait,
  ) {}
  async #read<T>(call: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw Error("Payment preparation cancelled");
    if (this.#pending) throw Error("Previous payment read is still finishing");
    const delay = 3500 - (this.clock() - this.#last);
    if (delay > 0) await this.pause(delay, signal);
    if (signal?.aborted) throw Error("Payment preparation cancelled");
    this.#last = this.clock();
    const pending = Promise.resolve()
      .then(call)
      .finally(() => {
        if (this.#pending === pending) this.#pending = null;
      });
    this.#pending = pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(Error("Payment preparation cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => reject(Error("Payment data timed out; no payment was signed")),
        35000,
      );
    });
    try {
      const result = await Promise.race([pending, interrupted]);
      if (signal?.aborted) throw Error("Payment preparation cancelled");
      return result;
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
    }
  }
  async #status(signal?: AbortSignal) {
    const s = ok(await this.#read(() => this.actor.getServerStatus(), signal));
    if (
      !s.checkpointConfigured ||
      s.checkpointHeight !== 961640n ||
      s.checkpointHash !== CHECKPOINT ||
      typeof s.height !== "bigint" ||
      s.height < 961640n ||
      s.height > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw Error("XBT checkpoint verification failed");
    if (s.broadcastEnabled !== true)
      throw Error("Sending is not enabled by the bridge operator");
    return Number(s.height);
  }
  async prepare(
    snapshot: AccountSnapshot,
    destination: string,
    amountXbt: string,
    feeRate: number,
    signal?: AbortSignal,
  ): Promise<{ review: SpendReview; suggestedFeeRate: number }> {
    if (this.#busy) throw Error("Payment preparation already running");
    if (this.book.accountXpub !== this.accountXpub)
      throw Error("Wrong change-address account");
    if (
      !Number.isFinite(snapshot.observedAt) ||
      Date.now() - snapshot.observedAt < 0 ||
      Date.now() - snapshot.observedAt > 300000
    )
      throw Error("Scan the account again before preparing a payment");
    this.#busy = true;
    try {
      const tip = await this.#status(signal);
      const fee = ok(
        await this.#read(() => this.actor.getFeeEstimate(), signal),
      );
      if (
        typeof fee.satoshisPerKb !== "bigint" ||
        fee.satoshisPerKb < 0n ||
        fee.satoshisPerKb > 1000000n
      )
        throw Error("Fee estimate is unavailable or exceeds limits");
      const suggestedFeeRate = Math.max(
        1,
        Math.ceil(Number(fee.satoshisPerKb) / 1000),
      );
      const coins: CandidateCoin[] = [];
      const outpoints = new Set<string>();
      const parents = new Map<string, string>();
      for (const branch of snapshot.branches)
        for (const entry of branch.used) {
          if (
            entry.address !==
            publicAddress(this.accountXpub, entry.branch, entry.index)
          )
            throw Error("Account scan address mismatch");
          const result = ok(
            await this.#read(
              () => this.actor.getAddressUtxos(entry.address),
              signal,
            ),
          );
          if (!Array.isArray(result.utxos) || result.utxos.length > 1000)
            throw Error("Invalid or incomplete coin list");
          for (const u of result.utxos) {
            if (
              typeof u.height !== "bigint" ||
              u.height < 0n ||
              u.height > BigInt(tip) ||
              typeof u.value !== "bigint" ||
              u.value <= 0n ||
              u.value > 2100000000000000n ||
              !/^[0-9a-f]{64}$/.test(u.txid) ||
              !Number.isInteger(u.vout) ||
              u.vout < 0 ||
              u.vout > 0xffffffff
            )
              throw Error("Invalid unspent output");
            const key = `${u.txid}:${u.vout}`;
            if (outpoints.has(key)) throw Error("Duplicate unspent output");
            outpoints.add(key);
            if (u.height === 0n) continue;
            if (coins.length >= 100)
              throw Error(
                "Use the native wallet for more than 100 confirmed outputs",
              );
            let parent = parents.get(u.txid);
            if (!parent) {
              parent = ok(
                await this.#read(
                  () => this.actor.getRawTransaction(u.txid),
                  signal,
                ),
              ).hex;
              parents.set(u.txid, parent);
            }
            const coin: CandidateCoin = {
              txid: u.txid,
              vout: u.vout,
              value: u.value.toString(),
              height: Number(u.height),
              branch: entry.branch,
              index: entry.index,
              parentHex: parent,
            };
            verifyCoin(coin, this.accountXpub, tip);
            coins.push(coin);
          }
        }
      const finalTip = await this.#status(signal);
      if (finalTip < tip)
        throw Error("Chain height changed backwards; scan again");
      const change = await this.book.reserve(
        1,
        snapshot.branches[1].next.index,
        signal,
      );
      if (signal?.aborted) throw Error("Payment preparation cancelled");
      return {
        review: new SpendReview(
          planSpend({
            accountXpub: this.accountXpub,
            coins,
            destination,
            amountXbt,
            feeRate,
            changeIndex: change.index,
            tipHeight: finalTip,
          }),
        ),
        suggestedFeeRate,
      };
    } finally {
      this.#busy = false;
    }
  }
}

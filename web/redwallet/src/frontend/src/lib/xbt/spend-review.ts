/** One-shot, immutable transaction review. The caller supplies freshly verified chain data. */
import { providerGeneration } from "@/services/networkGeneration";
import type { XbtKeySession } from "./key-material";
import { type SpendPlan, reviewDigest, signReviewedPlan } from "./spend-plan";

export class SpendReview {
  readonly #plan: SpendPlan;
  readonly #digest: string;
  readonly #wallDeadline: number;
  readonly #monotonicDeadline: number;
  #active = true;
  readonly #providerGeneration = providerGeneration();
  constructor(
    plan: SpendPlan,
    private readonly wallClock: () => number = () => Date.now(),
    private readonly monotonicClock: () => number = () => performance.now(),
  ) {
    // Every plan field is a scalar except the input array. Copy/freeze both
    // levels so edits to a form or source snapshot cannot mutate the review.
    this.#plan = Object.freeze({
      ...plan,
      inputs: Object.freeze(
        plan.inputs.map((coin) => Object.freeze({ ...coin })),
      ),
    }) as unknown as SpendPlan;
    this.#digest = reviewDigest(this.#plan);
    this.#wallDeadline = wallClock() + 60_000;
    this.#monotonicDeadline = monotonicClock() + 60_000;
  }
  get plan(): SpendPlan {
    return this.#plan;
  }
  get digest(): string {
    return this.#digest;
  }
  get active(): boolean {
    if (
      providerGeneration() !== this.#providerGeneration ||
      this.wallClock() >= this.#wallDeadline ||
      this.monotonicClock() >= this.#monotonicDeadline
    )
      this.invalidate();
    return this.#active;
  }
  /** UI must call on edits, navigation, wallet switch, backgrounding, or lock. */
  invalidate(): void {
    this.#active = false;
  }
  /** Call only synchronously inside VaultController.withUnlocked. No RPC. */
  sign(keys: XbtKeySession): ReturnType<typeof signReviewedPlan> {
    if (!this.active)
      throw Error("Review expired or changed; review the transaction again");
    // Consume before signing, even on failure. A retry needs a new review;
    // broadcast retries must retain the already signed identical bytes.
    this.invalidate();
    return signReviewedPlan(this.plan, this.digest, keys);
  }
}

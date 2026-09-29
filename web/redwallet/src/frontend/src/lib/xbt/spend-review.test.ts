import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { XbtKeySession } from "./key-material";
import { SpendReview } from "./spend-review";
import type { SpendPlan } from "./spend-plan";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../../test/regtest/xbt-web-signed-20260929.json"), "utf8"));
const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const plan = (): SpendPlan => structuredClone(fixture.plan);
describe("immutable one-shot XBT review", () => {
  it("signs the exact accepted fixture once and leaves subsequent retries to the signed receipt", () => {
    const keys = new XbtKeySession(phrase); const review = new SpendReview(plan());
    try {
      expect(review.sign(keys).hex).toBe(fixture.hex);
      expect(review.active).toBe(false);
      expect(() => review.sign(keys)).toThrow("review the transaction again");
    } finally { keys.destroy(); }
  });
  it("isolates review fields from later edits and freezes input records", () => {
    const original = plan(); const review = new SpendReview(original);
    original.amount = "1"; original.inputs[0]!.value = "1";
    expect(review.plan.amount).toBe(fixture.plan.amount);
    expect(review.plan.inputs[0]!.value).toBe(fixture.plan.inputs[0].value);
    expect(() => { review.plan.amount = "1"; }).toThrow();
    expect(() => { review.plan.inputs[0]!.value = "1"; }).toThrow();
  });
  it("expires despite a backwards wall-clock change and allows explicit invalidation", () => {
    let wall = 100000; let mono = 0;
    const review = new SpendReview(plan(), () => wall, () => mono);
    wall -= 99999; mono = 60000; expect(review.active).toBe(false);
    const second = new SpendReview(plan()); second.invalidate(); expect(second.active).toBe(false);
  });
  it("does not reuse a review after a locked-key signing failure", () => {
    const keys = new XbtKeySession(phrase); keys.destroy();
    const review = new SpendReview(plan());
    expect(() => review.sign(keys)).toThrow("Unlocked matching wallet");
    expect(review.active).toBe(false);
  });
});

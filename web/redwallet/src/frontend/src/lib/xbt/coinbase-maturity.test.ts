import { describe, expect, it } from "vitest";
import { coinbaseMaturity } from "./coinbase-maturity";
describe("XBT consensus and relay maturity boundaries", () => {
  it.each([
    [973439, 973439, 100],
    [973440, 973440, 6480],
    [973440, 979918, 6480],
    [973440, 979919, 100],
    [979919, 979919, 100],
    [979920, 979920, 100],
  ])("coin %i at tip %i has consensus maturity %i", (height, tip, required) => {
    expect(coinbaseMaturity(height, tip).consensusRequired).toBe(required);
    expect(coinbaseMaturity(height, tip).relayRequired).toBe(6480);
  });
  it("uses next-block height, retaining relay policy outside the consensus window", () => {
    expect(coinbaseMaturity(973440, 979918).remaining).toBe(1);
    expect(coinbaseMaturity(973440, 979919).remaining).toBe(0);
    expect(coinbaseMaturity(979919, 979920).remaining).toBe(6478);
    expect(coinbaseMaturity(972000, 973440).remaining).toBe(5039);
  });
  it.each([
    0,
    -1,
    1.2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])("rejects invalid height %s", (height) => {
    expect(() => coinbaseMaturity(height, 975000)).toThrow();
    expect(() => coinbaseMaturity(973440, height)).toThrow();
  });
});

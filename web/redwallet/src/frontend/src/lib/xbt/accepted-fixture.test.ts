import { describe, expect, it } from "vitest";
import { rebuildAcceptedTransaction, verifyRecordedTransaction } from "./accepted-fixture";
import fixture from "./fixtures/xbt-knots-regtest-acceptance.json";

describe("native Knots acceptance fixture parity", () => {
  it("reconstructs the exact two-input transaction previously accepted and mined by Knots", () => {
    const result = rebuildAcceptedTransaction();
    expect(result.hex).toBe(fixture.signed.goodHex);
    expect(result.txid).toBe(fixture.signed.expectedTxid);
    expect(result.fee).toBe(BigInt(fixture.signed.feeSats));
    expect(verifyRecordedTransaction(result.hex)).toBe(true);
  });

  it("rejects the recorded changed-output negative control", () => {
    expect(verifyRecordedTransaction(fixture.signed.negativeControls.changedOutputHex)).toBe(false);
  });

  it("rejects the recorded removed-Unified-bit negative control", () => {
    expect(verifyRecordedTransaction(fixture.signed.negativeControls.removedUnifiedBitHex)).toBe(false);
  });
});

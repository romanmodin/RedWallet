export type FeeReview = {
  feeSats: number;
  feeRate: number;
  amountSats: number;
};
export const MAX_SUGGESTED_FEE_RATE = 100;

export function capSuggestedFeeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 1) return 1;
  return Math.min(MAX_SUGGESTED_FEE_RATE, rate);
}

/** A warning requires an explicit second approval; no automatic fee rewriting. */
export function requiresHighFeeApproval({ feeSats, feeRate, amountSats }: FeeReview): boolean {
  if (![feeSats, amountSats].every(Number.isSafeInteger) || feeSats < 0 || amountSats <= 0 || !Number.isFinite(feeRate) || feeRate <= 0) {
    throw new Error('Cannot verify transaction fee and payment amount');
  }
  return feeRate > MAX_SUGGESTED_FEE_RATE || feeSats > 100_000 || feeSats > amountSats * 0.05;
}

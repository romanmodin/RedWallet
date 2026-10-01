import { ManualFiatEstimate } from "./ManualFiatEstimate";
/** Shared configured XBT quote, including simulated demo amounts. */
export function XbtAmountEstimate({ amountXbt }: { amountXbt: number }) {
  const sats = Math.round(amountXbt * 1e8);
  return Number.isFinite(amountXbt) && Number.isSafeInteger(sats) ? (
    <ManualFiatEstimate satoshis={BigInt(sats)} compact />
  ) : (
    <span>Price unavailable</span>
  );
}

/** XBT mainnet, Knots PR419 merged 2026-09-21. Consensus and relay policy
 * are deliberately separate. Wallet sends obey the stricter relay policy.
 * Source and pinned upstream revision: V041-BACKGROUND-AND-MATURITY.md
 */
export const COINBASE_RELAY_MATURITY = 6480;
export function coinbaseMaturity(height: number, tip: number) {
  if (
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Number.isSafeInteger(tip) ||
    tip < height ||
    tip >= 0x7fffffff
  )
    throw Error("Invalid coinbase height");
  const spendHeight = tip + 1;
  const confirmations = spendHeight - height;
  const consensus =
    height >= 973440 && spendHeight >= 973440 && spendHeight < 979920
      ? 6480
      : 100;
  return {
    confirmations,
    consensusRequired: consensus,
    relayRequired: COINBASE_RELAY_MATURITY,
    remaining: Math.max(0, COINBASE_RELAY_MATURITY - confirmations),
    earliestRelayBlock: height + COINBASE_RELAY_MATURITY,
  };
}
export class ImmatureCoinbaseError extends Error {
  constructor(readonly remaining: number) {
    super(
      `Mining reward is immature: ${remaining} more blocks required by the 6,480-block relay rule.`,
    );
    this.name = "ImmatureCoinbaseError";
  }
}

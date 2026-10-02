export const XBT_COINBASE_MATURITY = 6480;
const COINBASE_NULL_TXID = '0'.repeat(64);

export type TransactionInputReference = {
  txid?: string;
  vout?: number;
  coinbase?: string;
};

export function isCoinbaseTransaction(inputs: TransactionInputReference[]): boolean {
  return inputs.length === 1 && ('coinbase' in inputs[0] || (inputs[0].txid === COINBASE_NULL_TXID && inputs[0].vout === 0xffffffff));
}

export function isMatureXbtCoinbase(confirmations: number | undefined): boolean {
  return confirmations !== undefined && Number.isInteger(confirmations) && confirmations >= XBT_COINBASE_MATURITY;
}

/** Conflicting server metadata must never override an immature cached parent. */
export function verifiedCoinbaseConfirmations(utxo: number | undefined, parent: number | undefined): number {
  for (const count of [utxo, parent]) {
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
      throw new Error('Invalid XBT confirmation count; refresh wallet history');
  }
  if (utxo !== undefined && parent !== undefined && utxo !== parent) {
    throw new Error('Conflicting XBT coinbase confirmations; refresh wallet history');
  }
  // A parent without confirmation metadata cannot establish coinbase maturity.
  return parent ?? 0;
}

export const XBT_COINBASE_MATURITY = 6480;
const COINBASE_NULL_TXID = '0'.repeat(64);

export type TransactionInputReference = { txid: string; vout: number };

export function isCoinbaseTransaction(inputs: TransactionInputReference[]): boolean {
  return inputs.length === 1 && inputs[0].txid === COINBASE_NULL_TXID && inputs[0].vout === 0xffffffff;
}

export function isMatureXbtCoinbase(confirmations: number | undefined): boolean {
  return confirmations !== undefined && Number.isInteger(confirmations) && confirmations >= XBT_COINBASE_MATURITY;
}

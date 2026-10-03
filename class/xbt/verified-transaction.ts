import { Transaction } from 'bitcoinjs-lib';

/** Hash the raw parent locally; never classify coinbase or prevouts from server JSON. */
export function parseVerifiedParentTransaction(txid: string, raw: string): Transaction {
  const transaction = Transaction.fromHex(raw);
  if (transaction.getId() !== txid) throw new Error('Electrum returned a raw transaction that does not match the requested txid');
  return transaction;
}

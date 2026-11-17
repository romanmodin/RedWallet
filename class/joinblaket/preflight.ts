import { address, networks } from 'bitcoinjs-lib';
import { sats } from './fees';

export type ProofCoin = Readonly<{ txid: string; vout: number; value: number; height: number; frozen: boolean; reserved: boolean }>;
export type PaymentRequest = Readonly<{
  chain: 'xbt' | 'btc';
  recipients: readonly { address: string; amount: number }[];
  watchOnly: boolean;
}>;

// This is only local preflight. A positive result is NOT an SPV proof, a PoDLE
// proof, a reservation or authorization to reveal inputs/sign/broadcast.
export function validatePayment(request: PaymentRequest): { address: string; amount: number } {
  if (request.chain !== 'xbt' || request.watchOnly !== false || request.recipients.length !== 1)
    throw new Error('JoinBlaket requires one hot XBT payment');
  const recipient = request.recipients[0];
  if (sats(recipient.amount) === 0) throw new Error('Payment amount must be positive');
  const script = address.toOutputScript(recipient.address, networks.bitcoin);
  if (script.length !== 22 || script[0] !== 0 || script[1] !== 20) throw new Error('JoinBlaket requires a native SegWit recipient');
  return { ...recipient };
}
export function proofThreshold(amount: number): number {
  return Math.ceil(sats(amount) / 5);
}
export function eligibleProofCoins(coins: readonly ProofCoin[], amount: number, tip: number): ProofCoin[] {
  if (!Number.isSafeInteger(tip) || tip <= 0 || sats(amount) === 0) throw new Error('Invalid amount or chain height');
  const seen = new Set<string>();
  return coins.filter(coin => {
    sats(coin.value);
    if (
      !/^[0-9a-f]{64}$/i.test(coin.txid) ||
      !Number.isInteger(coin.vout) ||
      coin.vout < 0 ||
      coin.vout > 0xffffffff ||
      !Number.isSafeInteger(coin.height) ||
      coin.height < 0 ||
      coin.height > tip ||
      typeof coin.frozen !== 'boolean' ||
      typeof coin.reserved !== 'boolean'
    )
      throw new Error('Invalid proof coin');
    const key = coin.txid.toLowerCase() + ':' + coin.vout;
    if (seen.has(key)) throw new Error('Duplicate proof coin');
    seen.add(key);
    return !coin.frozen && !coin.reserved && coin.height > 0 && tip - coin.height + 1 >= 5 && coin.value >= proofThreshold(amount);
  });
}

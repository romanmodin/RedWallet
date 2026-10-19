import * as bitcoin from 'bitcoinjs-lib';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { parseVerifiedParentTransaction } from './verified-transaction';

// Leave one slot for the child. These are wallet safety bounds, not promises
// about a server's policy (descendant limits and minimum relay fees may differ).
export const CPFP_LIMITS = {
  ancestors: 24,
  transactions: 128,
  bytes: 2_000_000,
  vsize: 101_000,
  timeoutMs: 20_000,
};
type Reader = (txid: string) => Promise<unknown>;
type Entry = { transaction: bitcoin.Transaction; confirmations: number };
export type CpfpAncestor = { txid: string; fee: number; vsize: number };

export async function collectCpfpPackage(txid: string, read: Reader = BlueElectrum.createCpfpTransactionReader()) {
  const entries = new Map<string, Entry>();
  const ancestors: CpfpAncestor[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const spent = new Set<string>();
  const deadline = Date.now() + CPFP_LIMITS.timeoutMs;
  let bytes = 0;
  let vsize = 0;

  async function load(id: string): Promise<Entry> {
    const cached = entries.get(id);
    if (cached) return cached;
    if (entries.size >= CPFP_LIMITS.transactions) throw new Error('CPFP transaction lookup limit exceeded');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('CPFP ancestor lookup timed out');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let data: any;
    try {
      data = await Promise.race([
        read(id),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('CPFP ancestor lookup timed out')), remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    // Core omits confirmations for mempool transactions. A raw-only fallback,
    // missing result, or inconsistent block status cannot establish a boundary.
    if (
      !data ||
      data.txid !== id ||
      typeof data.hex !== 'string' ||
      !/^(?:[0-9a-fA-F]{2})+$/.test(data.hex) ||
      data.hex.length > 800_000 ||
      (data.confirmations !== undefined && (!Number.isSafeInteger(data.confirmations) || data.confirmations < 0)) ||
      (data.blockhash && !(data.confirmations > 0))
    )
      throw new Error('Cannot verify CPFP ancestor data');
    bytes += data.hex.length / 2;
    if (bytes > CPFP_LIMITS.bytes) throw new Error('CPFP transaction data limit exceeded');
    const entry = {
      transaction: parseVerifiedParentTransaction(id, data.hex),
      confirmations: data.confirmations ?? 0,
    };
    entries.set(id, entry);
    return entry;
  }

  async function visit(id: string): Promise<void> {
    if (visiting.has(id)) throw new Error('Cyclic CPFP ancestry');
    if (visited.has(id)) return;
    const entry = await load(id);
    if (entry.confirmations > 0) {
      visited.add(id);
      return;
    }
    if (ancestors.length + visiting.size >= CPFP_LIMITS.ancestors) throw new Error('CPFP ancestor count limit exceeded');
    const transaction = entry.transaction;
    if (transaction.isCoinbase() || transaction.ins.length === 0 || transaction.outs.length === 0) {
      throw new Error('Invalid unconfirmed CPFP ancestor');
    }
    visiting.add(id);
    vsize += transaction.virtualSize();
    if (vsize >= CPFP_LIMITS.vsize) throw new Error('CPFP package size limit exceeded');
    let inputValue = 0n;
    for (const input of transaction.ins) {
      const parentId = Buffer.from(input.hash).reverse().toString('hex');
      const outpoint = parentId + ':' + input.index;
      if (spent.has(outpoint)) throw new Error('Conflicting CPFP ancestor inputs');
      spent.add(outpoint);
      const parent = await load(parentId);
      const output = parent.transaction.outs[input.index];
      if (!output) throw new Error('Missing CPFP ancestor output');
      inputValue += output.value;
      await visit(parentId);
    }
    const fee = inputValue - transaction.outs.reduce((sum, output) => sum + output.value, 0n);
    if (fee < 0n || fee > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid CPFP ancestor fee');
    ancestors.push({
      txid: id,
      fee: Number(fee),
      vsize: transaction.virtualSize(),
    });
    visiting.delete(id);
    visited.add(id);
  }

  await visit(txid);
  const parent = entries.get(txid)!;
  if (parent.confirmations !== 0) throw new Error('Parent is already confirmed');
  return { transaction: parent.transaction, ancestors, vsize };
}

/**
 * Pay each unique ancestor's shortfall without using another ancestor's surplus.
 * A high-fee ancestor can mine independently, so its surplus is not reliable
 * funding for the remaining chain. This conservative bound can overpay compared
 * with a miner's full mempool analysis; the existing fee review shows the total.
 */
export function cpfpChildFee(ancestors: CpfpAncestor[], childVsize: number, feeRate: number): number {
  if (!Number.isFinite(feeRate) || feeRate <= 0 || !Number.isSafeInteger(childVsize) || childVsize <= 0) {
    throw new Error('Invalid CPFP package fee rate or size');
  }
  if (ancestors.reduce((sum, ancestor) => sum + ancestor.vsize, childVsize) > CPFP_LIMITS.vsize) {
    throw new Error('CPFP package size limit exceeded');
  }
  const fee = ancestors.reduce(
    (sum, ancestor) => sum + Math.max(0, Math.ceil(ancestor.vsize * feeRate) - ancestor.fee),
    Math.ceil(childVsize * Math.max(1, feeRate)),
  );
  if (!Number.isSafeInteger(fee)) throw new Error('CPFP fee exceeds safe amount');
  return fee;
}

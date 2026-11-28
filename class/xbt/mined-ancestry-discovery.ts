import { script } from 'bitcoinjs-lib';
import { XBT_MAINNET_CHECKPOINT_HEIGHT } from './electrum-checkpoint';
import { parseVerifiedParentTransaction } from './verified-transaction';

type Point = { txid: string; vout: number };
type Step = Point & { child?: Step };

// Candidates only. The caller must independently prove inclusion, maturity and
// chain exclusivity for the exact selected outpoint before authorizing a send.
// The raw reader is scoped to the XBT wallet's own history source.
export async function* discoverMinedAncestry(
  selected: Point,
  readRaw: (ids: string[]) => Promise<Record<string, string>>,
  assertCurrent: () => void,
): AsyncGenerator<{ height: number; path: string[] }> {
  if (!/^[0-9a-f]{64}$/.test(selected.txid) || !Number.isSafeInteger(selected.vout) || selected.vout < 0 || selected.vout > 0xffffffff)
    throw new Error('Invalid selected outpoint');

  let frontier: Step[] = [{ ...selected }];
  const seen = new Set([selected.txid]);
  const raws = new Map<string, string>();
  let chars = 0;
  for (let depth = 1; frontier.length && depth <= 64; depth++) {
    assertCurrent();
    const response = await readRaw(frontier.map(step => step.txid));
    assertCurrent();
    const next: Step[] = [];
    for (const step of frontier) {
      assertCurrent();
      const raw = response[step.txid];
      // Electrum may omit an unavailable parent in a batch. Only fully linked
      // paths can yield a candidate, so other parents can still be searched.
      if (step.child && raw === undefined) continue;
      if (typeof raw !== 'string' || !raw.length || raw.length > 2_000_000 || chars + raw.length > 16_000_000)
        throw new Error('Missing or oversized XBT ancestry');
      if (raw.length % 2 || /[^a-f0-9]/i.test(raw)) throw new Error('Malformed XBT ancestry');
      chars += raw.length;
      const tx = parseVerifiedParentTransaction(step.txid, raw);
      if (!tx.outs[step.vout]) throw new Error('Missing XBT ancestry output');
      raws.set(step.txid, raw);
      if (tx.isCoinbase()) {
        const input = tx.ins[0];
        const bytes = Buffer.from(input.script);
        const size = bytes[0];
        if (input.index !== 0xffffffff || size < 3 || size > 4 || bytes.length < size + 1) continue;
        let height: number;
        try {
          height = script.number.decode(bytes.subarray(1, size + 1), 4, true);
        } catch {
          continue;
        }
        if (height < XBT_MAINNET_CHECKPOINT_HEIGHT) continue;
        const path: string[] = [];
        for (let cursor: Step | undefined = step; cursor; cursor = cursor.child) path.push(raws.get(cursor.txid)!);
        yield { height, path: path.reverse() };
        continue;
      }
      if (depth === 64) continue;
      for (const input of tx.ins) {
        const txid = Buffer.from(input.hash).reverse().toString('hex');
        if (seen.has(txid)) continue;
        if (seen.size >= 256) throw new Error('XBT ancestry search limit reached');
        seen.add(txid);
        next.push({ txid, vout: input.index, child: step });
      }
    }
    frontier = next;
  }
}

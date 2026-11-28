import { XBT_MAINNET_CHECKPOINT_HEIGHT } from './electrum-checkpoint';
import { xbtV2BlockHash } from './block-header-hash';

type Read = (method: 'blockchain.block.headers' | 'blockchain.transaction.get_merkle', params: (number | string)[]) => Promise<unknown>;

function invalid(): never {
  throw new Error('XBT mining evidence is unavailable or inconsistent');
}

// Transport supplies evidence only. A caller must separately authenticate the tip
// and pass these headers and branches through verifyPublicMinedSeparation.
export async function collectMinedXbtEvidence(
  reward: { txid: string; height: number },
  selected: { txid: string; height: number },
  tipHeight: number,
  read: Read,
  assertCurrent: () => void,
) {
  const first = reward.height - 11;
  if (
    ![reward, selected].every(
      (p) => typeof p.txid === 'string' && p.txid.length === 64 && /^[0-9a-f]+$/.test(p.txid) && Number.isSafeInteger(p.height),
    ) ||
    reward.height < XBT_MAINNET_CHECKPOINT_HEIGHT ||
    !Number.isSafeInteger(tipHeight) ||
    tipHeight > 0x7fffffff ||
    selected.height < reward.height ||
    selected.height > tipHeight ||
    tipHeight - first + 1 > 48000
  )
    return invalid();
  const direct = selected.txid === reward.txid;
  if (direct !== (selected.height === reward.height)) return invalid();

  const deadline = performance.now() + 45000;
  const request = async (method: Parameters<Read>[0], params: Parameters<Read>[1]) => {
    assertCurrent();
    const now = performance.now();
    if (now >= deadline) return invalid();
    const stopAt = Math.min(deadline, now + 8000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('XBT evidence request timed out')), Math.max(0, stopAt - performance.now()));
      });
      const value = await Promise.race([read(method, params), timeout]);
      if (!value || typeof value !== 'object' || performance.now() >= stopAt) return invalid();
      return value as Record<string, unknown>;
    } catch {
      return invalid();
    } finally {
      clearTimeout(timer);
      assertCurrent();
    }
  };
  const branch = async (point: typeof reward, coinbase: boolean) => {
    const reply = await request('blockchain.transaction.get_merkle', [point.txid, point.height]);
    const position = reply.pos;
    if (
      reply.block_height !== point.height ||
      typeof position !== 'number' ||
      !Number.isSafeInteger(position) ||
      (coinbase ? position !== 0 : position <= 0) ||
      !Array.isArray(reply.merkle) ||
      reply.merkle.length > 16 ||
      !reply.merkle.every((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h))
    )
      return invalid();
    return {
      height: point.height,
      position,
      merkle: [...reply.merkle] as string[],
    };
  };
  const { merkle } = await branch(reward, true);
  const selectedInclusion = direct ? undefined : await branch(selected, false);
  const headers: string[] = [];
  let pages = 0;
  while (first + headers.length <= tipHeight) {
    const start = first + headers.length;
    const legacy = start < XBT_MAINNET_CHECKPOINT_HEIGHT;
    const last = legacy ? XBT_MAINNET_CHECKPOINT_HEIGHT - 1 : tipHeight;
    const count = Math.min(256, last - start + 1);
    if (++pages > 512) return invalid();
    // The packaged client's batch helper misspells the method on the wire.
    const page = await request('blockchain.block.headers', [start, count]);
    const width = legacy ? 160 : 328;
    const n = page.count;
    const hex = page.hex;
    if (
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > count ||
      typeof hex !== 'string' ||
      hex.length !== n * width ||
      /[^0-9a-f]/i.test(hex)
    )
      return invalid();
    for (let i = 0; i < n; i++) headers.push(hex.slice(i * width, (i + 1) * width));
  }
  const header = headers[11];
  return {
    anchor: {
      header,
      blockHash: xbtV2BlockHash(Buffer.from(header, 'hex')),
      parentHeaders: headers.slice(0, 11).reverse(),
    },
    descendants: headers.slice(12),
    merkle,
    selectedInclusion,
  };
}

import * as bitcoin from 'bitcoinjs-lib';
import { collectCpfpPackage, cpfpChildFee, CPFP_LIMITS } from '../../class/xbt/cpfp-package';

jest.mock('../../blue_modules/BlueElectrum', () => ({}));
const script = Buffer.from('0014' + '11'.repeat(20), 'hex');
function tx(inputs: { tx: bitcoin.Transaction; index?: number }[], outputs: bigint[]) {
  const result = new bitcoin.Transaction();
  if (!inputs.length) result.addInput(Buffer.alloc(32, 1), 0);
  for (const input of inputs) result.addInput(Buffer.from(input.tx.getId(), 'hex').reverse(), input.index ?? 0);
  outputs.forEach(value => result.addOutput(script, value));
  return result;
}
function graph() {
  const funding = tx([], [100_000n]);
  const grandparent = tx([{ tx: funding }], [49_900n, 49_900n]);
  const left = tx([{ tx: grandparent }], [49_700n]);
  const right = tx([{ tx: grandparent, index: 1 }], [49_600n]);
  const parent = tx([{ tx: left }, { tx: right }], [99_000n]);
  const entries = new Map(
    [funding, grandparent, left, right, parent].map(transaction => [
      transaction.getId(),
      {
        txid: transaction.getId(),
        hex: transaction.toHex(),
        confirmations: transaction === funding ? 10 : 0,
      } as any,
    ]),
  );
  const read = jest.fn(async (id: string) => entries.get(id));
  return { funding, grandparent, left, right, parent, entries, read };
}

it('deduplicates shared ancestry, authenticates raw fees and stops at confirmed transactions', async () => {
  const { parent, funding, grandparent, read } = graph();
  const result = await collectCpfpPackage(parent.getId(), read);
  expect(result.ancestors).toHaveLength(4);
  expect(result.ancestors.reduce((sum, entry) => sum + entry.fee, 0)).toBe(1000);
  expect(result.ancestors.filter(entry => entry.txid === grandparent.getId())).toHaveLength(1);
  expect(result.ancestors.some(entry => entry.txid === funding.getId())).toBe(false);
  expect(read).toHaveBeenCalledTimes(5);
  expect(cpfpChildFee(result.ancestors, 110, 10)).toBe(
    1100 + result.ancestors.reduce((sum, entry) => sum + Math.max(0, entry.vsize * 10 - entry.fee), 0),
  );
});

it('does not rely on surplus fees from an ancestor that could confirm separately', () => {
  const entries = [
    { txid: 'high', fee: 10_000, vsize: 100 },
    { txid: 'low', fee: 100, vsize: 100 },
  ];
  expect(cpfpChildFee(entries, 100, 10)).toBe(1900);
  // Both the entire graph and any remaining subset meet the target.
  expect((1900 + 100) / 200).toBe(10);
});

it.each(['missing', 'raw-only', 'wrong-hash', 'negative-status', 'block-without-status', 'negative-fee', 'bad-prevout'])(
  'rejects %s ancestry without producing a fee quote',
  async mutation => {
    const { parent, left, funding, entries, read } = graph();
    const entry = entries.get(left.getId());
    if (mutation === 'missing') entries.delete(left.getId());
    if (mutation === 'raw-only') entries.set(left.getId(), entry.hex);
    if (mutation === 'wrong-hash') entry.hex = funding.toHex();
    if (mutation === 'negative-status') entry.confirmations = -1;
    if (mutation === 'block-without-status') {
      delete entry.confirmations;
      entry.blockhash = 'ab'.repeat(32);
    }
    if (mutation === 'negative-fee' || mutation === 'bad-prevout') {
      const invalid = tx([{ tx: funding, index: mutation === 'bad-prevout' ? 5 : 0 }], [100_001n]);
      entries.set(invalid.getId(), {
        txid: invalid.getId(),
        hex: invalid.toHex(),
        confirmations: 0,
      });
      await expect(collectCpfpPackage(invalid.getId(), read)).rejects.toThrow();
    } else {
      await expect(collectCpfpPackage(parent.getId(), read)).rejects.toThrow();
    }
  },
);

it('rejects conflicting branches spending the same output', async () => {
  const { left, grandparent, entries, read } = graph();
  const conflict = tx([{ tx: grandparent }], [49_500n]);
  const parent = tx([{ tx: left }, { tx: conflict }], [99_000n]);
  for (const transaction of [conflict, parent])
    entries.set(transaction.getId(), {
      txid: transaction.getId(),
      hex: transaction.toHex(),
      confirmations: 0,
    });
  await expect(collectCpfpPackage(parent.getId(), read)).rejects.toThrow('Conflicting');
});

it('accepts omitted mempool confirmations but rejects a confirmed root', async () => {
  const { parent, entries, read } = graph();
  delete entries.get(parent.getId()).confirmations;
  await expect(collectCpfpPackage(parent.getId(), read)).resolves.toBeDefined();
  entries.get(parent.getId()).confirmations = 1;
  await expect(collectCpfpPackage(parent.getId(), read)).rejects.toThrow('already confirmed');
});

it('allows 24 ancestors plus a child and refuses a 25th ancestor', async () => {
  const funding = tx([], [100_000n]);
  const entries = new Map<string, any>([[funding.getId(), { txid: funding.getId(), hex: funding.toHex(), confirmations: 10 }]]);
  let parent = funding;
  const read = jest.fn(async (id: string) => entries.get(id));
  for (let i = 1; i <= 25; i++) {
    parent = tx([{ tx: parent }], [100_000n - BigInt(i * 100)]);
    entries.set(parent.getId(), {
      txid: parent.getId(),
      hex: parent.toHex(),
      confirmations: 0,
    });
    if (i === 24) expect((await collectCpfpPackage(parent.getId(), read)).ancestors).toHaveLength(24);
  }
  await expect(collectCpfpPackage(parent.getId(), read)).rejects.toThrow('count limit');
});

it('bounds lookup time and propagates server failures', async () => {
  const { parent } = graph();
  await expect(
    collectCpfpPackage(parent.getId(), async () => {
      throw new Error('server unavailable');
    }),
  ).rejects.toThrow('server unavailable');
  jest.useFakeTimers();
  try {
    const pending = collectCpfpPackage(parent.getId(), () => new Promise(() => {})).catch(error => error);
    await jest.advanceTimersByTimeAsync(CPFP_LIMITS.timeoutMs);
    expect(await pending).toMatchObject({ message: 'CPFP ancestor lookup timed out' });
  } finally {
    jest.useRealTimers();
  }
});

it('rejects unsafe rates and oversized packages and rounds fractional rates up', () => {
  for (const rate of [NaN, Infinity, 0, -1, Number.MAX_VALUE]) expect(() => cpfpChildFee([], 100, rate)).toThrow();
  expect(() => cpfpChildFee([{ txid: 'large', fee: 0, vsize: 101_000 }], 100, 1)).toThrow('size limit');
  expect(cpfpChildFee([{ txid: 'fractional', fee: 100, vsize: 101 }], 101, 1.1)).toBe(124);
});

import { Transaction } from 'bitcoinjs-lib';
import { discoverMinedAncestry } from '../../class/xbt/mined-ancestry-discovery';
import { fixture } from '../helpers/mined-ancestry-fixture';

test('discovery checks the exact output and hashes the transaction supplied by the history reader', async () => {
  const f = fixture();
  const lookup = async () => ({ [f.selected.txid]: f.spend.toHex() });
  const discover = (vout: number, read = lookup) => discoverMinedAncestry({ ...f.selected, vout }, read, () => {}).next();
  await expect(discover(1)).rejects.toThrow('output');
  await expect(discover(0, async () => ({ [f.selected.txid]: f.mined.toHex() }))).rejects.toThrow('txid');
  await expect(discover(0, async () => ({ [f.selected.txid]: f.spend.toHex() + 'e' }))).rejects.toThrow('Malformed');
});

test('canceling while raw history is being read yields no candidate', async () => {
  const f = fixture();
  let active = true;
  const read = jest.fn(async () => {
    active = false;
    return { [f.mined.getId()]: f.mined.toHex() };
  });
  const candidates = discoverMinedAncestry({ txid: f.mined.getId(), vout: 0 }, read, () => {
    if (!active) throw new Error('canceled');
  });
  await expect(candidates.next()).rejects.toThrow('canceled');
  expect(read).toHaveBeenCalledTimes(1);
});

test('oversized fanout stops before querying any of its parents', async () => {
  const tx = new Transaction();
  for (let i = 0; i < 256; i++) {
    const hash = Buffer.alloc(32);
    hash.writeUInt32LE(i + 1);
    tx.addInput(hash, 0);
  }
  tx.addOutput(Buffer.from([0x51]), 100n);
  const read = jest.fn(async () => ({ [tx.getId()]: tx.toHex() }));
  const candidates = discoverMinedAncestry({ txid: tx.getId(), vout: 0 }, read, () => {});
  await expect(candidates.next()).rejects.toThrow('limit');
  expect(read).toHaveBeenCalledTimes(1);
});

test('an omitted sibling does not hide an independently provable mining path', async () => {
  const f = fixture(975000, true);
  const available: Record<string, string> = { [f.selected.txid]: f.spend.toHex(), [f.mined.getId()]: f.mined.toHex() };
  // A partial Electrum batch contains only transactions available from the history source.
  const read = async (ids: string[]) => Object.fromEntries(ids.filter(id => id in available).map(id => [id, available[id]]));
  const candidates = discoverMinedAncestry(f.selected, read, () => {});
  await expect(candidates.next()).resolves.toEqual({ done: false, value: { height: 975000, path: f.path } });
  await expect(candidates.next()).resolves.toMatchObject({ done: true });
  delete available[f.mined.getId()];
  await expect(discoverMinedAncestry(f.selected, read, () => {}).next()).resolves.toMatchObject({ done: true });
  delete available[f.selected.txid];
  await expect(discoverMinedAncestry(f.selected, read, () => {}).next()).rejects.toThrow(/missing/i);
});

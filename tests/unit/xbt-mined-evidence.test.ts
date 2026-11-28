import * as net from 'node:net';
import { createServer, type AddressInfo } from 'node:net';
import { createInterface } from 'node:readline';
import { collectMinedXbtEvidence } from '../../class/xbt/mined-ancestry-evidence';
import { linkParents } from '../helpers/mined-ancestry-fixture';

const ElectrumClient = require('electrum-client');

const reward = { txid: '01'.repeat(32), height: 961645 };
const proof = { block_height: reward.height, pos: 0, merkle: [] };
const active = () => {};
const collect = (read: Parameters<typeof collectMinedXbtEvidence>[3], assertCurrent = active) =>
  collectMinedXbtEvidence(reward, reward, reward.height, read, assertCurrent);

test('reads mixed-format headers across the fork with the packaged Electrum client on loopback', async () => {
  const header = Buffer.alloc(164);
  header.writeUInt32LE(0x80000000);
  header.writeInt32LE(reward.height, 128);
  const parents = linkParents(header, 1819756800);
  const blocks = [...parents].reverse().concat(header.toString('hex'));
  const calls: unknown[] = [];
  const host = '127.0.0.1';
  const server = createServer((socket) => {
    createInterface({ input: socket }).on('line', (line) => {
      const { id, method, params } = JSON.parse(line);
      calls.push([method, params]);
      let result: unknown;
      if (method === 'blockchain.transaction.get_merkle') result = proof;
      else if (method === 'blockchain.block.headers') {
        const [start, count] = params;
        const i = start - reward.height + 11;
        result = { count, hex: blocks.slice(i, i + count).join('') };
      }
      socket.write(JSON.stringify(result ? { id, result } : { id, error: { code: -32601, message: 'Unknown method' } }) + '\n');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const client = new ElectrumClient(net, null, (server.address() as AddressInfo).port, host, 'tcp');
  try {
    await client.connect();
    const evidence = await collect((method, params) => client.request(method, params));
    expect(calls).toEqual([
      ['blockchain.transaction.get_merkle', [reward.txid, reward.height]],
      ['blockchain.block.headers', [961634, 6]],
      ['blockchain.block.headers', [961640, 6]],
    ]);
    expect(evidence.anchor.parentHeaders).toEqual(parents);
    expect(evidence.selectedInclusion).toBeUndefined();
  } finally {
    client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test.each([
  { count: 0, hex: '' },
  { count: 1, hex: '00' },
  { count: 1, hex: '00'.repeat(164) },
  { count: 1, hex: 'GG'.repeat(80) },
  { count: 7, hex: '00'.repeat(7 * 80) },
])('rejects malformed header page %# before further requests', async (page) => {
  const read = jest.fn().mockResolvedValueOnce(proof).mockResolvedValueOnce(page);
  await expect(collect(read)).rejects.toThrow('evidence');
  expect(read).toHaveBeenCalledTimes(2);
});
test.each([
  { ...proof, block_height: reward.height + 1 },
  { ...proof, pos: 1 },
  { ...proof, merkle: ['abc'] },
])('rejects a mismatched reward proof %# before requesting headers', async (wrong) => {
  const read = jest.fn().mockResolvedValue(wrong);
  await expect(collect(read)).rejects.toThrow('evidence');
  expect(read).toHaveBeenCalledTimes(1);
});
test('a session change during a read prevents further requests', async () => {
  let current = true;
  const read = jest.fn(async () => {
    current = false;
    return proof;
  });
  await expect(
    collect(read, () => {
      if (!current) throw new Error('session changed');
    }),
  ).rejects.toThrow('session changed');
  expect(read).toHaveBeenCalledTimes(1);
});
test('a stalled read times out without requesting more evidence', async () => {
  jest.useFakeTimers();
  try {
    const read = jest.fn(() => new Promise<never>(() => {}));
    const check = expect(collect(read)).rejects.toThrow('evidence');
    await jest.advanceTimersByTimeAsync(8001);
    await check;
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

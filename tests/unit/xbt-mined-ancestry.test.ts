import { xbtV2BlockHash } from '../../class/xbt/block-header-hash';
import { Transaction, crypto, script } from 'bitcoinjs-lib';
import { verifyMinedAncestry, verifyXbtRewardForSpend } from '../../class/xbt/separation-proof';
import { verifyPublicMinedSeparation } from '../../class/xbt/separation-service';

function reward(tag: number, height = 975000) {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from(script.compile([script.number.encode(height), Buffer.alloc(8, tag)])));
  tx.addOutput(Buffer.from([0x51]), 100000n);
  return tx;
}

function fixture() {
  const mined = reward(1);
  const canonical = reward(2);
  const spend = new Transaction();
  spend.addInput(mined.getHash(), 0);
  spend.addOutput(Buffer.from([0x51]), 90000n);
  const header = Buffer.alloc(80);
  const sibling = Buffer.alloc(32, 9);
  const root = crypto.hash256(Buffer.concat([canonical.getHash(), sibling]));
  header.set(root, 36);
  const anchor = {
    height: 975000,
    tipHeight: 975005,
    blockHash: Buffer.from(crypto.hash256(header)).reverse().toString('hex'),
    txCount: 2,
  };
  const proof = { rawTransaction: canonical.toHex(), position: 0, merkle: [sibling.toString('hex')], header: header.toString('hex') };
  const selected = { txid: spend.getId(), vout: 0 };
  const path = [spend.toHex(), mined.toHex()];
  return { selected, path, mined, canonical, spend, proof, anchor };
}

test('verifies a reward descendant against a different position-zero SHA-256 reward', () => {
  const f = fixture();
  expect(() => verifyMinedAncestry(f.selected, f.path, f.proof, f.anchor)).not.toThrow();
});

test('refuses the same reward and invalid spend edges', () => {
  const f = fixture();
  expect(() => verifyMinedAncestry({ txid: f.canonical.getId(), vout: 0 }, [f.canonical.toHex()], f.proof, f.anchor)).toThrow();
  expect(() => verifyMinedAncestry(f.selected, [f.spend.toHex(), reward(3).toHex()], f.proof, f.anchor)).toThrow();
  expect(() => verifyMinedAncestry({ ...f.selected, vout: 1 }, f.path, f.proof, f.anchor)).toThrow();
  f.spend.ins[0].index = 1;
  expect(() => verifyMinedAncestry({ txid: f.spend.getId(), vout: 0 }, [f.spend.toHex(), f.mined.toHex()], f.proof, f.anchor)).toThrow();
});

test('refuses a stale or replaced anchor, wrong height, position or branch', () => {
  const { selected, path, proof, anchor } = fixture();
  for (const changed of [
    { ...anchor, tipHeight: 975004 },
    { ...anchor, blockHash: '00'.repeat(32) },
    { ...anchor, height: 974999 },
  ])
    expect(() => verifyMinedAncestry(selected, path, proof, changed)).toThrow();
  for (const changed of [
    { ...proof, position: 1 },
    { ...proof, merkle: ['00'.repeat(32)] },
  ])
    expect(() => verifyMinedAncestry(selected, path, changed, anchor)).toThrow();
});

test('a fresh proof after a reorg fails if the replacement block includes the same reward', () => {
  const f = fixture();
  verifyMinedAncestry(f.selected, f.path, f.proof, f.anchor);
  const replacement = Buffer.alloc(80);
  replacement.set(f.mined.getHash(), 36);
  const anchor = { ...f.anchor, blockHash: Buffer.from(crypto.hash256(replacement)).reverse().toString('hex'), txCount: 1 };
  const proof = { rawTransaction: f.mined.toHex(), header: replacement.toString('hex'), merkle: [], position: 0 };
  expect(() => verifyMinedAncestry(f.selected, f.path, proof, anchor)).toThrow();
  expect(() => verifyMinedAncestry(f.selected, f.path, f.proof, anchor)).toThrow();
});

test.each(['valid', 'replaced at final check', 'metadata disagreement'] as const)(
  'collects only public SHA-256 reward evidence: %s',
  async scenario => {
    const f = fixture();
    const { height, blockHash, tipHeight } = f.anchor;
    const now = 2000000000;
    const tipHeader = Buffer.alloc(80);
    tipHeader.writeUInt32LE(now - 600, 68);
    const tipHash = Buffer.from(crypto.hash256(tipHeader)).reverse().toString('hex');
    const calls: string[] = [];
    let rewardAnchorReads = 0;
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async input => {
      const url = String(input);
      calls.push(url);
      let body: string;
      if (url.endsWith('/block-height/961640')) body = '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00';
      else if (url.endsWith('/blocks/tip/height')) body = String(tipHeight);
      else if (url.endsWith('/block-height/' + tipHeight)) body = tipHash;
      else if (url.endsWith('/block/' + tipHash + '/header')) body = tipHeader.toString('hex');
      else if (url.endsWith('/block-height/' + height)) {
        rewardAnchorReads++;
        body = scenario === 'replaced at final check' && rewardAnchorReads > 2 ? '00'.repeat(32) : blockHash;
      } else if (url.endsWith('/block/' + blockHash + '/txid/0')) body = f.canonical.getId();
      else if (url.endsWith('/block/' + blockHash + '/header')) body = f.proof.header;
      else if (url.endsWith('/block/' + blockHash))
        body = JSON.stringify({
          id: blockHash,
          height,
          tx_count: scenario === 'metadata disagreement' && url.includes('mempool.space') ? 3 : 2,
        });
      else if (url.endsWith('/tx/' + f.canonical.getId() + '/hex')) body = f.proof.rawTransaction;
      else if (url.endsWith('/tx/' + f.canonical.getId() + '/merkle-proof'))
        body = JSON.stringify({ block_height: height, pos: 0, merkle: f.proof.merkle });
      else throw new Error('Unexpected evidence request');
      return {
        ok: true,
        url,
        headers: { get: (name: string) => (name.toLowerCase() === 'date' ? new Date(now * 1000).toUTCString() : null) },
        text: async () => body,
      } as Response;
    });
    try {
      const result = verifyPublicMinedSeparation(f.selected, f.path, height, () => {});
      if (scenario === 'valid') {
        await expect(result).resolves.toBeUndefined();
        expect(rewardAnchorReads).toBe(4);
      } else await expect(result).rejects.toThrow('separation');
      expect(calls.some(url => url.includes(f.selected.txid) || url.includes(f.mined.getId()))).toBe(false);
    } finally {
      fetch.mockRestore();
    }
  },
);

function linkParents(rewardHeader: Buffer, median: number) {
  const parents: string[] = [];
  let previous = Buffer.alloc(32);
  for (let i = 11; i > 0; i--) {
    const parent = Buffer.alloc(164);
    parent.writeUInt32LE(0x80000000, 0);
    parent.writeInt32LE(rewardHeader.readInt32LE(128) - i, 128);
    parent.writeUInt32LE(median + i - 6 - 120, 68);
    parent[110] = 4;
    parent.writeUInt32LE(120, 104);
    parent.set(previous, 4);
    previous = Buffer.from(xbtV2BlockHash(parent), 'hex').reverse();
    parents.unshift(parent.toString('hex'));
  }
  rewardHeader.set(previous, 4);
  return parents;
}

test.each([
  [979918, 1819756799, 6480],
  [979919, 1819756799, 25920],
  [999999, 1819756800, 100],
])('checks the exact maturity boundary for reward height %i, parent MTP %i', (height, parentMedianTimePast, depth) => {
  const coin = reward(4, height);
  const header = Buffer.alloc(164);
  header.writeUInt32LE(0x80000000, 0);
  header.writeUInt16LE(1, 108);
  header.writeInt32LE(height, 128);
  header.set(coin.getHash(), 36);
  const parentHeaders = linkParents(header, parentMedianTimePast);
  const anchor = { blockHash: xbtV2BlockHash(header), header: header.toString('hex'), parentHeaders, tipHeight: height + depth - 1 };
  expect(() => verifyXbtRewardForSpend(coin, [], anchor)).not.toThrow();
  expect(() => verifyXbtRewardForSpend(coin, [], { ...anchor, tipHeight: anchor.tipHeight - 1 })).toThrow('immature');
  expect(() => verifyXbtRewardForSpend(reward(5, height), [], anchor)).toThrow();
  expect(() => verifyXbtRewardForSpend(coin, ['00'.repeat(32)], anchor)).toThrow();
});

test('binds an XBT reward to the first transaction of the anchored v2 block', () => {
  const coin = reward(7);
  const sibling = Buffer.from('01' + '00'.repeat(31), 'hex');
  const header = Buffer.alloc(164);
  header.writeUInt32LE(0x80000000, 0);
  header.writeUInt16LE(2, 108);
  header.writeInt32LE(975000, 128);
  header.set(crypto.hash256(Buffer.concat([coin.getHash(), sibling])), 36);
  const branch = [Buffer.from(sibling).reverse().toString('hex')];
  const parentHeaders = linkParents(header, 1790000000);
  const anchor = { blockHash: xbtV2BlockHash(header), header: header.toString('hex'), tipHeight: 990000, parentHeaders };
  expect(() => verifyXbtRewardForSpend(coin, branch, anchor)).not.toThrow();
  expect(() => verifyXbtRewardForSpend(coin, branch, { ...anchor, parentHeaders: [...parentHeaders].reverse() })).toThrow('Invalid XBT parent height');
  header.set(crypto.hash256(Buffer.concat([sibling, coin.getHash()])), 36);
  expect(() => verifyXbtRewardForSpend(coin, branch, { ...anchor, header: header.toString('hex') })).toThrow();
});

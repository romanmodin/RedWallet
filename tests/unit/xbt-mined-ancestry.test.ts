import { xbtV2BlockHash } from '../../class/xbt/block-header-hash';
import { Psbt, Transaction, crypto, script } from 'bitcoinjs-lib';
import { verifyMinedAncestry, verifyXbtRewardForSpend } from '../../class/xbt/separation-proof';
import { verifyPublicMinedSeparation } from '../../class/xbt/separation-service';
import { assertStandardHardwareResult, requestFundingInputs } from '../../class/xbt/standard-hardware';
import regtestControl from '../fixtures/xbt-bitcoin-regtest-rejection.json';

function reward(tag: number, height = 975000) {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from(script.compile([script.number.encode(height), Buffer.alloc(8, tag)])));
  tx.addOutput(Buffer.from([0x51]), 100000n);
  return tx;
}

function fixture(height = 975000) {
  const mined = reward(1, height);
  const canonical = reward(2, height);
  const spend = new Transaction();
  spend.addInput(mined.getHash(), 0);
  spend.addOutput(Buffer.from([0x51]), 90000n);
  const header = Buffer.alloc(80);
  const sibling = Buffer.alloc(32, 9);
  const root = crypto.hash256(Buffer.concat([canonical.getHash(), sibling]));
  header.set(root, 36);
  const anchor = {
    height,
    tipHeight: height + 5,
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

test('a valid two-input standard return accepted by SHA-256 does not establish mined separation', () => {
  const funding = Transaction.fromHex(regtestControl.fixture.fundingHex);
  const signedHex = regtestControl.signed.bitcoinControlHex;
  const signed = Transaction.fromHex(signedHex);
  const request = new Psbt().setVersion(signed.version).setLocktime(signed.locktime);
  for (const input of signed.ins) {
    request.addInput({
      hash: input.hash,
      index: input.index,
      sequence: input.sequence,
      nonWitnessUtxo: Buffer.from(funding.toBuffer()),
      witnessUtxo: funding.outs[input.index],
      sighashType: Transaction.SIGHASH_ALL,
    });
  }
  for (const output of signed.outs) request.addOutput(output);
  expect(regtestControl.receipts.bitcoinControlHex.allowed).toBe(true);
  expect(regtestControl.bitcoinControlConfirmations).toBeGreaterThan(0);
  expect(assertStandardHardwareResult(signedHex, request).getId()).toBe(regtestControl.receipts.bitcoinControlHex.txid);

  const evidence = fixture();
  const inputs = requestFundingInputs(request);
  expect(inputs).toHaveLength(2);
  for (const input of inputs) {
    expect(() => verifyMinedAncestry(input, [funding.toHex(), evidence.mined.toHex()], evidence.proof, evidence.anchor)).toThrow('separation');
  }
});

test('a mixed-input transaction depends on its mined input even when it is the second input', () => {
  const f = fixture();
  const ordinary = new Transaction();
  ordinary.addInput(Buffer.alloc(32, 7), 0);
  ordinary.addOutput(Buffer.from([0x51]), 50000n);
  const mixed = new Transaction();
  mixed.addInput(ordinary.getHash(), 0);
  mixed.addInput(f.spend.getHash(), 0);
  mixed.addOutput(Buffer.from([0x51]), 120000n);
  const selected = { txid: mixed.getId(), vout: 0 };
  expect(verifyMinedAncestry(selected, [mixed.toHex(), ...f.path], f.proof, f.anchor).getId()).toBe(f.mined.getId());
  expect(() => verifyMinedAncestry(selected, [mixed.toHex(), ordinary.toHex(), f.mined.toHex()], f.proof, f.anchor)).toThrow();
});

test('accepts a complete 64-transaction mining path and rejects a longer or truncated path', () => {
  const f = fixture();
  const chain = [f.mined];
  for (let i = 1; i <= 64; i++) {
    const next = new Transaction();
    next.addInput(chain[i - 1].getHash(), 0);
    next.addOutput(Buffer.from([0x51]), 100000n - BigInt(i));
    chain.push(next);
  }
  const path = chain.map(tx => tx.toHex()).reverse();
  expect(verifyMinedAncestry({ txid: chain[63].getId(), vout: 0 }, path.slice(1), f.proof, f.anchor).getId()).toBe(f.mined.getId());
  const selected = { txid: chain[64].getId(), vout: 0 };
  expect(() => verifyMinedAncestry(selected, path, f.proof, f.anchor)).toThrow();
  expect(() => verifyMinedAncestry(selected, path.slice(0, 64), f.proof, f.anchor)).toThrow();
});

test('witness differences alone cannot distinguish the two reward outpoints', () => {
  const f = fixture();
  const otherWitness = Transaction.fromHex(f.canonical.toHex());
  otherWitness.setWitness(0, [Buffer.alloc(32, 5)]);
  expect(otherWitness.toHex()).not.toBe(f.canonical.toHex());
  expect(otherWitness.getId()).toBe(f.canonical.getId());
  expect(() => verifyMinedAncestry({ txid: otherWitness.getId(), vout: 0 }, [otherWitness.toHex()], f.proof, f.anchor)).toThrow();
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

test.each(['valid', 'rolling maturity', 'replaced at final check', 'metadata disagreement', 'unrelated XBT reward', 'broken XBT link', 'wrong XBT tip', 'replaced XBT tip', 'late final tip', 'stalled final tip', 'direct reward', 'missing selected proof', 'unconfirmed selected transaction', 'wrong selected position', 'five confirmations', 'borrowed block height', 'wrong selected sibling'] as const)(
  'collects only public SHA-256 reward evidence: %s',
  async scenario => {
    const rolling = scenario === 'rolling maturity';
    const f = fixture(rolling ? 979919 : 975000);
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
      const header = Buffer.alloc(164);
      header.writeUInt32LE(0x80000000, 0);
      header.writeUInt16LE(1, 108);
      header.writeInt32LE(height, 128);
      header.set((scenario === 'unrelated XBT reward' ? reward(9) : f.mined).getHash(), 36);
      const parentHeaders = linkParents(header, rolling ? 1790000000 : 1819756800);
      const anchor = { header: header.toString('hex'), blockHash: xbtV2BlockHash(header), parentHeaders };
      let hash = anchor.blockHash;
      const maturity = rolling ? 25920 : 100;
      const inclusionOffset = maturity + Number(scenario === 'five confirmations');
      const sibling = reward(8, height + inclusionOffset);
      const descendants = Array.from({ length: maturity + 5 }, (_, i) => {
        const child = Buffer.alloc(164);
        child.writeUInt32LE(0x80000000, 0);
        child.writeInt32LE(height + i + 1, 128);
        child.set(Buffer.from(hash, 'hex').reverse(), 4);
        if (i + 1 === inclusionOffset) {
          child.writeUInt16LE(2, 108);
          const second = scenario === 'unconfirmed selected transaction' ? f.canonical : f.spend;
          child.set(crypto.hash256(Buffer.concat([sibling.getHash(), second.getHash()])), 36);
        }
        hash = xbtV2BlockHash(child);
        return child.toString('hex');
      });
      if (scenario === 'broken XBT link') descendants[56] = descendants[55];
      let tipReads = 0;
      const timingCase = scenario === 'late final tip' || scenario === 'stalled final tip';
      if (timingCase) jest.useFakeTimers();
      let stalledSignal: AbortSignal | undefined;
      const readTrustedTip = async (signal?: AbortSignal) => {
        tipReads++;
        if (tipReads === 2 && scenario === 'late final tip') jest.advanceTimersByTime(45001);
        if (tipReads === 2 && scenario === 'stalled final tip') {
          stalledSignal = signal;
          return new Promise<{ height: number; hash: string }>(() => {});
        }
        return {
          height: height + descendants.length,
          hash: scenario === 'wrong XBT tip' || (tipReads === 2 && scenario === 'replaced XBT tip') ? '00'.repeat(32) : hash,
        };
      };
      const direct = scenario === 'direct reward';
      const selectedInclusion = direct || scenario === 'missing selected proof' ? undefined : {
        height: scenario === 'borrowed block height' ? height + inclusionOffset - 1 : height + inclusionOffset,
        position: scenario === 'wrong selected position' ? 0 : 1,
        merkle: [scenario === 'wrong selected sibling' ? f.mined.getId() : sibling.getId()],
      };
      const evidence = { anchor, merkle: [], descendants, selectedInclusion };
      const result = verifyPublicMinedSeparation(
        direct ? { txid: f.mined.getId(), vout: 0 } : f.selected,
        direct ? [f.mined.toHex()] : f.path, height, evidence, readTrustedTip, () => {},
      );
      if (timingCase) {
        const check = expect(result).rejects.toThrow('separation');
        await jest.runAllTimersAsync();
        await check;
        expect(tipReads).toBe(2);
        if (scenario === 'stalled final tip') expect(stalledSignal?.aborted).toBe(true);
        return;
      }
      if (scenario === 'valid' || rolling || direct) {
        await expect(result).resolves.toBeUndefined();
        expect(rewardAnchorReads).toBe(4);
      } else await expect(result).rejects.toThrow('separation');
      expect(calls.some(url => url.includes(f.selected.txid) || url.includes(f.mined.getId()))).toBe(false);
    } finally {
      jest.useRealTimers();
      fetch.mockRestore();
    }
  },
  90000,
);

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

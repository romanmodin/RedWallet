import { Transaction, crypto, script } from 'bitcoinjs-lib';
import { verifyMinedAncestry } from '../../class/xbt/separation-proof';

function reward(tag: number) {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from(script.compile([script.number.encode(975000), Buffer.alloc(8, tag)])));
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

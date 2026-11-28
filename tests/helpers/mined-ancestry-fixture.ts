import { Transaction, crypto, script } from 'bitcoinjs-lib';
import { xbtV2BlockHash } from '../../class/xbt/block-header-hash';

export function reward(tag: number, height = 975000) {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from(script.compile([script.number.encode(height), Buffer.alloc(8, tag)])));
  tx.addOutput(Buffer.from([0x51]), 100000n);
  return tx;
}

export function fixture(height = 975000, oneXbtSend = false) {
  const mined = reward(1, height);
  const canonical = reward(2, height);
  // Public scripts and unsigned transactions only.
  const sharedReward = reward(7, 900000);
  if (oneXbtSend) mined.outs[0].value = 250000000n;
  const spend = new Transaction();
  if (oneXbtSend) spend.addInput(sharedReward.getHash(), 0);
  spend.addInput(mined.getHash(), 0);
  if (oneXbtSend) spend.addOutput(Buffer.concat([Buffer.from([0, 20]), Buffer.alloc(20, 17)]), 200000000n);
  else spend.addOutput(Buffer.from([0x51]), 90000n);
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
  return { selected, path, mined, canonical, spend, proof, anchor, sharedReward };
}

export function linkParents(rewardHeader: Buffer, median: number) {
  const parents: string[] = [];
  let previous = Buffer.alloc(32);
  for (let i = 11; i > 0; i--) {
    const height = rewardHeader.readInt32LE(128) - i;
    const v2 = height >= 961640;
    const parent = Buffer.alloc(v2 ? 164 : 80);
    const timestamp = median + i - 6;
    parent.writeUInt32LE(v2 ? 0x80000000 : 4, 0);
    parent.writeUInt32LE(v2 ? timestamp - 120 : timestamp, 68);
    if (v2) {
      parent.writeInt32LE(height, 128);
      parent[110] = 4;
      parent.writeUInt32LE(120, 104);
    }
    parent.set(previous, 4);
    previous = v2 ? Buffer.from(xbtV2BlockHash(parent), 'hex').reverse() : Buffer.from(crypto.hash256(parent));
    parents.unshift(parent.toString('hex'));
  }
  rewardHeader.set(previous, 4);
  return parents;
}

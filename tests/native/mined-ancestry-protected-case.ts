import { crypto, Psbt, Transaction } from 'bitcoinjs-lib';
import { xbtV2BlockHash } from '../../class/xbt/block-header-hash';
import { collectMinedXbtEvidence } from '../../class/xbt/mined-ancestry-evidence';
import { discoverMinedAncestry } from '../../class/xbt/mined-ancestry-discovery';
import { verifyMinedRequestFunding } from '../../class/xbt/mined-request-funding';
import { fixture, linkParents, reward } from '../helpers/mined-ancestry-fixture';

// Both chains and the independent tip reader are fixtures. No signer or network.
export function syntheticMinedRequest({ omitSharedParent = false, twoInputs = false, tipNonce = 0 } = {}) {
  const height = 975000;
  const f = fixture(height, true);
  if (twoInputs) {
    f.spend.outs[0].value -= 50000000n;
    f.spend.addOutput(f.spend.outs[0].script, 50000000n);
  }
  const request = new Psbt();
  f.spend.outs.forEach((output, index) => request.addInput({ hash: f.spend.getId(), index, witnessUtxo: output }));
  request.addOutput({ script: Buffer.from([0x51]), value: 100000000n });
  request.addOutput({ script: f.spend.outs[0].script, value: 99999000n });
  const rewardHeader = Buffer.alloc(164);
  rewardHeader.writeUInt32LE(0x80000000);
  rewardHeader.writeInt32LE(height, 128);
  rewardHeader.writeUInt16LE(1, 108);
  rewardHeader.set(f.mined.getHash(), 36);
  const blocks = linkParents(rewardHeader, 1819756800).reverse();
  blocks.push(rewardHeader.toString('hex'));
  let hash = xbtV2BlockHash(rewardHeader);
  const sibling = reward(8, height + 100);
  for (let i = 1; i <= 105; i++) {
    const child = Buffer.alloc(164);
    child.writeUInt32LE(0x80000000);
    child.writeInt32LE(height + i, 128);
    child.set(Buffer.from(hash, 'hex').reverse(), 4);
    if (i === 100) {
      child.writeUInt16LE(2, 108);
      child.set(crypto.hash256(Buffer.concat([sibling.getHash(), f.spend.getHash()])), 36);
    }
    if (i === 105) child.writeUInt32LE(tipNonce, 76);
    hash = xbtV2BlockHash(child);
    blocks.push(child.toString('hex'));
  }
  const raw = Object.fromEntries([f.spend, f.mined, f.sharedReward].map(tx => [tx.getId(), tx.toHex()]));
  if (omitSharedParent) delete raw[f.sharedReward.getId()];
  const current = () => {};
  const collect = async (selected: { txid: string; vout: number }) => {
    const read = async (ids: string[]) => Object.fromEntries(ids.filter(id => id in raw).map(id => [id, raw[id]]));
    const paths = [];
    for await (const path of discoverMinedAncestry(selected, read, current)) paths.push(path);
    if (paths.length !== 1) throw new Error('Expected a single synthetic mining path');
    const [candidate] = paths;
    const rewardPoint = { txid: Transaction.fromHex(candidate.path[candidate.path.length - 1]).getId(), height: candidate.height };
    const evidence = await collectMinedXbtEvidence(
      rewardPoint,
      { txid: selected.txid, height: height + 100 },
      height + 105,
      async (method, [id, arg]) => {
        if (method === 'blockchain.block.headers') {
          const index = Number(id) - height + 11;
          const batch = blocks.slice(index, index + Math.min(30, Number(arg)));
          return { count: batch.length, hex: batch.join('') };
        }
        if (id === f.mined.getId() && arg === height) return { pos: 0, block_height: height, merkle: [] };
        if (id === selected.txid && arg === height + 100) return { pos: 1, block_height: arg, merkle: [sibling.getId()] };
        throw new Error('Unexpected fixture transaction');
      },
      current,
    );
    return { path: candidate.path, height: candidate.height, xbtReward: evidence };
  };
  const readTip = async () => ({ height: height + 105, hash });
  return { request, collect, readTip };
}

export async function verifySyntheticOneXbtRequest({ omitSharedParent = false } = {}) {
  const { request, collect, readTip } = syntheticMinedRequest({ omitSharedParent });
  const current = () => {};
  await verifyMinedRequestFunding(request, collect, readTip, current);
  try {
    await verifyMinedRequestFunding(request, collect, async () => ({ ...(await readTip()), hash: '11'.repeat(32) }), current);
  } catch (error) {
    if (error instanceof Error && error.message.includes('separation')) return { unsignedOneXbtVerified: true, replacedTipRejected: true };
    throw error;
  }
  throw new Error('Accepted obsolete mining proof');
}

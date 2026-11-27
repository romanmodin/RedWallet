import { rewardParentMedianTime, xbtV2BlockHash } from './block-header-hash';
import { Transaction, crypto, script } from 'bitcoinjs-lib';

/** Supplied by a trusted current BTC chain view separate from the proof source.
 * Production cross-checks two HTTPS explorers; this is not local chain validation.
 */
export type BtcChainAnchor = { height: number; blockHash: string; tipHeight: number; txCount: number };
export type ConflictProof = { rawTransaction: string; header: string; position: number; merkle: string[] };
const HASH = /^[0-9a-f]{64}$/i;
const fail = (): never => {
  throw new Error('Coin separation proof is invalid or insufficiently confirmed');
};

/** A different confirmed BTC transaction spending any funding input makes that
 * funding body impossible on the anchored BTC chain. Signature-only changes do
 * not count: they may preserve the txid. Recheck the anchor before broadcasting.
 */
export function verifyFundingConflict(funding: Transaction, proof: ConflictProof, anchor: BtcChainAnchor): string {
  if (proof.position < 1) fail();
  const conflict = verifyInclusion(proof, anchor);
  if (funding.isCoinbase() || conflict.isCoinbase() || conflict.getId() === funding.getId()) fail();
  if (
    !conflict.ins.some(input =>
      funding.ins.some(other => input.index === other.index && Buffer.from(input.hash).equals(Buffer.from(other.hash))),
    )
  )
    fail();
  return conflict.getId();
}

function verifyInclusion(proof: ConflictProof, anchor: BtcChainAnchor): Transaction {
  if (
    !Number.isSafeInteger(anchor.height) ||
    anchor.height < 961640 ||
    !Number.isSafeInteger(anchor.tipHeight) ||
    anchor.tipHeight - anchor.height + 1 < 6 ||
    !HASH.test(anchor.blockHash) ||
    !/^[0-9a-f]{160}$/i.test(proof.header) ||
    !Number.isSafeInteger(anchor.txCount) ||
    anchor.txCount < 1 ||
    anchor.txCount > 1000000 ||
    !Number.isSafeInteger(proof.position) ||
    proof.position < 0 ||
    proof.position >= anchor.txCount ||
    !Array.isArray(proof.merkle) ||
    proof.merkle.length !== Math.ceil(Math.log2(anchor.txCount)) ||
    proof.merkle.some(hash => !HASH.test(hash)) ||
    proof.rawTransaction.length > 2_000_000 ||
    !/^(?:[0-9a-f]{2})+$/i.test(proof.rawTransaction)
  )
    fail();
  const header = Buffer.from(proof.header, 'hex');
  const headerHash = Buffer.from(crypto.hash256(header)).reverse().toString('hex');
  if (headerHash !== anchor.blockHash.toLowerCase()) fail();
  const included = Transaction.fromHex(proof.rawTransaction);
  if (included.byteLength(false) === 64) fail();
  let hash = Buffer.from(included.getHash());
  let position = proof.position;
  let width = anchor.txCount;
  for (const sibling of proof.merkle) {
    const other = Buffer.from(sibling, 'hex').reverse();
    // Bitcoin duplicates the last node only at odd-width levels. Count is
    // obtained from the independent anchor source, not from this proof.
    const duplicatedLast = width % 2 === 1 && position === width - 1;
    if (hash.equals(other) !== duplicatedLast) fail();
    hash = Buffer.from(crypto.hash256(position % 2 ? Buffer.concat([other, hash]) : Buffer.concat([hash, other])));
    position = Math.floor(position / 2);
    width = Math.ceil(width / 2);
  }
  if (position !== 0 || !hash.equals(Buffer.from(header.subarray(36, 68)))) fail();
  return included;
}

/** Verify one selected outpoint's dependency on a coinbase excluded by the supplied
 * current SHA-256 chain anchor. This does not certify XBT inclusion or maturity.
 * Each entry is the raw creating transaction for the previous outpoint in the path.
 */
export function verifyMinedAncestry(
  selected: { txid: string; vout: number },
  path: readonly string[],
  proof: ConflictProof,
  anchor: BtcChainAnchor,
): void {
  if (!path.length || path.length > 64 || proof.position !== 0 || !Number.isSafeInteger(selected.vout) || selected.vout < 0) fail();
  const canonical = verifyInclusion(proof, anchor);
  if (!rewardAtHeight(canonical, anchor.height)) fail();
  let child: Transaction | undefined;
  let chars = 0;
  for (const raw of path) {
    chars += raw.length;
    if (raw.length > 2_000_000 || chars > 16_000_000 || !/^(?:[0-9a-f]{2})+$/i.test(raw)) fail();
    const tx = Transaction.fromHex(raw);
    if (child) {
      const hash = Buffer.from(tx.getHash());
      if (!child.ins.some(input => input.index < tx.outs.length && hash.equals(input.hash))) fail();
    } else if (tx.getId() !== selected.txid || !tx.outs[selected.vout]) fail();
    child = tx;
  }
  if (!child || !rewardAtHeight(child, anchor.height) || child.getId() === canonical.getId()) fail();
}

function rewardAtHeight(tx: Transaction, height: number): boolean {
  const encoded = script.number.encode(height);
  const prefix = Buffer.concat([Buffer.from([encoded.length]), encoded]);
  return tx.isCoinbase() && tx.ins[0].index === 0xffffffff && Buffer.from(tx.ins[0].script.subarray(0, prefix.length)).equals(prefix);
}

/** Caller must independently authenticate the reward block hash and the tip on the same
 * XBT branch. The linked parent headers provide the median time past. A copied Electrum header alone
 * cannot establish that trust. Checks maturity for admission to the next block.
 */
export function verifyXbtRewardForSpend(
  reward: Transaction,
  merkle: readonly string[],
  anchor: { header: string; blockHash: string; tipHeight: number; parentHeaders: readonly string[] },
): void {
  if (!/^[a-f0-9]{328}$/i.test(anchor.header) || !Number.isSafeInteger(anchor.tipHeight) || anchor.tipHeight > 0x7fffffff) fail();
  const header = Buffer.from(anchor.header, 'hex');
  if (xbtV2BlockHash(header) !== anchor.blockHash) fail();
  const count = header.readUInt16LE(108);
  const height = header.readInt32LE(128);
  if (
    header.readInt32LE(0) >= 0 ||
    height < 961640 ||
    !count ||
    !rewardAtHeight(reward, height) ||
    reward.byteLength(false) === 64 ||
    merkle.length !== Math.ceil(Math.log2(count))
  )
    fail();
  let hash = Buffer.from(reward.getHash());
  for (const sibling of merkle) {
    if (!HASH.test(sibling)) fail();
    const right = Buffer.from(sibling, 'hex').reverse();
    if (hash.equals(right)) fail();
    hash = Buffer.from(crypto.hash256(Buffer.concat([hash, right])));
  }
  if (!hash.equals(header.subarray(36, 68))) fail();
  // Knots b4c8f9f4, Consensus::CoinbaseMaturityPolicy. Rewards covered by
  // the rolling rule retain it when a later block crosses the RDTS expiry.
  const depth = anchor.tipHeight - height + 1;
  const minimum = rewardParentMedianTime(header, anchor.parentHeaders) >= 1819756800 ? 100 : height >= 979919 ? 25920 : 6480;
  if (depth < minimum) throw new Error('XBT mining reward is immature');
}

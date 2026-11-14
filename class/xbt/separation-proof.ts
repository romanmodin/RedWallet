import { Transaction, crypto } from 'bitcoinjs-lib';

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
  if (
    !Number.isSafeInteger(anchor.height) ||
    anchor.height < 961640 ||
    !Number.isSafeInteger(anchor.tipHeight) ||
    anchor.tipHeight - anchor.height + 1 < 6 ||
    !HASH.test(anchor.blockHash) ||
    !/^[0-9a-f]{160}$/i.test(proof.header) ||
    !Number.isSafeInteger(anchor.txCount) ||
    anchor.txCount < 2 ||
    anchor.txCount > 1000000 ||
    !Number.isSafeInteger(proof.position) ||
    proof.position < 1 ||
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
  const conflict = Transaction.fromHex(proof.rawTransaction);
  if (funding.isCoinbase() || conflict.isCoinbase() || conflict.getId() === funding.getId()) fail();
  if (
    !conflict.ins.some(input =>
      funding.ins.some(other => input.index === other.index && Buffer.from(input.hash).equals(Buffer.from(other.hash))),
    )
  )
    fail();
  let hash = Buffer.from(conflict.getHash());
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
  if (position !== 0 || !hash.equals(header.subarray(36, 68))) fail();
  return conflict.getId();
}

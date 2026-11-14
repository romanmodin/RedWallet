import { Transaction, crypto } from 'bitcoinjs-lib';

/** Supplied by a separately authenticated current BTC chain view, never copied
 * from the proof provider itself. This verifier does not authenticate headers.
 */
export type BtcChainAnchor = { height: number; blockHash: string; tipHeight: number };
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
    !Number.isSafeInteger(proof.position) ||
    proof.position < 0 ||
    !Array.isArray(proof.merkle) ||
    proof.merkle.length > 32 ||
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
  if (!conflict.ins.some(input => funding.ins.some(other => input.index === other.index && Buffer.from(input.hash).equals(other.hash))))
    fail();
  let hash = Buffer.from(conflict.getHash());
  let position = proof.position;
  for (const sibling of proof.merkle) {
    const other = Buffer.from(sibling, 'hex').reverse();
    // Reject duplicate branches rather than accepting a mutated merkle tree.
    if (hash.equals(other)) fail();
    hash = Buffer.from(crypto.hash256(position % 2 ? Buffer.concat([other, hash]) : Buffer.concat([hash, other])));
    position = Math.floor(position / 2);
  }
  if (position !== 0 || !hash.equals(header.subarray(36, 68))) fail();
  return conflict.getId();
}

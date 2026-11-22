import { script } from 'bitcoinjs-lib';
import ecc from '../../../blue_modules/noble_ecc';
import { hex } from './crypto';
import { changeMessage, Terms } from './protocol';
import { parseSeat, Seat, validateRoster } from './roster';
import { outpoint } from './transaction';

// Verify the signed portion of a public join request before allocating a seat.
// The caller supplies the authenticated envelope sender and a host-generated token hash.
export function verifyPublicJoinProof(body: Record<string, unknown>, sender: string, tokenHash: string, terms: Terms) {
  if (terms.private || body.type !== 'join' || !body.seat || typeof body.seat !== 'object' || Array.isArray(body.seat))
    throw new Error('Expected a public pool join request');
  if (sender === terms.public_key) throw new Error('Reserved creator identity');
  const proofs = body.proofs === undefined ? [body.proof] : body.proofs;
  const seat = parseSeat({ ...body.seat, join_pub: sender, token_hash: tokenHash, proofs }, terms);
  if (new Set(seat.coins.map(outpoint)).size !== seat.coins.length) throw new Error('Duplicate join input');
  if (typeof body.change_sig !== 'string' || body.change_sig.length > 144) throw new Error('Invalid change authorization');
  const signature = script.signature.decode(Buffer.concat([hex(body.change_sig), Buffer.from([1])])).signature;
  if (!ecc.verify(changeMessage(terms.id, seat.coins, seat.change_script, seat.change_value), hex(seat.coins[0].pubkey, 33), signature, false))
    throw new Error('Invalid change authorization');
  return seat;
}

// Build a candidate roster from the host's current seats and independent chain observations.
export function proposePublicJoin(
  body: Record<string, unknown>,
  sender: string,
  tokenHash: string,
  terms: Terms,
  currentSeats: readonly Seat[],
  context: Parameters<typeof validateRoster>[2],
) {
  if (context.ownSeat.join_pub !== terms.public_key) throw new Error('Expected creator seat');
  if (currentSeats.length >= terms.max_peers) throw new Error('Pool is full');
  const newcomer = verifyPublicJoinProof(body, sender, tokenHash, terms);
  const seats = [...currentSeats, newcomer].map(seat => ({ ...seat, coin: seat.coins[0] }));
  return validateRoster({ type: 'roster', seq: context.previousSeq + 1, seats }, terms, context);
}

import { ChainValidationError } from './chain-error';
/** Strict v3 roster validation. Chain observations MUST come from our backend, never the relay. */
import { hex } from './crypto';
import { Terms, outputCount } from './protocol';
import { change, changeOf, Coin, coinScript, isType, outpoint, verifyOwnership } from './transaction';
export type Seat = {
  token_hash: string;
  join_pub: string;
  coins: Coin[];
  proofs: string[];
  change_script: string;
  change_value: number;
};
export type ChainCoin = {
  value: number;
  script: string;
  unspent: boolean;
  checkedAt: number;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid roster object');
  return value as Record<string, unknown>;
};
function parseCoin(value: unknown, type: Coin['type']): Coin {
  const raw = object(value);
  const coin = {
    txid: raw.txid,
    vout: raw.vout,
    value: raw.value,
    pubkey: raw.pubkey,
    type,
  } as Coin;
  coinScript(coin);
  return coin;
}
export function parseSeat(value: unknown, terms: Readonly<Terms>): Seat {
  const raw = object(value);
  hex(raw.token_hash as string, 32);
  hex(raw.join_pub as string, 32);
  const first = parseCoin(raw.coin, terms.script);
  const list = raw.coins === undefined ? [raw.coin] : raw.coins;
  if (!Array.isArray(list) || list.length < 1 || list.length > terms.max_inputs) throw new Error('Invalid seat input count');
  const coins = list.map(c => parseCoin(c, terms.script));
  if (JSON.stringify(first) !== JSON.stringify(coins[0])) throw new Error('Ambiguous first coin');
  if (!Array.isArray(raw.proofs) || raw.proofs.length !== coins.length) throw new Error('Missing ownership proofs');
  const proofs = raw.proofs.map(p => {
    if (typeof p !== 'string' || p.length > 144) throw new Error('Invalid ownership proof');
    hex(p);
    return p;
  });
  coins.forEach((c, i) => {
    if (!verifyOwnership(terms.id, raw.join_pub as string, c, proofs[i])) throw new Error('Invalid ownership proof');
  });
  const total = coins.reduce((n, c) => n + c.value, 0);
  const expected =
    terms.v === 5 && raw.join_pub === terms.public_key
      ? changeOf(total, terms.denomination * outputCount(terms), terms.fee_rate, coins.length, terms.script, terms.payments!.length)
      : change(total, terms.denomination, terms.fee_rate, coins.length, terms.script, outputCount(terms));
  if (
    expected === null ||
    raw.change_value !== expected ||
    (expected === 0 ? raw.change_script !== '' : typeof raw.change_script !== 'string' || !isType(raw.change_script, terms.script))
  )
    throw new Error('Invalid seat change');
  return {
    token_hash: raw.token_hash as string,
    join_pub: raw.join_pub as string,
    coins,
    proofs,
    change_script: raw.change_script as string,
    change_value: expected,
  };
}
export function validateRoster(
  body: Readonly<Record<string, unknown>>,
  terms: Readonly<Terms>,
  context: {
    previousSeq: number;
    ownSeat: Seat;
    walletOutpoints: ReadonlySet<string>;
    chain: ReadonlyMap<string, ChainCoin>;
    now: number;
  },
): { seq: number; seats: Seat[] } {
  if (
    body.type !== 'roster' ||
    !Number.isSafeInteger(body.seq) ||
    (body.seq as number) < 0 ||
    !Number.isSafeInteger(context.previousSeq) ||
    context.previousSeq < -1 ||
    (body.seq as number) <= context.previousSeq
  )
    throw new Error('Invalid or replayed roster sequence');
  if (!Number.isSafeInteger(context.now) || context.now < 0) throw new Error('Invalid observation time');
  if (!Array.isArray(body.seats) || body.seats.length < 1 || body.seats.length > terms.max_peers) throw new Error('Invalid roster size');
  const seats = body.seats.map(s => parseSeat(s, terms));
  if (terms.v === 5 && seats.filter(s => s.join_pub === terms.public_key).length !== 1) throw new Error('Payment creator seat missing');
  const tokens = new Set<string>(),
    joins = new Set<string>(),
    inputs = new Set<string>(),
    changes = new Set<string>();
  const mine = new Set(context.ownSeat.coins.map(outpoint));
  for (const seat of seats) {
    if (tokens.has(seat.token_hash) || joins.has(seat.join_pub)) throw new Error('Duplicate seat identity');
    tokens.add(seat.token_hash);
    joins.add(seat.join_pub);
    if (seat.change_script) {
      if (changes.has(seat.change_script)) throw new Error('Duplicate change script');
      changes.add(seat.change_script);
    }
    for (const coin of seat.coins) {
      const id = outpoint(coin);
      if (inputs.has(id)) throw new Error('Duplicate roster input');
      inputs.add(id);
      if (context.walletOutpoints.has(id) && (!mine.has(id) || seat.token_hash !== context.ownSeat.token_hash))
        throw new Error('Unselected wallet input');
      const known = context.chain.get(id);
      if (!known) throw new ChainValidationError('KJ-CHAIN-OBSERVATION', 'Missing, stale or mismatched chain observation');
      if (!known.unspent) throw new ChainValidationError('KJ-CHAIN-SPENT', 'Missing, stale or mismatched chain observation');
      if (known.value !== coin.value)
        throw new ChainValidationError('KJ-CHAIN-OBSERVATION-VALUE', 'Missing, stale or mismatched chain observation');
      if (known.script !== coinScript(coin).toString('hex'))
        throw new ChainValidationError('KJ-CHAIN-OBSERVATION-SCRIPT', 'Missing, stale or mismatched chain observation');
      if (!Number.isSafeInteger(known.checkedAt))
        throw new ChainValidationError('KJ-CHAIN-TIME', 'Missing, stale or mismatched chain observation');
      if (known.checkedAt > context.now)
        throw new ChainValidationError('KJ-CHAIN-FUTURE', 'Missing, stale or mismatched chain observation');
      if (known.checkedAt < context.now - 60)
        throw new ChainValidationError('KJ-CHAIN-STALE', 'Missing, stale or mismatched chain observation');
    }
  }
  const own = seats.find(s => s.token_hash === context.ownSeat.token_hash);
  // Compare committed fields, not randomized DER proof bytes or object property order.
  const commitment = (s: Seat) =>
    JSON.stringify([
      s.token_hash,
      s.join_pub,
      s.coins.map(c => [c.txid, c.vout, c.value, c.pubkey, c.type]),
      s.change_script,
      s.change_value,
    ]);
  if (!own || commitment(own) !== commitment(context.ownSeat)) throw new Error('Own seat missing or changed');
  return { seq: body.seq as number, seats };
}

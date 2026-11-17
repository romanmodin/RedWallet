// Bond valuation and selection, adapted from pinned rc6 Selection.kt.
import { randomBytes } from '../rng';
import { ChainLookup } from './chain';
import { acceptable, feePlan, offerFee, sats } from './fees';
import { BondedOffer, bondValue, BondProof } from './offers';
import { isValidNick } from './nick';
import { uint32 } from './spv';

export type ValuedOffer = BondedOffer & Readonly<{ value: bigint; problem?: string }>;
const MAX_OFFERS = 10000;
const MAX_WEIGHT = 0x7fffffffffffffffn;
function snapshot(o: BondedOffer): BondedOffer {
  if (!(o.bond instanceof BondProof) || !isValidNick(o.offer.counterparty)) throw new Error('Invalid bonded offer');
  return Object.freeze({ offer: Object.freeze({ ...o.offer }), bond: o.bond });
}
export async function valueOffers(
  offers: readonly BondedOffer[],
  chain: ChainLookup,
  ourNick: string,
  nowSeconds: number,
): Promise<readonly ValuedOffer[]> {
  if (!Array.isArray(offers) || offers.length > MAX_OFFERS || !isValidNick(ourNick)) throw new Error('Invalid bond valuation');
  uint32(nowSeconds);
  const inputs = offers.map(snapshot),
    height = uint32(await chain.height());
  const cache = new Map<string, Readonly<{ value: bigint; problem?: string }>>();
  const result: ValuedOffer[] = [];
  for (const item of inputs) {
    const { offer, bond } = item;
    let valuation: Readonly<{ value: bigint; problem?: string }>;
    // Certificate validity belongs to each offer, NOT the cached outpoint claim.
    if (!bond.verify(offer.counterparty, ourNick) && !bond.verify(offer.counterparty, offer.counterparty)) {
      valuation = { value: 0n, problem: 'Invalid bond certificate' };
    } else if (bond.expiredAt(height)) {
      valuation = { value: 0n, problem: 'Bond certificate expired' };
    } else {
      const script = bond.scriptPubKey,
        claim = bond.txid + ':' + bond.vout + ':' + script;
      const cached = cache.get(claim);
      if (cached) valuation = cached;
      else {
        try {
          const u = await chain.utxo(bond.txid, bond.vout, script);
          if (!u) throw new Error('Bond output not found or spent');
          if (u.txid !== bond.txid || u.vout !== bond.vout || u.scriptPubKey !== script) throw new Error('Bond output mismatch');
          if (
            u.confirmationProof !== 'anchored-merkle-pow' ||
            u.unspentSource !== 'electrum' ||
            uint32(u.height) === 0 ||
            u.height > height ||
            u.confirmations !== height - u.height + 1
          )
            throw new Error('Bond confirmation not proven');
          const value = bondValue(sats(u.value), uint32(u.blockTime), bond.locktime, nowSeconds);
          valuation = value > 0n ? { value } : { value: 0n, problem: 'Bond value is zero' };
        } catch {
          // Do not expose arbitrary network/error text (it could contain credentials).
          valuation = { value: 0n, problem: 'Bond chain verification failed' };
        }
        cache.set(claim, Object.freeze(valuation));
      }
    }
    result.push(Object.freeze({ ...item, ...valuation }));
  }
  // A changed view invalidates the whole batch, rather than mixing confirmations.
  if (uint32(await chain.height()) !== height) throw new Error('Chain tip changed during bond valuation');
  return Object.freeze(result);
}
export type Selection = Readonly<{
  offers: readonly ValuedOffer[];
  fees: ReadonlyMap<string, number>;
  totalFee: number;
}>;
type RandomBytes = (size: number) => Promise<Uint8Array>;
async function uniformBelow(upper: bigint, random: RandomBytes): Promise<bigint> {
  if (upper <= 0n) throw new Error('Invalid selection weight');
  const size = Math.ceil(upper.toString(2).length / 8),
    range = 256n ** BigInt(size),
    ceiling = range - (range % upper);
  for (let retry = 0; retry < 128; retry++) {
    const bytes = await random(size);
    if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw new Error('Invalid random source');
    const value = BigInt('0x' + Buffer.from(bytes).toString('hex'));
    if (value < ceiling) return value % upper;
  }
  throw new Error('Random selection retries exhausted');
}
export async function chooseMakers(
  offers: readonly ValuedOffer[],
  amount: number,
  options: Readonly<{ count?: number; minimum?: number; ignored?: readonly string[]; equalize?: boolean }> = {},
  random: RandomBytes = randomBytes,
): Promise<Selection> {
  sats(amount);
  const count = options.count ?? 9,
    minimum = options.minimum ?? 1,
    equalize = options.equalize ?? false;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 9 ||
    !Number.isInteger(minimum) ||
    minimum < 1 ||
    minimum > count ||
    !Array.isArray(offers) ||
    offers.length > MAX_OFFERS
  )
    throw new Error('Invalid maker selection');
  const ignored = new Set(options.ignored ?? []),
    perMaker = new Map<string, ValuedOffer>();
  for (const original of offers) {
    const item = Object.freeze({ ...snapshot(original), value: original.value, problem: original.problem });
    if (typeof item.value !== 'bigint' || item.value < 0n || item.value > MAX_WEIGHT) throw new Error('Invalid bond weight');
    if (item.value === 0n || item.problem || ignored.has(item.offer.counterparty) || !acceptable(item.offer, amount)) continue;
    const old = perMaker.get(item.offer.counterparty);
    if (!old || offerFee(item.offer, amount) < offerFee(old.offer, amount)) perMaker.set(item.offer.counterparty, item);
  }
  const perOutpoint = new Map<string, ValuedOffer>();
  for (const item of perMaker.values()) {
    const key = item.bond.txid + ':' + item.bond.vout,
      old = perOutpoint.get(key);
    if (!old || offerFee(item.offer, amount) < offerFee(old.offer, amount)) perOutpoint.set(key, item);
  }
  const pool = [...perOutpoint.values()],
    selected: ValuedOffer[] = [];
  if (pool.length < minimum) throw new Error('Not enough makers with a verified fidelity bond');
  if (pool.length <= count) selected.push(...pool);
  else {
    while (selected.length < count) {
      const total = pool.reduce((sum, o) => sum + o.value, 0n),
        draw = await uniformBelow(total, random);
      let cumulative = 0n,
        index = 0;
      for (; index < pool.length; index++) {
        cumulative += pool[index].value;
        if (draw < cumulative) break;
      }
      selected.push(pool.splice(index, 1)[0]);
    }
  }
  const fees = feePlan(
    selected.map(x => x.offer),
    amount,
    equalize,
  );
  const totalFee = [...fees.values()].reduce((sum, fee) => sats(sum + fee), 0);
  return Object.freeze({ offers: Object.freeze(selected), fees, totalFee });
}

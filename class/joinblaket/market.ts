// Adapted from Kilowallet rc6 (Apache-2.0); see docs/joinblaket-port.md.
import { decimal, miningFee, sats } from './fees';
import BigNumber from 'bignumber.js';

export const JOINBLAKET_MARKET_URL = 'https://mempool.kilombino.com/joinblaket/market.json';
export const MARKET_REFRESH_MS = 30_000;
export type MarketOffer = Readonly<{
  type: 'rel' | 'abs';
  minsize: number;
  maxsize: number;
  cjfee: string;
  txfee: number;
  bondValue: number;
}>;
export type Market = Readonly<{
  makers: number;
  minAmount: number | null;
  maxAmount: number | null;
  height: number | null;
  offers: readonly MarketOffer[];
}>;
function integer(x: unknown): number {
  if (typeof x !== 'number') throw new Error('Invalid market integer');
  return sats(x);
}
// Watcher metadata is informational: no SPV or bond verification is inferred.
export function parseMarket(text: string): Market {
  if (text.length > 262144) throw new Error('Market response is too large');
  const x = JSON.parse(text);
  if (!x || x.network !== 'xbt' || !Array.isArray(x.offers) || x.offers.length > 2048) throw new Error('Invalid XBT market');
  const makers = integer(x.makers);
  if (makers > 2048) throw new Error('Invalid maker count');
  const offers: MarketOffer[] = x.offers.map((o: Record<string, unknown>) => {
    if (!o || !['rel', 'abs'].includes(String(o.type)) || typeof o.cjfee !== 'string') throw new Error('Invalid market offer');
    const minsize = integer(o.minsize),
      maxsize = integer(o.maxsize);
    if (minsize > maxsize) throw new Error('Invalid market amount range');
    const fee = decimal(o.cjfee);
    if (o.type === 'abs' && (!fee.isInteger() || fee.gt(2_100_000_000_000_000))) throw new Error('Invalid absolute fee');
    return Object.freeze({
      type: o.type as 'abs' | 'rel',
      minsize,
      maxsize,
      cjfee: o.cjfee,
      txfee: integer(o.txfee),
      bondValue: integer(o.bond_value),
    });
  });
  const nullable = (value: unknown) => (value === null ? null : integer(value));
  const minAmount = nullable(x.min_amount),
    maxAmount = nullable(x.max_amount),
    height = nullable(x.height);
  if ((minAmount === null) !== (maxAmount === null) || (minAmount !== null && maxAmount !== null && minAmount > maxAmount))
    throw new Error('Invalid market range');
  return Object.freeze({ makers, minAmount, maxAmount, height, offers: Object.freeze(offers) });
}
export function estimateMarket(market: Market, amount: number, feeRate: string, takerInputs = 1) {
  sats(amount);
  if (!Number.isSafeInteger(takerInputs) || takerInputs < 1 || takerInputs > 128) throw new Error('Invalid taker input count');
  // The watcher uses ceiling for display estimates; negotiated fees use half-even.
  const fee = (o: MarketOffer) =>
    sats(
      decimal(o.cjfee)
        .times(o.type === 'rel' ? amount : 1)
        .integerValue(BigNumber.ROUND_CEIL)
        .toNumber(),
    );
  const selected = market.offers
    .filter(o => o.bondValue > 0 && o.minsize <= amount && amount <= o.maxsize)
    .map(o => ({ offer: o, fee: fee(o) }))
    .sort((a, b) => a.fee - b.fee)
    .slice(0, 9);
  if (!selected.length) return null;
  const makerFees = sats(selected.reduce((sum, x) => sats(sum + x.fee), 0));
  const contributions = selected.reduce((sum, x) => sats(sum + x.offer.txfee), 0);
  const mining = Math.max(0, miningFee(selected.length + takerInputs, 2 * selected.length + 2, feeRate) - contributions);
  return { makers: selected.length, makerFees, miningFee: mining, total: sats(makerFees + mining), verified: false as const };
}

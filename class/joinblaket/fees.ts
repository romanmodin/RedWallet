// Adapted from Kilowallet rc6 (Apache-2.0); see docs/joinblaket-port.md.
import BigNumber from 'bignumber.js';

// Isolate protocol rounding from application-wide BigNumber configuration.
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 80, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN });
export const MAX_SATS = 2_100_000_000_000_000;
export const RELATIVE_GRID = ['0.00002', '0.00005', '0.0001', '0.0002', '0.0005', '0.001', '0.002', '0.005', '0.01', '0.02', '0.05', '0.1'];
export const ABSOLUTE_GRID = [0, 100, 200, 500, 1000, 2000, 5000, 10000];
export const TAKER_DUST = 2730;
export const MAKER_DUST = 27300;

export function sats(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SATS) throw new Error('Invalid satoshi amount');
  return value;
}
export function decimal(value: string): BigNumber {
  if (typeof value !== 'string' || value.length > 96 || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/.test(value)) {
    throw new Error('Invalid decimal fee');
  }
  const n = new Decimal(value);
  if (!n.isFinite() || n.isNegative() || Math.abs(n.e ?? 0) > 80) throw new Error('Decimal fee outside supported range');
  return n;
}
function asSats(value: BigNumber): number {
  if (!value.isInteger()) throw new Error('Fractional satoshis');
  return sats(value.toNumber());
}
export function relativeFee(amount: number, rate: string): number {
  return asSats(decimal(rate).times(sats(amount)).integerValue(BigNumber.ROUND_HALF_EVEN));
}
export function quantizeRelativeUp(rate: string): string | null {
  const n = decimal(rate);
  return RELATIVE_GRID.find(x => decimal(x).gte(n)) ?? null;
}
export function quantizeAbsoluteUp(fee: number): number | null {
  sats(fee);
  return ABSOLUTE_GRID.find(x => x >= fee) ?? null;
}
export type Offer = Readonly<{
  counterparty: string;
  type: string;
  minsize: number;
  maxsize: number;
  cjfee: string;
  txfee: number;
}>;
function feePolicy(offer: Offer, roundUp = false): BigNumber {
  if (!['sw0absoffer', 'sw0reloffer'].includes(offer.type)) throw new Error('Unsupported JoinBlaket offer type');
  sats(offer.minsize);
  sats(offer.maxsize);
  sats(offer.txfee);
  if (offer.minsize > offer.maxsize) throw new Error('Invalid offer range');
  const n = decimal(offer.cjfee);
  if (offer.type === 'sw0absoffer') {
    const fee = asSats(n);
    const rounded = roundUp ? quantizeAbsoluteUp(fee) : fee;
    if (rounded === null) throw new Error('No upper absolute fee quantum');
    return new Decimal(rounded);
  }
  const rounded = roundUp ? quantizeRelativeUp(offer.cjfee) : offer.cjfee;
  if (rounded === null) throw new Error('No upper relative fee quantum');
  return decimal(rounded);
}
export function offerFee(offer: Offer, amount: number, roundUp = false): number {
  const n = feePolicy(offer, roundUp);
  sats(amount);
  return asSats(offer.type === 'sw0absoffer' ? n : n.times(amount).integerValue(BigNumber.ROUND_HALF_EVEN));
}
export function isQuantized(offer: Offer): boolean {
  const n = feePolicy(offer);
  return offer.type === 'sw0absoffer' ? ABSOLUTE_GRID.some(x => n.eq(x)) : RELATIVE_GRID.some(x => n.eq(x));
}
export function withinLimits(offer: Offer, roundUp = false): boolean {
  return feePolicy(offer, roundUp).lte(offer.type === 'sw0absoffer' ? 500 : '0.001');
}
export function acceptable(offer: Offer, amount: number): boolean {
  sats(amount);
  try {
    return isQuantized(offer) && withinLimits(offer) && amount >= offer.minsize && amount <= offer.maxsize;
  } catch (_) {
    return false;
  }
}
export function feePlan(offers: readonly Offer[], amount: number, equalize = false): ReadonlyMap<string, number> {
  const plan = new Map<string, number>();
  for (const offer of offers) {
    if (!offer.counterparty || plan.has(offer.counterparty)) throw new Error('Duplicate or missing maker');
    plan.set(offer.counterparty, offerFee(offer, amount));
  }
  if (equalize && plan.size) {
    const largest = Math.max(...plan.values());
    for (const key of plan.keys()) plan.set(key, largest);
  }
  return plan;
}
export function vsizeEstimate(inputs: number, outputs: number): number {
  if (![inputs, outputs].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000)) throw new Error('Invalid transaction shape');
  return 11 + 68 * inputs + 31 * outputs;
}
export function miningFee(inputs: number, outputs: number, rate: string): number {
  const n = decimal(rate);
  if (n.lt(1) || n.gt(100)) throw new Error('Mining fee rate outside safety limits');
  return asSats(n.times(vsizeEstimate(inputs, outputs)).integerValue(BigNumber.ROUND_CEIL));
}
export function checkMinerFee(totalIn: number, totalOut: number, inputs: number, outputs: number): void {
  const fee = sats(totalIn) - sats(totalOut);
  const size = vsizeEstimate(inputs, outputs);
  if (fee < size || fee > size * 100) throw new Error('Miner fee outside safety limits');
}
export function sweepAmount(available: number, rates: readonly string[]): number {
  sats(available);
  if (rates.length > 9) throw new Error('Too many makers');
  const sum = rates.reduce((a, r) => a.plus(decimal(r)), new Decimal(1));
  let amount = asSats(new Decimal(available).div(sum).integerValue(BigNumber.ROUND_FLOOR));
  while (amount > 0 && new Decimal(amount).plus(rates.reduce((a, r) => a.plus(relativeFee(amount, r)), new Decimal(0))).gt(available))
    amount--;
  return amount;
}

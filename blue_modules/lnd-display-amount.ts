import BigNumber from 'bignumber.js';
import { estimateXbtQuoteAmount, XbtPriceQuote } from './xbt-price';

/** Display only: never pass this unit or a converted estimate to LND RPCs. */
export type LndDisplayUnit = 'XBT' | 'sats' | 'quote';

export function nextLndDisplayUnit(unit: LndDisplayUnit): LndDisplayUnit {
  return unit === 'XBT' ? 'sats' : unit === 'sats' ? 'quote' : 'XBT';
}

export function formatLndAmount(value: number | string, unit: LndDisplayUnit, quote?: XbtPriceQuote | null): string {
  const sats = Number(value);
  if ((typeof value === 'string' && !/^[0-9]+$/.test(value)) || !Number.isSafeInteger(sats) || sats < 0) {
    return 'Amount unavailable';
  }
  if (unit === 'XBT') return new BigNumber(sats).dividedBy(100000000).toFixed() + ' XBT';
  if (unit === 'sats') return new Intl.NumberFormat().format(sats) + ' sats';
  if (!quote) return 'Rate unavailable';
  try {
    const amount = new BigNumber(estimateXbtQuoteAmount(sats, quote));
    // USDC is not USD. Always retain the actual quote currency, including manual USD quotes.
    // A small nonzero payment must never look like a zero-value payment after rounding.
    const formatted = amount.isGreaterThan(0) && amount.isLessThan('0.01') ? '<0.01' : amount.toFormat(2, BigNumber.ROUND_HALF_UP);
    return '≈ ' + formatted + ' ' + quote.currency;
  } catch {
    return 'Rate unavailable';
  }
}

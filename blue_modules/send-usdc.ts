import BigNumber from 'bignumber.js';
import type { BtcUsdcPriceQuote } from './btc-usdc-price';
import type { XbtPriceQuote } from './xbt-price';
import { BitcoinUnit } from '../models/bitcoinUnits';

export type SendAsset = 'BTC' | 'XBT';
export interface SendUsdcQuote {
  asset: SendAsset;
  source: 'neoxex';
  pair: 'BTC_USDC' | 'BTCB2_USDC';
  currency: 'USDC';
  pricePerCoin: string;
  updatedAt: number;
  fetchedAt: number;
}
export interface UsdcSendEntry {
  text: string;
  quote: SendUsdcQuote;
}
const MAX_SATS = '2100000000000000';
const QUOTE_MAX_AGE = 15 * 60 * 1000;
const decimal = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

export function validateSendUsdcQuote(quote: SendUsdcQuote, asset: SendAsset, now = Date.now()): void {
  if (
    !quote ||
    quote.asset !== asset ||
    quote.source !== 'neoxex' ||
    quote.pair !== (asset === 'BTC' ? 'BTC_USDC' : 'BTCB2_USDC') ||
    quote.currency !== 'USDC'
  )
    throw new Error(`A NeoxEX ${asset}/USDC quote is required.`);
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(quote.updatedAt) ||
    !Number.isSafeInteger(quote.fetchedAt) ||
    quote.updatedAt <= 0 ||
    quote.fetchedAt <= 0 ||
    quote.updatedAt > now + 60000 ||
    quote.fetchedAt > now + 60000 ||
    quote.updatedAt > quote.fetchedAt + 60000 ||
    now - quote.updatedAt >= QUOTE_MAX_AGE ||
    now - quote.fetchedAt >= QUOTE_MAX_AGE
  )
    throw new Error('USDC quote is stale. Refresh the quote or enter the coin amount.');
  if (typeof quote.pricePerCoin !== 'string' || quote.pricePerCoin.length > 64 || !decimal.test(quote.pricePerCoin)) {
    throw new Error('Invalid USDC quote.');
  }
  const price = new BigNumber(quote.pricePerCoin);
  if (!price.isFinite() || price.lte(0) || price.gt('1000000000000') || (price.decimalPlaces() ?? 0) > 12) {
    throw new Error('Invalid USDC quote.');
  }
}

export function toSendUsdcQuote(asset: SendAsset, quote: BtcUsdcPriceQuote | XbtPriceQuote | null, now = Date.now()): SendUsdcQuote {
  if (!quote || quote.source !== 'neoxex' || quote.currency !== 'USDC') {
    throw new Error(`NeoxEX ${asset}/USDC price is unavailable.`);
  }
  const btc = 'pricePerBtc' in quote;
  if ((asset === 'BTC') !== btc || (btc && quote.pair !== 'BTC_USDC')) throw new Error('Wrong USDC market.');
  const result: SendUsdcQuote = {
    asset,
    source: 'neoxex',
    pair: asset === 'BTC' ? 'BTC_USDC' : 'BTCB2_USDC',
    currency: 'USDC',
    pricePerCoin: btc ? quote.pricePerBtc : quote.pricePerXbt,
    updatedAt: quote.updatedAt,
    fetchedAt: quote.fetchedAt ?? 0,
  };
  validateSendUsdcQuote(result, asset, now);
  return result;
}

export function usdcToSendSats(text: string, quote: SendUsdcQuote, asset: SendAsset, now = Date.now()): string {
  validateSendUsdcQuote(quote, asset, now);
  if (text.length > 64 || !decimal.test(text)) throw new Error('Enter a valid USDC amount.');
  const sats = new BigNumber(text).times(100000000).dividedToIntegerBy(quote.pricePerCoin);
  if (!sats.isFinite() || sats.lt(0) || sats.gt(MAX_SATS)) throw new Error('Amount is out of range.');
  return sats.toFixed(0);
}

export function sendSatsToUsdc(sats: string, quote: SendUsdcQuote, asset: SendAsset, now = Date.now()): string {
  validateSendUsdcQuote(quote, asset, now);
  const amount = new BigNumber(sats);
  if (!amount.isInteger() || amount.lt(0) || amount.gt(MAX_SATS)) throw new Error('Enter a valid satoshi amount.');
  return amount.div(100000000).times(quote.pricePerCoin).toFixed();
}

/** Recheck the frozen conversion at review/construction, including after async work. */
export function validateUsdcSendRecipient(
  recipient: {
    usdcRefreshing?: boolean;
    usdcEntry?: UsdcSendEntry;
    unit: BitcoinUnit;
    amount?: string | number;
    amountSats?: string | number;
  },
  asset: SendAsset,
  now = Date.now(),
): void {
  if (recipient.usdcRefreshing) throw new Error('Wait for the USDC quote to finish refreshing.');
  if (!recipient.usdcEntry) return;
  const expected = usdcToSendSats(recipient.usdcEntry.text, recipient.usdcEntry.quote, asset, now);
  if (
    recipient.unit !== BitcoinUnit.SATS ||
    !new BigNumber(recipient.amount ?? '').eq(expected) ||
    !new BigNumber(recipient.amountSats ?? '').eq(expected)
  )
    throw new Error('USDC conversion changed. Review the amount again.');
}

import BigNumber from 'bignumber.js';
import { BtcUsdcPriceQuote } from './btc-usdc-price';
export function usdcToSendSats(text: string, quote: BtcUsdcPriceQuote, now = Date.now()): string {
  if (
    quote.pair !== 'BTC_USDC' ||
    quote.currency !== 'USDC' ||
    !Number.isSafeInteger(quote.updatedAt) ||
    now - quote.updatedAt >= 900000 ||
    quote.updatedAt > now + 60000
  )
    throw new Error('A fresh BTC/USDC quote is required.');
  if (text.length > 40 || !/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(text)) throw new Error('Enter a valid USDC amount.');
  const price = new BigNumber(quote.pricePerBtc);
  if (!price.isFinite() || !price.gt(0)) throw new Error('Invalid quote.');
  const sats = new BigNumber(text).times(100000000).div(price).integerValue(BigNumber.ROUND_DOWN);
  if (!sats.isFinite() || sats.lt(0) || sats.gt('2100000000000000')) throw new Error('Amount is out of range.');
  return sats.toFixed(0);
}

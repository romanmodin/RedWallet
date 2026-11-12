import { sendSatsToUsdc, toSendUsdcQuote, usdcToSendSats, validateUsdcSendRecipient, SendAsset } from '../../blue_modules/send-usdc';
import { BitcoinUnit } from '../../models/bitcoinUnits';
const now = 1800000000000;
const btc = {
  source: 'neoxex' as const,
  pair: 'BTC_USDC' as const,
  currency: 'USDC' as const,
  pricePerBtc: '73300',
  updatedAt: now,
  fetchedAt: now,
};
const xbt = {
  source: 'neoxex' as const,
  currency: 'USDC',
  pricePerXbt: '275',
  updatedAt: now,
  fetchedAt: now,
};
const quote = toSendUsdcQuote('BTC', btc, now);

test('whole sat conversion rounds down without rounding an almost-integral quotient up', () => {
  expect(usdcToSendSats('7330', quote, 'BTC', now)).toBe('10000000');
  expect(usdcToSendSats('1', quote, 'BTC', now)).toBe('1364');
  expect(usdcToSendSats('0.00001', quote, 'BTC', now)).toBe('0');
  expect(usdcToSendSats('999999999999.999999999999', { ...quote, pricePerCoin: '1000000000000' }, 'BTC', now)).toBe('99999999');
});
test('XBT and SHA-256 use their own USDC markets', () => {
  expect(usdcToSendSats('275', toSendUsdcQuote('XBT', xbt, now), 'XBT', now)).toBe('100000000');
  expect(() => usdcToSendSats('275', quote, 'XBT', now)).toThrow(/quote is required/);
  expect(() => toSendUsdcQuote('BTC', xbt, now)).toThrow(/market/);
  expect(() => toSendUsdcQuote('XBT', btc, now)).toThrow(/market/);
  expect(() => toSendUsdcQuote('XBT', { ...xbt, source: 'manual' }, now)).toThrow(/unavailable/);
  expect(() => toSendUsdcQuote('XBT', { ...xbt, currency: 'USD' }, now)).toThrow(/unavailable/);
});
test.each(['-1', '1e3', 'Infinity', 'NaN', '', '1.2.3', '999999999999999999'])('reject invalid or oversized amount %s', text => {
  expect(() => usdcToSendSats(text, quote, 'BTC', now)).toThrow();
});
test('reject stale, future, missing timestamps and invalid prices', () => {
  for (const patch of [
    { updatedAt: now - 900000 },
    { fetchedAt: now - 900000 },
    { updatedAt: now + 60001 },
    { fetchedAt: now + 60001 },
    { updatedAt: 0 },
    { fetchedAt: NaN },
    { pair: 'BTCB2_USDC' },
    { pricePerCoin: '0' },
    { pricePerCoin: '1e3' },
    { pricePerCoin: '1000000000001' },
  ]) {
    expect(() => usdcToSendSats('1', { ...quote, ...patch } as any, 'BTC', now)).toThrow();
  }
});
test.each<SendAsset>(['BTC', 'XBT'])('unedited %s rotation retains exact sats including the maximum', asset => {
  const q = toSendUsdcQuote(asset, asset === 'BTC' ? btc : xbt, now);
  for (const sats of ['0', '1', '12345678', '2100000000000000']) {
    expect(usdcToSendSats(sendSatsToUsdc(sats, q, asset, now), q, asset, now)).toBe(sats);
  }
});
test('recipient review rechecks the amount, chain, freshness and pending refresh', () => {
  const recipient = {
    unit: BitcoinUnit.SATS,
    amount: '1364',
    amountSats: 1364,
    usdcEntry: { text: '1', quote },
  };
  expect(() => validateUsdcSendRecipient(recipient, 'BTC', now)).not.toThrow();
  expect(() => validateUsdcSendRecipient(recipient, 'XBT', now)).toThrow();
  expect(() => validateUsdcSendRecipient(recipient, 'BTC', now + 900000)).toThrow(/stale/);
  for (const change of [{ amount: '1365' }, { amountSats: 1365 }, { unit: BitcoinUnit.BTC }, { amount: 'MAX' }]) {
    expect(() => validateUsdcSendRecipient({ ...recipient, ...change }, 'BTC', now)).toThrow(/changed/);
  }
  expect(() => validateUsdcSendRecipient({ ...recipient, usdcRefreshing: true }, 'BTC', now)).toThrow(/refreshing/);
  expect(() => validateUsdcSendRecipient({ unit: BitcoinUnit.BTC, amount: '0.1' }, 'BTC', now + 900000)).not.toThrow();
});

import { usdcToSendSats } from '../../blue_modules/send-usdc';
const now = 1800000000000;
const quote = {
  source: 'neoxex' as const,
  pair: 'BTC_USDC' as const,
  currency: 'USDC' as const,
  pricePerBtc: '73300',
  updatedAt: now,
  fetchedAt: now,
};
test('exact amount and whole sat rounding', () => {
  expect(usdcToSendSats('7330', quote, now)).toBe('10000000');
  expect(usdcToSendSats('1', quote, now)).toBe('1364');
  expect(usdcToSendSats('0.00001', quote, now)).toBe('0');
});
test.each(['-1', '1e3', 'Infinity', 'NaN', '', '1.2.3', '999999999999999999'])('reject invalid or oversized amount %s', text => {
  expect(() => usdcToSendSats(text, quote, now)).toThrow();
});
test('reject stale or wrong market and invalid price', () => {
  expect(() => usdcToSendSats('1', quote, now + 900000)).toThrow();
  expect(() => usdcToSendSats('1', { ...quote, pricePerBtc: '0' }, now)).toThrow();
  expect(() => usdcToSendSats('1', { ...quote, pair: 'BTCB2_USDC' } as any, now)).toThrow();
});

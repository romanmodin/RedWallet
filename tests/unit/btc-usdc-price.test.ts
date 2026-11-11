import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BTC_USDC_PRICE_STORAGE_KEY,
  createNeoxexBtcUsdcPriceQuote,
  formatBtcUsdcEstimate,
  loadBtcUsdcPriceQuote,
  saveBtcUsdcPriceQuote,
} from '../../blue_modules/btc-usdc-price';
import { fetchNeoxexBtcPrice, NEOXEX_BTC_PRICE_ENDPOINT } from '../../blue_modules/neoxex-price';

const NOW = Date.parse('2026-11-10T12:45:00Z');
const TRADE = { trade_id: 'public-market-fixture', price: 73200.01, executed_at: '2026-11-10T12:44:57.872Z' };
const payload = (pair = 'BTC_USDC') => ({ success: true, pair, trades: [TRADE] });
const response = (data: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(data) });
beforeEach(async () => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

test('requests only the separate SHA-256 USDC pair and retains the actual trade time', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(payload()) as any);
  const q = await fetchNeoxexBtcPrice();
  expect(q).toEqual({
    source: 'neoxex',
    pair: 'BTC_USDC',
    currency: 'USDC',
    pricePerBtc: '73200.01',
    updatedAt: Date.parse(TRADE.executed_at),
    fetchedAt: NOW,
  });
  expect(fetch).toHaveBeenCalledWith(NEOXEX_BTC_PRICE_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    signal: expect.any(AbortSignal),
  });
  expect(NEOXEX_BTC_PRICE_ENDPOINT).toBe('https://neoxa.exchange/api/exchange/trades/BTC_USDC?limit=1');
});
test.each(['BTCB2_USDC', 'XBT_USDC', 'BTC_USD', 'ETH_USDC'])('rejects wrong market %s without using a different quote', async pair => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(payload(pair)) as any);
  await expect(fetchNeoxexBtcPrice()).rejects.toThrow(/invalid BTC\/USDC/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('uses exact satoshi arithmetic and rounds the displayed USDC value half up', () => {
  const q = createNeoxexBtcUsdcPriceQuote('73200.01', NOW);
  expect(formatBtcUsdcEstimate(50_000_000, q)).toBe('36,600.01 USDC');
  expect(formatBtcUsdcEstimate(1, q)).toBe('0.00 USDC');
  expect(formatBtcUsdcEstimate(0, q)).toBe('0.00 USDC');
  expect(() => formatBtcUsdcEstimate(1.1, q)).toThrow();
  expect(() => formatBtcUsdcEstimate(Number.MAX_SAFE_INTEGER + 1, q)).toThrow();
  expect(() => formatBtcUsdcEstimate(1, { ...q, pair: 'BTCB2_USDC' } as any)).toThrow();
});
test('persists SHA-256 quotes independently and removes invalid caches without touching XBT', async () => {
  await AsyncStorage.setItem('xbtDisplayPrice.v1', 'preserve-XBT');
  const q = createNeoxexBtcUsdcPriceQuote('50000', NOW - 3600000);
  await saveBtcUsdcPriceQuote(q);
  expect(await loadBtcUsdcPriceQuote()).toEqual(q);
  await AsyncStorage.setItem(BTC_USDC_PRICE_STORAGE_KEY, JSON.stringify({ ...q, pair: 'BTCB2_USDC' }));
  expect(await loadBtcUsdcPriceQuote()).toBeNull();
  expect(await AsyncStorage.getItem(BTC_USDC_PRICE_STORAGE_KEY)).toBeNull();
  expect(await AsyncStorage.getItem('xbtDisplayPrice.v1')).toBe('preserve-XBT');
});
test.each(['0', '-1', 'NaN', '1e3', '1,000', '0.0000000000001', '1000000000001'])('rejects unusable price %s', price => {
  expect(() => createNeoxexBtcUsdcPriceQuote(price, NOW)).toThrow();
});

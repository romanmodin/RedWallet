import AsyncStorage from '@react-native-async-storage/async-storage';
import BigNumber from 'bignumber.js';

export const BTC_USDC_PRICE_STORAGE_KEY = 'btcUsdcDisplayPrice.v1';
export const BTC_USDC_PAIR = 'BTC_USDC';
export interface BtcUsdcPriceQuote {
  source: 'neoxex';
  pair: typeof BTC_USDC_PAIR;
  currency: 'USDC';
  pricePerBtc: string;
  updatedAt: number;
  fetchedAt: number;
}

/** A display-only SHA-256 quote; it never enters spending or the XBT rate cache. */
export function createNeoxexBtcUsdcPriceQuote(pricePerBtc: string, tradeTime: number, fetchedAt = Date.now()): BtcUsdcPriceQuote {
  if (typeof pricePerBtc !== 'string' || pricePerBtc.length > 64 || !/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(pricePerBtc)) {
    throw new Error('Invalid BTC/USDC price.');
  }
  const price = new BigNumber(pricePerBtc);
  if (!price.isFinite() || !price.isGreaterThan(0) || price.isGreaterThan('1000000000000') || (price.decimalPlaces() ?? 0) > 12) {
    throw new Error('Invalid BTC/USDC price.');
  }
  const now = Date.now();
  if (
    !Number.isSafeInteger(tradeTime) ||
    tradeTime <= 0 ||
    tradeTime > now + 60000 ||
    !Number.isSafeInteger(fetchedAt) ||
    fetchedAt <= 0 ||
    fetchedAt > now + 60000 ||
    fetchedAt < tradeTime - 60000 ||
    !Number.isFinite(new Date(tradeTime).getTime()) ||
    !Number.isFinite(new Date(fetchedAt).getTime())
  )
    throw new Error('Invalid BTC/USDC quote time.');
  return {
    source: 'neoxex',
    pair: BTC_USDC_PAIR,
    currency: 'USDC',
    pricePerBtc: price.toFixed(),
    updatedAt: tradeTime,
    fetchedAt,
  };
}

function validateQuote(value: unknown): BtcUsdcPriceQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid BTC/USDC quote.');
  const q = value as Partial<BtcUsdcPriceQuote>;
  if (
    q.source !== 'neoxex' ||
    q.pair !== BTC_USDC_PAIR ||
    q.currency !== 'USDC' ||
    typeof q.pricePerBtc !== 'string' ||
    typeof q.updatedAt !== 'number' ||
    typeof q.fetchedAt !== 'number'
  ) {
    throw new Error('Invalid BTC/USDC quote.');
  }
  return createNeoxexBtcUsdcPriceQuote(q.pricePerBtc, q.updatedAt, q.fetchedAt);
}

let storageQueue: Promise<void> = Promise.resolve();
function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation, operation);
  storageQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}
export function loadBtcUsdcPriceQuote(): Promise<BtcUsdcPriceQuote | null> {
  return withStorage(async () => {
    try {
      const raw = await AsyncStorage.getItem(BTC_USDC_PRICE_STORAGE_KEY);
      if (raw == null) return null;
      try {
        return validateQuote(JSON.parse(raw));
      } catch {
        await AsyncStorage.removeItem(BTC_USDC_PRICE_STORAGE_KEY);
        return null;
      }
    } catch {
      return null;
    }
  });
}
export function saveBtcUsdcPriceQuote(quote: BtcUsdcPriceQuote): Promise<void> {
  const validated = validateQuote(quote);
  return withStorage(() => AsyncStorage.setItem(BTC_USDC_PRICE_STORAGE_KEY, JSON.stringify(validated)));
}
export function formatBtcUsdcEstimate(satoshis: number, quote: BtcUsdcPriceQuote): string {
  if (!Number.isSafeInteger(satoshis)) throw new Error('Invalid BTC satoshi balance.');
  const q = validateQuote(quote);
  return `${new BigNumber(satoshis).dividedBy(100000000).multipliedBy(q.pricePerBtc).toFormat(2, BigNumber.ROUND_HALF_UP)} USDC`;
}

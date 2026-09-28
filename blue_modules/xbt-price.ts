import BigNumber from 'bignumber.js';
import DefaultPreference from 'react-native-default-preference';
import { GROUP_IO_BLUEWALLET } from './currency';

export const XBT_PRICE_STORAGE_KEY = 'xbtDisplayPrice.v1';
export type XbtPriceSource = 'manual' | 'neoxex';
export interface XbtPriceQuote {
  source: XbtPriceSource;
  pricePerXbt: string;
  currency: string;
  updatedAt: number;
  fetchedAt?: number;
}

/** Manual display quotes never enter transaction construction or the legacy BTC rate cache. */
export function createManualXbtPriceQuote(pricePerXbt: string, currency: string, now = Date.now()): XbtPriceQuote {
  const text = pricePerXbt.trim();
  if (text.length > 64 || !/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(text)) {
    throw new Error('Enter a positive decimal price for 1 XBT.');
  }
  const price = new BigNumber(text);
  if (!price.isFinite() || !price.isGreaterThan(0) || price.isGreaterThan('1000000000000') || (price.decimalPlaces() ?? 0) > 12) {
    throw new Error('Price must be above zero, at most 1 trillion, with up to 12 decimal places.');
  }
  const quoteCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,11}$/.test(quoteCurrency)) {
    throw new Error('Use a quote label of 2–12 letters or numbers, starting with a letter (for example USD or USDC).');
  }
  if (!Number.isSafeInteger(now) || now <= 0 || !Number.isFinite(new Date(now).getTime()) || now > Date.now() + 60000) {
    throw new Error('Invalid quote update time.');
  }
  return { source: 'manual', pricePerXbt: price.toFixed(), currency: quoteCurrency, updatedAt: now };
}

/** NeoxEX quotes are USDC per XBT; their update time is the trade time, not request time. */
export function createNeoxexXbtPriceQuote(pricePerXbt: string, tradeTime: number, fetchedAt = Date.now()): XbtPriceQuote {
  const quote = createManualXbtPriceQuote(pricePerXbt, 'USDC', tradeTime);
  if (
    !Number.isSafeInteger(fetchedAt) ||
    fetchedAt <= 0 ||
    fetchedAt < tradeTime - 60000 ||
    !Number.isFinite(new Date(fetchedAt).getTime()) ||
    fetchedAt > Date.now() + 60000
  ) {
    throw new Error('Invalid quote fetch time.');
  }
  return { ...quote, source: 'neoxex', fetchedAt };
}

function validateStoredQuote(value: unknown): XbtPriceQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid XBT quote.');
  const quote = value as Partial<XbtPriceQuote>;
  if (typeof quote.pricePerXbt !== 'string' || typeof quote.currency !== 'string' || typeof quote.updatedAt !== 'number') {
    throw new Error('Invalid XBT quote.');
  }
  if (quote.source === 'manual') return createManualXbtPriceQuote(quote.pricePerXbt, quote.currency, quote.updatedAt);
  if (quote.source === 'neoxex' && quote.currency === 'USDC' && typeof quote.fetchedAt === 'number') {
    return createNeoxexXbtPriceQuote(quote.pricePerXbt, quote.updatedAt, quote.fetchedAt);
  }
  throw new Error('Unsupported XBT quote source.');
}

// Serialize all reads and writes: an initial invalid-cache cleanup must finish before a new save.
let storageQueue: Promise<void> = Promise.resolve();
function withPriceStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation, operation);
  storageQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

export function loadXbtPriceQuote(): Promise<XbtPriceQuote | null> {
  return withPriceStorage(async () => {
    try {
      await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
      const saved = await DefaultPreference.get(XBT_PRICE_STORAGE_KEY);
      if (saved == null || saved === '') return null;
      try {
        if (typeof saved !== 'string') throw new Error('Invalid XBT quote storage.');
        return validateStoredQuote(JSON.parse(saved));
      } catch {
        await DefaultPreference.clear(XBT_PRICE_STORAGE_KEY).catch(() => {});
        return null;
      }
    } catch {
      return null;
    }
  });
}

export function saveXbtPriceQuote(quote: XbtPriceQuote): Promise<void> {
  const validated = validateStoredQuote(quote);
  return withPriceStorage(async () => {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.set(XBT_PRICE_STORAGE_KEY, JSON.stringify(validated));
  });
}

export function clearSavedXbtPriceQuote(): Promise<void> {
  return withPriceStorage(async () => {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.clear(XBT_PRICE_STORAGE_KEY);
  });
}

/** Exact decimal arithmetic; satoshi balances must be safe integers. */
export function estimateXbtQuoteAmount(satoshis: number, quote: XbtPriceQuote): string {
  if (!Number.isSafeInteger(satoshis)) throw new Error('Invalid satoshi balance.');
  const validated = validateStoredQuote(quote);
  return new BigNumber(satoshis).dividedBy(100000000).multipliedBy(validated.pricePerXbt).toFixed();
}

export function formatXbtQuoteEstimate(satoshis: number, quote: XbtPriceQuote): string {
  const amount = new BigNumber(estimateXbtQuoteAmount(satoshis, quote));
  // At most 20 decimal places: 8 satoshi places plus the 12 allowed quote places.
  return `${amount.toFormat(Math.max(2, amount.decimalPlaces() ?? 0))} ${quote.currency}`;
}

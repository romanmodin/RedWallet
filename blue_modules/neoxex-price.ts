import { createNeoxexBtcUsdcPriceQuote, BtcUsdcPriceQuote, BTC_USDC_PAIR } from './btc-usdc-price';
import { createNeoxexXbtPriceQuote, XbtPriceQuote } from './xbt-price';

// NeoxEX identifies Bitcoin BLAKE2b (site symbol XBT) by API token BTCB2.
// https://neoxa.exchange/api-docs: public recent trades, newest first.
// This exact USDC pair is intentional: ordinary BTC or generic XBT tickers are not interchangeable.
export const NEOXEX_XBT_PAIR = 'BTCB2_USDC';
export const NEOXEX_PRICE_ENDPOINT = 'https://neoxa.exchange/api/exchange/trades/BTCB2_USDC?limit=1';
export const NEOXEX_BTC_PRICE_ENDPOINT = 'https://neoxa.exchange/api/exchange/trades/BTC_USDC?limit=1';

type Market<T> = {
  pair: string;
  endpoint: string;
  label: string;
  createQuote: (price: string, tradeTime: number, fetchedAt: number) => T;
};
const XBT_MARKET: Market<XbtPriceQuote> = {
  pair: NEOXEX_XBT_PAIR,
  endpoint: NEOXEX_PRICE_ENDPOINT,
  label: 'XBT',
  createQuote: createNeoxexXbtPriceQuote,
};
const BTC_MARKET: Market<BtcUsdcPriceQuote> = {
  pair: BTC_USDC_PAIR,
  endpoint: NEOXEX_BTC_PRICE_ENDPOINT,
  label: 'BTC',
  createQuote: createNeoxexBtcUsdcPriceQuote,
};

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARACTERS = 16_384;
const MAX_FUTURE_SKEW_MS = 60_000;

class NeoxexPriceError extends Error {}

function invalidQuote(label: string): never {
  throw new NeoxexPriceError(`NeoxEX returned invalid ${label}/USDC price data.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readTradeTime(value: unknown, fetchedAt: number, label: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return invalidQuote(label);
  }
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > fetchedAt + MAX_FUTURE_SKEW_MS) {
    return invalidQuote(label);
  }
  // Date.parse normalizes some invalid calendar dates instead of rejecting them.
  if (new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) return invalidQuote(label);
  return timestamp;
}

function priceAsDecimal(value: unknown, label: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000_000) return invalidQuote(label);
  const shortest = String(value);
  if (!shortest.includes('e')) return shortest;
  const decimal = value.toFixed(12).replace(/\.?0+$/, '');
  // Match the shared quote precision without silently rounding the exchange price.
  if (Number(decimal) !== value) return invalidQuote(label);
  return decimal;
}

async function requestQuote<T>(signal: AbortSignal, market: Market<T>): Promise<T> {
  const label = market.label;
  const response = await globalThis.fetch(market.endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  if (response.status === 429) throw new NeoxexPriceError('NeoxEX rate limit reached. Try refreshing later.');
  if (!response.ok) throw new NeoxexPriceError('NeoxEX price is unavailable. Try refreshing later.');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_CHARACTERS)) {
    return invalidQuote(label);
  }
  // React Native does not expose a portable streaming reader; cap declared and decoded size.
  const body = await response.text();
  if (body.length > MAX_RESPONSE_CHARACTERS) return invalidQuote(label);
  const data: unknown = JSON.parse(body);
  if (!isRecord(data) || data.success !== true || data.pair !== market.pair || !Array.isArray(data.trades) || data.trades.length !== 1) {
    return invalidQuote(label);
  }
  const trade: unknown = data.trades[0];
  if (!isRecord(trade) || typeof trade.trade_id !== 'string' || trade.trade_id.length === 0 || trade.trade_id.length > 128) {
    return invalidQuote(label);
  }
  const fetchedAt = Date.now();
  const tradeTime = readTradeTime(trade.executed_at, fetchedAt, label);
  try {
    // Preserve the actual trade time even when old; the UI labels its age/staleness.
    return market.createQuote(priceAsDecimal(trade.price, label), tradeTime, fetchedAt);
  } catch {
    return invalidQuote(label);
  }
}

/** Explicit, display-only refresh. Never polls, persists, accesses wallet data, or falls back to another market. */
async function fetchMarket<T>(market: Market<T>): Promise<T> {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(() => {
      reject(new NeoxexPriceError('NeoxEX price request timed out. Try refreshing later.'));
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    // Keep the deadline and cancellation active through response-body reading.
    return await Promise.race([requestQuote(controller.signal, market), timedOut]);
  } catch (error) {
    if (error instanceof NeoxexPriceError) throw error;
    throw new NeoxexPriceError('NeoxEX price is unavailable. Try refreshing later.');
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    controller.abort();
  }
}

export const fetchNeoxexPrice = (): Promise<XbtPriceQuote> => fetchMarket(XBT_MARKET);
export const fetchNeoxexBtcPrice = (): Promise<BtcUsdcPriceQuote> => fetchMarket(BTC_MARKET);

import { createNeoxexXbtPriceQuote, XbtPriceQuote } from './xbt-price';

// NeoxEX identifies Bitcoin BLAKE2b (site symbol XBT) by API token BTCB2.
// https://neoxa.exchange/api-docs: public recent trades, newest first.
// This exact USDC pair is intentional: ordinary BTC or generic XBT tickers are not interchangeable.
export const NEOXEX_XBT_PAIR = 'BTCB2_USDC';
export const NEOXEX_PRICE_ENDPOINT = 'https://neoxa.exchange/api/exchange/trades/BTCB2_USDC?limit=1';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARACTERS = 16_384;
const MAX_FUTURE_SKEW_MS = 60_000;

class NeoxexPriceError extends Error {}

function invalidQuote(): never {
  throw new NeoxexPriceError('NeoxEX returned invalid XBT/USDC price data.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readTradeTime(value: unknown, fetchedAt: number): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return invalidQuote();
  }
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > fetchedAt + MAX_FUTURE_SKEW_MS) {
    return invalidQuote();
  }
  // Date.parse normalizes some invalid calendar dates instead of rejecting them.
  if (new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) return invalidQuote();
  return timestamp;
}

function priceAsDecimal(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000_000) return invalidQuote();
  const shortest = String(value);
  if (!shortest.includes('e')) return shortest;
  const decimal = value.toFixed(12).replace(/\.?0+$/, '');
  // Match the shared quote precision without silently rounding the exchange price.
  if (Number(decimal) !== value) return invalidQuote();
  return decimal;
}

async function requestQuote(signal: AbortSignal): Promise<XbtPriceQuote> {
  const response = await globalThis.fetch(NEOXEX_PRICE_ENDPOINT, {
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
    return invalidQuote();
  }
  // React Native does not expose a portable streaming reader; cap declared and decoded size.
  const body = await response.text();
  if (body.length > MAX_RESPONSE_CHARACTERS) return invalidQuote();
  const data: unknown = JSON.parse(body);
  if (
    !isRecord(data) ||
    data.success !== true ||
    data.pair !== NEOXEX_XBT_PAIR ||
    !Array.isArray(data.trades) ||
    data.trades.length !== 1
  ) {
    return invalidQuote();
  }
  const trade: unknown = data.trades[0];
  if (!isRecord(trade) || typeof trade.trade_id !== 'string' || trade.trade_id.length === 0 || trade.trade_id.length > 128) {
    return invalidQuote();
  }
  const fetchedAt = Date.now();
  const tradeTime = readTradeTime(trade.executed_at, fetchedAt);
  try {
    // Preserve the actual trade time even when old; the UI labels its age/staleness.
    return createNeoxexXbtPriceQuote(priceAsDecimal(trade.price), tradeTime, fetchedAt);
  } catch {
    return invalidQuote();
  }
}

/** Explicit, display-only refresh. Never polls, persists, accesses wallet data, or falls back to another market. */
export async function fetchNeoxexPrice(): Promise<XbtPriceQuote> {
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
    return await Promise.race([requestQuote(controller.signal), timedOut]);
  } catch (error) {
    if (error instanceof NeoxexPriceError) throw error;
    throw new NeoxexPriceError('NeoxEX price is unavailable. Try refreshing later.');
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    controller.abort();
  }
}

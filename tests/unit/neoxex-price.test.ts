import { fetchNeoxexPrice, NEOXEX_PRICE_ENDPOINT } from '../../blue_modules/neoxex-price';

jest.mock('../../blue_modules/currency', () => ({ GROUP_IO_BLUEWALLET: 'group.com.romanmodin.redwallet' }));

const NOW = Date.parse('2026-09-28T18:32:19.000Z');
// Public response observed at /api/exchange/trades/BTCB2_USDC?limit=1 on 2026-09-28.
// CI uses this fixed sample and never contacts the exchange.
const TRADE = {
  trade_id: 'TRD-MULKZQS7-54B609EA',
  side: 'sell',
  quantity: 0.2,
  price: 342.83,
  total: 68.566,
  executed_at: '2026-09-28T18:28:49.866Z',
};
const payload = (trade: Record<string, unknown> = TRADE) => ({ success: true, pair: 'BTCB2_USDC', trades: [trade] });

function response(body: unknown = payload(), status = 200, contentLength: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: jest.fn(() => contentLength) },
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

describe('NeoxEX XBT display quote', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uses the verified Bitcoin BLAKE2b pair and preserves USDC identity and actual trade time', async () => {
    fetchMock.mockResolvedValue(response());
    await expect(fetchNeoxexPrice()).resolves.toEqual({
      source: 'neoxex',
      pricePerXbt: '342.83',
      currency: 'USDC',
      updatedAt: Date.parse(TRADE.executed_at),
      fetchedAt: NOW,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(NEOXEX_PRICE_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(NEOXEX_PRICE_ENDPOINT).toBe('https://neoxa.exchange/api/exchange/trades/BTCB2_USDC?limit=1');
  });

  it('keeps an old trade old so a successful refresh cannot relabel it as fresh', async () => {
    const executedAt = '2026-09-20T00:00:00.000Z';
    fetchMock.mockResolvedValue(response(payload({ ...TRADE, executed_at: executedAt })));
    const quote = await fetchNeoxexPrice();
    expect(quote.updatedAt).toBe(Date.parse(executedAt));
    expect(quote.fetchedAt).toBe(NOW);
    expect(NOW - quote.updatedAt).toBeGreaterThan(15 * 60 * 1000);
  });

  it('preserves small numeric prices without scientific notation or rounding', async () => {
    fetchMock.mockResolvedValue(response(payload({ ...TRADE, price: 0.00000001 })));
    expect((await fetchNeoxexPrice()).pricePerXbt).toBe('0.00000001');
  });

  it.each([
    ['unsuccessful response', { ...payload(), success: false }],
    ['missing success', { ...payload(), success: undefined }],
    ['ordinary BTC', { ...payload(), pair: 'BTC_USDC' }],
    ['ambiguous XBT symbol', { ...payload(), pair: 'XBT_USDC' }],
    ['USD instead of USDC', { ...payload(), pair: 'BTCB2_USD' }],
    ['missing pair', { ...payload(), pair: undefined }],
    ['empty market', { ...payload(), trades: [] }],
    ['missing trades', { ...payload(), trades: undefined }],
    ['multiple trades despite limit', { ...payload(), trades: [TRADE, TRADE] }],
    ['invalid trade object', { ...payload(), trades: [null] }],
    ['missing trade ID', payload({ ...TRADE, trade_id: undefined })],
    ['empty trade ID', payload({ ...TRADE, trade_id: '' })],
    ['unbounded trade ID', payload({ ...TRADE, trade_id: 'x'.repeat(129) })],
    ['zero price', payload({ ...TRADE, price: 0 })],
    ['negative price', payload({ ...TRADE, price: -1 })],
    ['missing price', payload({ ...TRADE, price: undefined })],
    ['string price', payload({ ...TRADE, price: '342.83' })],
    ['null price', payload({ ...TRADE, price: null })],
    ['excessive price', payload({ ...TRADE, price: 1_000_000_000_001 })],
    ['excess decimal precision', payload({ ...TRADE, price: 1.0000000000001 })],
    ['tiny price requiring rounding', payload({ ...TRADE, price: 1e-13 })],
    ['missing execution time', payload({ ...TRADE, executed_at: undefined })],
    ['numeric execution time', payload({ ...TRADE, executed_at: NOW })],
    ['invalid execution time', payload({ ...TRADE, executed_at: 'not-a-date' })],
    ['invalid calendar date', payload({ ...TRADE, executed_at: '2026-02-30T00:00:00.000Z' })],
    ['unqualified local time', payload({ ...TRADE, executed_at: '2026-09-28T18:28:49' })],
    ['execution time beyond clock tolerance', payload({ ...TRADE, executed_at: new Date(NOW + 60_001).toISOString() })],
  ])('rejects %s with no fallback or retry', async (_label, data) => {
    fetchMock.mockResolvedValue(response(data));
    await expect(fetchNeoxexPrice()).rejects.toThrow(/invalid XBT\/USDC/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['malformed JSON', '{'],
    ['nonfinite numeric price', JSON.stringify(payload()).replace('"price":342.83', '"price":1e999')],
    ['oversized decoded body', ' '.repeat(16_385)],
  ])('rejects %s', async (_label, body) => {
    const result = response();
    result.text.mockResolvedValue(body);
    fetchMock.mockResolvedValue(result);
    await expect(fetchNeoxexPrice()).rejects.toThrow(/invalid|unavailable/);
  });

  it('rejects a declared oversized response before reading its body', async () => {
    const result = response(payload(), 200, '16385');
    fetchMock.mockResolvedValue(result);
    await expect(fetchNeoxexPrice()).rejects.toThrow(/invalid/);
    expect(result.text).not.toHaveBeenCalled();
  });

  it.each([
    [429, /rate limit/],
    [503, /unavailable/],
  ])('rejects HTTP %i without retries', async (status, message) => {
    const result = response(payload(), status);
    fetchMock.mockResolvedValue(result);
    await expect(fetchNeoxexPrice()).rejects.toThrow(message);
    expect(result.text).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports network failure without leaking the transport error or using another source', async () => {
    fetchMock.mockRejectedValue(new Error('private transport internals'));
    await expect(fetchNeoxexPrice()).rejects.toThrow('NeoxEX price is unavailable. Try refreshing later.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['headers', 'body'])('aborts stalled %s and rejects at the full-request 10-second deadline', async stage => {
    // Leave the React Native Promise scheduler running while controlling only this deadline.
    const realSetTimeout = globalThis.setTimeout;
    let onDeadline!: () => void;
    const timer = jest.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (delay === 10_000) {
        onDeadline = callback as () => void;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(callback, delay, ...args);
    });
    const pending = new Promise<never>(() => {});
    let readBody: jest.Mock | undefined;
    if (stage === 'headers') {
      fetchMock.mockReturnValue(pending);
    } else {
      const result = response();
      result.text.mockReturnValue(pending);
      readBody = result.text;
      fetchMock.mockResolvedValue(result);
    }
    const quotePromise = fetchNeoxexPrice();
    await Promise.resolve();
    if (stage === 'body') expect(readBody).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 10_000);
    onDeadline();
    await expect(quotePromise).rejects.toThrow(/timed out/);
    expect(signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

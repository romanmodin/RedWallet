import { NativeModules } from 'react-native';
import { nativeBridgeRequest } from '../../blue_modules/lightning-bridge/http';
import { bridgeQuoteResponseTimeoutMs, KilombinoProvider } from '../../blue_modules/lightning-bridge/provider';

const url = 'https://bridge.kilombino.com/api/info';
const original = NativeModules.XBTLightningBridge;
const native = { bridgeRequest: jest.fn(), cancelBridgeRequest: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.XBTLightningBridge = native;
  native.bridgeRequest.mockResolvedValue({
    url,
    status: 200,
    body: '{"dirs":{"toSHA256":{"open":true,"rate":1,"spread":0.02,"min_sat":1,"max_sat":100}}}',
  });
});
afterAll(() => {
  NativeModules.XBTLightningBridge = original;
});

test('production provider uses isolated native transport, with no shared fetch fallback', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  try {
    expect((await new KilombinoProvider().info(new AbortController().signal)).open).toBe(true);
    expect(native.bridgeRequest).toHaveBeenCalledWith(expect.any(String), url, 'GET', '');
    expect(fetchSpy).not.toHaveBeenCalled();
    NativeModules.XBTLightningBridge = {};
    await expect(nativeBridgeRequest(url, {})).rejects.toThrow('secure iPhone transport');
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});

test('pre-canceled requests never enter native networking', async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(nativeBridgeRequest(url, { signal: abort.signal })).rejects.toThrow('canceled');
  expect(native.bridgeRequest).not.toHaveBeenCalled();
});

test('abort cancels the same native request and ignores a late response', async () => {
  let completeResponse!: (result: unknown) => void;
  native.bridgeRequest.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        completeResponse = resolve;
      }),
  );
  const abort = new AbortController();
  const request = nativeBridgeRequest(url, { signal: abort.signal });
  abort.abort();
  await expect(request).rejects.toThrow('canceled');
  expect(native.cancelBridgeRequest).toHaveBeenCalledWith(native.bridgeRequest.mock.calls[0][0]);
  completeResponse({ url, status: 200, body: '{}' });
  await Promise.resolve();
  await expect(request).rejects.toThrow('canceled');
});

test.each([
  { url: 'https://other.example/api/info', status: 200, body: '{}' },
  { url, status: 200, body: 'a'.repeat(32769) },
  { url, status: 0, body: '{}' },
])('rejects a malformed, redirected or oversized native response', async response => {
  native.bridgeRequest.mockResolvedValueOnce(response);
  await expect(nativeBridgeRequest(url, {})).rejects.toThrow('Invalid secure bridge response');
});

test('HTTP refusal is preserved so the provider can explain rate limits', async () => {
  native.bridgeRequest.mockResolvedValueOnce({ url, status: 429, body: '{}' });
  await expect(new KilombinoProvider().info(new AbortController().signal)).rejects.toThrow('quote limit');
});

test('native rejection cleans up cancellation listener', async () => {
  native.bridgeRequest.mockRejectedValueOnce(new Error('transport failed'));
  const abort = new AbortController();
  await expect(nativeBridgeRequest(url, { signal: abort.signal })).rejects.toThrow('transport failed');
  abort.abort();
  expect(native.cancelBridgeRequest).not.toHaveBeenCalled();
});

test('quote responses get a longer bound while read-only requests retain the short timeout', async () => {
  jest.useFakeTimers();
  try {
    const request = jest.fn(
      (_requestUrl: string, options: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('canceled')), { once: true });
        }),
    );
    const provider = new KilombinoProvider(request);
    const call = provider['call'].bind(provider);

    let quoteSettled = false;
    const quoteResult = call('quoteHttp', '/api/quote', new AbortController().signal, { invoice: 'fixture' }).catch(error => error);
    quoteResult.then(() => {
      quoteSettled = true;
    });
    await jest.advanceTimersByTimeAsync(15000);
    expect(quoteSettled).toBe(false);
    await jest.advanceTimersByTimeAsync(bridgeQuoteResponseTimeoutMs - 15001);
    expect(quoteSettled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(quoteResult).resolves.toThrow('processor may have reserved this invoice');

    let infoSettled = false;
    const infoResult = call('marketHttp', '/api/info', new AbortController().signal).catch(error => error);
    infoResult.then(() => {
      infoSettled = true;
    });
    await jest.advanceTimersByTimeAsync(14999);
    expect(infoSettled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(infoSettled).toBe(true);
    await expect(infoResult).resolves.not.toThrow('processor may have reserved this invoice');
  } finally {
    jest.useRealTimers();
  }
});

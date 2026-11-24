import { NativeModules } from 'react-native';
import { getSeparationHTTP as nativeGet } from '../../class/xbt/separation-http.native';
import { getSeparationHTTP as nodeGet } from '../../class/xbt/separation-http';
import { validateSeparationRequest, SEPARATION_EVIDENCE as base, SEPARATION_ANCHOR as anchor } from '../../class/xbt/separation-http-policy';

const hash = 'ab'.repeat(32);
const url = base + '/blocks/tip/height';
const originalFetch = global.fetch;
const originalNative = NativeModules.RedWalletSeparationHTTP;
function native() {
  const bridge = {
    get: jest.fn(async (_id: string, requested: string, _limit: number) => ({
      status: 200,
      url: requested,
      body: '976100',
      serverTime: 2_000_000_000,
    })),
    cancel: jest.fn(),
  };
  NativeModules.RedWalletSeparationHTTP = bridge;
  return bridge;
}
afterEach(() => {
  global.fetch = originalFetch;
  NativeModules.RedWalletSeparationHTTP = originalNative;
  jest.restoreAllMocks();
});

test.each([
  [url, 16384],
  [anchor + '/blocks/tip/height', 16384],
  [base + '/block-height/961640', 16384],
  [anchor + '/block/' + hash, 16384],
  [base + '/tx/' + hash + '/hex', 2000000],
  [base + '/block/' + hash + '/header', 160],
  [base + '/tx/' + hash + '/merkle-proof', 16384],
  [base + '/tx/' + hash + '/outspend/4294967295', 16384],
])('allows only the expected canonical proof route %s', (value, limit) => {
  expect(() => validateSeparationRequest(value as string, limit as number)).not.toThrow();
});
test.each([
  'http://blockstream.info/api/blocks/tip/height',
  'https://blockstream.info:443/api/blocks/tip/height',
  'https://blockstream.info.evil.example/api/blocks/tip/height',
  'https://user@blockstream.info/api/blocks/tip/height',
  'https://blockstream.info./api/blocks/tip/height',
  'https://127.0.0.1/api/blocks/tip/height',
  url + '?x=1',
  url + '#x',
  url + '\n',
  url + '/',
  base + '/address/bc1qtest',
  base + '/tx/' + hash + '/hex?credential=secret',
  base + '/tx/' + hash + '/outspend/4294967296',
  base + '/tx/' + hash + '/outspend/01',
  base + '/tx/' + hash + '/hex/../hex',
  base + '/tx/' + hash + '/%68ex',
  base + '/tx/' + hash.toUpperCase() + '/hex',
  anchor + '/tx/' + hash + '/hex',
  anchor + '/block/' + hash + '/header',
  base + '/block-height/0',
])('blocks URL ambiguity and non-proof route %s before requesting', async (value) => {
  const bridge = native();
  await expect(nativeGet(value, 160, new AbortController().signal)).rejects.toThrow();
  expect(bridge.get).not.toHaveBeenCalled();
});
test.each([0, -1, 1.5, NaN, Infinity, 16385])('rejects metadata limit %s', (limit) => {
  expect(() => validateSeparationRequest(url, limit)).toThrow();
});
test('does not fall back to fetch when the native module is unavailable', async () => {
  delete NativeModules.RedWalletSeparationHTTP;
  global.fetch = jest.fn();
  await expect(nativeGet(url, 16384, new AbortController().signal)).rejects.toThrow('unavailable');
  expect(global.fetch).not.toHaveBeenCalled();
});
test('uses separate request IDs and validates the returned route and body', async () => {
  const bridge = native();
  await expect(nativeGet(url, 16384, new AbortController().signal)).resolves.toBe('976100');
  await nativeGet(url, 16384, new AbortController().signal);
  expect(bridge.get.mock.calls[0][0]).not.toBe(bridge.get.mock.calls[1][0]);
  expect(bridge.get.mock.calls[0].slice(1)).toEqual([url, 16384]);
});
test.each([
  { status: 302, url, body: '' },
  { status: 200, url: url + '?redirected=1', body: 'x' },
  { status: 200, url, body: 'a'.repeat(161) },
  { status: 200, url, body: 'é'.repeat(81) },
  { status: 200, url, body: undefined },
  { status: 200, url, body: 'x', serverTime: NaN },
])('rejects invalid native response %#', async (response) => {
  const bridge = native();
  bridge.get.mockResolvedValue(response as any);
  await expect(nativeGet(url, 160, new AbortController().signal)).rejects.toThrow('Invalid');
});
test('pre-aborted request never reaches native code', async () => {
  const bridge = native();
  const controller = new AbortController();
  controller.abort();
  await expect(nativeGet(url, 160, controller.signal)).rejects.toThrow('canceled');
  expect(bridge.get).not.toHaveBeenCalled();
});
test('abort cancels exactly the active request and ignores its late successful reply', async () => {
  const bridge = native();
  let complete!: (value: any) => void;
  bridge.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = nativeGet(url, 160, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow('canceled');
  expect(bridge.cancel).toHaveBeenCalledTimes(1);
  expect(bridge.cancel).toHaveBeenCalledWith(bridge.get.mock.calls[0][0]);
  complete({ status: 200, url, body: '976100', serverTime: 2_000_000_000 });
  await Promise.resolve();
  expect(bridge.cancel).toHaveBeenCalledTimes(1);
});
test('completed request removes its abort listener', async () => {
  const bridge = native();
  const controller = new AbortController();
  await nativeGet(url, 160, controller.signal);
  controller.abort();
  expect(bridge.cancel).not.toHaveBeenCalled();
});
test('native errors cannot invoke a fallback or leak their detailed error text', async () => {
  const bridge = native();
  bridge.get.mockRejectedValue(new Error('internal data'));
  global.fetch = jest.fn();
  await expect(nativeGet(url, 160, new AbortController().signal)).rejects.toThrow('Separation evidence request failed');
  expect(global.fetch).not.toHaveBeenCalled();
});
test('Node adapter rejects redirects and bounds chunked bytes before buffering the full body', async () => {
  const reader = {
    read: jest
      .fn()
      .mockResolvedValueOnce({ done: false, value: Buffer.alloc(100) })
      .mockResolvedValueOnce({ done: false, value: Buffer.alloc(100) }),
    cancel: jest.fn(async () => {}),
  };
  global.fetch = jest.fn(async (_url, init) => {
    expect(init?.redirect).toBe('error');
    return {
      ok: true,
      url,
      redirected: false,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'date' ? new Date(2_000_000_000_000).toUTCString() : null),
      },
      body: { getReader: () => reader },
    } as any;
  });
  await expect(nodeGet(url, 160, new AbortController().signal)).rejects.toThrow('too large');
  expect(reader.read).toHaveBeenCalledTimes(2);
  expect(reader.cancel).toHaveBeenCalledTimes(1);
});

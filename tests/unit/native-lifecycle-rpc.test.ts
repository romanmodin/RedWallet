import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { KnotsFulcrumHarness } from '../native/knots-fulcrum-harness';

let directory: string;
let backend: KnotsFulcrumHarness;

beforeEach(() => {
  jest.useFakeTimers();
  directory = mkdtempSync(path.join(tmpdir(), 'redwallet-rpc-unit-'));
  mkdirSync(path.join(directory, 'node/regtest'), { recursive: true });
  writeFileSync(path.join(directory, 'node/regtest/.cookie'), 'public-test-only');
  backend = Object.create(KnotsFulcrumHarness.prototype);
  Object.defineProperties(backend, { directory: { value: directory }, rpcPort: { value: 1 } });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

test('a timed-out mutating RPC is bounded, identifies the operation, and is never retried', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  await Promise.all([
    expect(backend.rpc('generatetoaddress', ['public-parameter'], false, 60_000)).rejects.toThrow(
      'Isolated Knots RPC generatetoaddress exceeded 60000ms',
    ),
    jest.advanceTimersByTimeAsync(60_000),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('an ordinary RPC failure keeps its original error and clears the deadline without retry', async () => {
  const failure = new Error('public connection failure');
  const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(failure);
  await expect(backend.rpc('getblockcount')).rejects.toBe(failure);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

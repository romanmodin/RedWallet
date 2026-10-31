import { observeNativeSetupStep } from '../e2e/native-setup-step';

afterEach(() => jest.useRealTimers());

test('native setup records bounded progress without recording operation results or rerunning actions', async () => {
  const record = jest.fn(),
    action = jest.fn(async () => 'private result');
  expect(await observeNativeSetupStep('launch', action, record)).toBe('private result');
  expect(action).toHaveBeenCalledTimes(1);
  expect(record.mock.calls.map(([entry]) => entry.status)).toEqual(['started', 'passed']);
  expect(JSON.stringify(record.mock.calls)).not.toContain('private result');
});

test('native setup retains the exact failure and never turns it into a pass', async () => {
  const error = new Error('original');
  const record = jest.fn();
  await expect(
    observeNativeSetupStep(
      'launch',
      async () => {
        throw error;
      },
      record,
    ),
  ).rejects.toBe(error);
  expect(record.mock.calls.map(([entry]) => entry.status)).toEqual(['started', 'failed']);
});

test('a hung native operation fails within its budget and is never retried', async () => {
  jest.useFakeTimers();
  const action = jest.fn(() => new Promise(() => {})),
    record = jest.fn();
  const result = observeNativeSetupStep('clear-keychain', action, record).catch(error => error);
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(60000);
  expect((await result).message).toBe('Native setup step timed out: clear-keychain');
  expect(action).toHaveBeenCalledTimes(1);
  expect(record.mock.calls.map(([entry]) => entry.status)).toEqual(['started', 'failed']);
  expect(jest.getTimerCount()).toBe(0);
});

test('a completed action clears the watchdog and a late completion cannot report a false pass', async () => {
  jest.useFakeTimers();
  const record = jest.fn();
  await observeNativeSetupStep('ready', async () => {}, record);
  expect(jest.getTimerCount()).toBe(0);
  let finish;
  const pending = observeNativeSetupStep(
    'late',
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
    record,
  ).catch(error => error);
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(60000);
  expect(await pending).toBeInstanceOf(Error);
  finish('late result');
  await Promise.resolve();
  expect(record.mock.calls.filter(([entry]) => entry.name === 'late').map(([entry]) => entry.status)).toEqual(['started', 'failed']);
});

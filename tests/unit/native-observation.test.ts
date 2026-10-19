import { observeNativeCondition } from '../native/observe-native-condition';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('returns only after the assertion succeeds and clears its request timer', async () => {
  const assertion = jest.fn().mockResolvedValue(undefined);
  await observeNativeCondition('complete', assertion, 90_000);
  expect(assertion).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('polls rejected observations without changing the condition', async () => {
  const assertion = jest.fn().mockRejectedValueOnce(new Error('still scanning')).mockResolvedValue(undefined);
  const result = observeNativeCondition('complete', assertion, 90_000);
  await jest.advanceTimersByTimeAsync(250);
  await result;
  expect(assertion).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

test('a hung native request fails without issuing a second request', async () => {
  const assertion = jest.fn(() => new Promise(() => {}));
  const result = observeNativeCondition('complete', assertion, 90_000);
  await Promise.all([expect(result).rejects.toThrow('native observation did not respond'), jest.advanceTimersByTimeAsync(10_000)]);
  expect(assertion).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('a condition that stays false fails at the original deadline', async () => {
  const assertion = jest.fn().mockRejectedValue(new Error('still scanning'));
  const result = observeNativeCondition('complete', assertion, 90_000);
  await Promise.all([
    expect(result).rejects.toThrow('condition not met before deadline: still scanning'),
    jest.advanceTimersByTimeAsync(90_000),
  ]);
  expect(jest.getTimerCount()).toBe(0);
});

test('the last request is bounded by the remaining overall budget', async () => {
  const assertion = jest
    .fn()
    .mockRejectedValueOnce(new Error('still scanning'))
    .mockImplementation(() => new Promise(() => {}));
  const result = observeNativeCondition('complete', assertion, 1_000, 10_000, 250);
  await Promise.all([expect(result).rejects.toThrow('native observation did not respond'), jest.advanceTimersByTimeAsync(1_000)]);
  expect(assertion).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

import { observeTransitionVisibility } from '../native/observe-transition-visibility';
import { observeNativeCondition } from '../native/observe-native-condition';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('waits for mounting instead of capturing an absent-control snapshot during navigation', async () => {
  let visible = false;
  const nativeVisibility = jest.fn(
    (budget: number) =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const poll = () => {
          if (visible) return resolve();
          if (Date.now() - started >= budget) {
            // Native expectation failure diagnostics block the request after an
            // absent snapshot (observed in run 41071662820). They are not readiness.
            setTimeout(() => reject(new Error('No elements found')), 11000);
            return;
          }
          setTimeout(poll, 50);
        };
        poll();
      }),
  );
  const immediate = observeNativeCondition('old snapshot', () => nativeVisibility(0), 15000);
  const bounded = observeTransitionVisibility('Import wallet', nativeVisibility);
  setTimeout(() => {
    visible = true;
  }, 350);
  await jest.advanceTimersByTimeAsync(350);
  await bounded;
  await Promise.all([expect(immediate).rejects.toThrow('native observation did not respond'), jest.advanceTimersByTimeAsync(9650)]);
  expect(nativeVisibility).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1000);
  expect(jest.getTimerCount()).toBe(0);
});

test('only a successful visibility check allows the next action', async () => {
  const action = jest.fn();
  const observation = jest.fn().mockRejectedValueOnce(new Error('still hidden')).mockResolvedValue(undefined);
  const result = observeTransitionVisibility('Import wallet', observation).then(action);
  expect(action).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(250);
  await result;
  expect(action).toHaveBeenCalledTimes(1);
  expect(observation).toHaveBeenCalledTimes(2);
  expect(observation).toHaveBeenCalledWith(5000);
});

test('a native request that never returns fails at the unchanged 10-second cap without overlap or follow-up action', async () => {
  let finish: (() => void) | undefined;
  const observation = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const action = jest.fn();
  const result = observeTransitionVisibility('Import wallet', observation).then(action);
  await Promise.all([expect(result).rejects.toThrow('native observation did not respond'), jest.advanceTimersByTimeAsync(10000)]);
  finish?.();
  await Promise.resolve();
  expect(observation).toHaveBeenCalledTimes(1);
  expect(action).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('persistently hidden control fails within the original 15-second overall limit', async () => {
  const action = jest.fn();
  const observation = jest.fn(
    (budget: number) => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('not visible')), budget)),
  );
  const result = observeTransitionVisibility('Import wallet', observation).then(action);
  await Promise.all([expect(result).rejects.toThrow(), jest.advanceTimersByTimeAsync(15000)]);
  expect(action).not.toHaveBeenCalled();
  expect(observation).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(1000);
  expect(jest.getTimerCount()).toBe(0);
});

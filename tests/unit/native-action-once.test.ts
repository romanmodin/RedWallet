import { nativeActionOnce } from '../native/native-action-once';
import { simulatorAppPid } from '../native/ios-stall-diagnostics';

describe('a stalled native action has an uncertain outcome', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('one successful interaction returns its actual result and removes the timer', async () => {
    const action = jest.fn(async () => 'actual result');
    await expect(nativeActionOnce('Done', action, 100)).resolves.toBe('actual result');
    expect(action).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('an interaction failure propagates unchanged without a second interaction', async () => {
    const original = new Error('native connection closed');
    const action = jest.fn(async () => {
      throw original;
    });
    await expect(nativeActionOnce('Done', action, 100)).rejects.toBe(original);
    expect(action).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a hung interaction fails before the case deadline, never retries, and never proceeds', async () => {
    const action = jest.fn(() => new Promise<void>(() => {}));
    const next = jest.fn();
    const result = nativeActionOnce('Done', action, 100).then(next);
    await jest.advanceTimersByTimeAsync(99);
    expect(next).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
    await Promise.all([
      expect(result).rejects.toThrow('Done: native action did not respond; outcome unknown; do not retry'),
      jest.advanceTimersByTimeAsync(1),
    ]);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(action).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  test.each(['resolve', 'reject'] as const)('a late %s cannot resume the failed scenario or cause another action', async outcome => {
    let completeAction!: () => void;
    let failAction!: (error: Error) => void;
    const action = jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          completeAction = resolve;
          failAction = reject;
        }),
    );
    const next = jest.fn();
    const result = nativeActionOnce('Done', action, 100).then(next);
    await Promise.all([expect(result).rejects.toThrow('outcome unknown'), jest.advanceTimersByTimeAsync(100)]);
    if (outcome === 'resolve') completeAction();
    else failAction(new Error('late native failure'));
    await jest.advanceTimersByTimeAsync(1);
    expect(next).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
  });

  test.each([0, -1, NaN, Infinity])('invalid deadline %s cannot invoke the action', async timeout => {
    const action = jest.fn();
    await expect(nativeActionOnce('Done', action, timeout)).rejects.toThrow('Invalid native action deadline');
    expect(action).not.toHaveBeenCalled();
  });
});

describe('sampling is scoped to the exact simulator application', () => {
  test.each(['321\t0\tUIKitApplication:com.romanmodin.redwallet[0xab][rb-legacy]', '321\t0\tapplication.com.romanmodin.redwallet.123.456'])(
    'selects the running exact application: %s',
    line => {
      expect(simulatorAppPid('PID Status Label\n7 0 other.app\n' + line)).toBe(321);
    },
  );
  test.each([
    '',
    '- 0 UIKitApplication:com.romanmodin.redwallet[0xab]',
    '0 0 UIKitApplication:com.romanmodin.redwallet[0xab]',
    '123 0 UIKitApplication:com.romanmodin.redwallet2[0xab]',
    '123 0 application.com.romanmodin.redwallet.helper.123',
    '123 0 UIKitApplication:com.other.wallet[0xab]',
    '123 0 UIKitApplication:com.romanmodin.redwallet[0xab]\n456 0 UIKitApplication:com.romanmodin.redwallet[0xcd]',
  ])('refuses missing, stopped, ambiguous or unrelated processes', list => {
    expect(() => simulatorAppPid(list)).toThrow('one exact RedWallet simulator process');
  });
});

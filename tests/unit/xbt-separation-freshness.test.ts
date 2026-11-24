import { hasFreshTipTime, MAX_TIP_AGE_SECONDS, MAX_FUTURE_SKEW_SECONDS } from '../../class/xbt/separation-freshness';

const networkTime = 2_000_000_000;
function header(timestamp: number): string {
  const value = Buffer.alloc(80);
  value.writeUInt32LE(timestamp, 68);
  return value.toString('hex');
}

it('accepts a recent tip using agreeing authenticated response clocks', () => {
  expect(hasFreshTipTime(header(networkTime - 600), [networkTime, networkTime + 1])).toBe(true);
});

it('rejects a four-hour-old tip even when the phone clock is two hours slow', () => {
  jest.spyOn(Date, 'now').mockReturnValue((networkTime - 2 * 60 * 60) * 1000);
  expect(hasFreshTipTime(header(networkTime - 4 * 60 * 60), [networkTime, networkTime + 1])).toBe(false);
});

it('rejects missing, divergent and malformed response clocks', () => {
  expect(hasFreshTipTime(header(networkTime), [networkTime])).toBe(false);
  expect(hasFreshTipTime(header(networkTime), [networkTime, networkTime + 121])).toBe(false);
  expect(hasFreshTipTime(header(networkTime), [networkTime, NaN])).toBe(false);
});

it('bounds old and future miner timestamps at their exact edges', () => {
  expect(hasFreshTipTime(header(networkTime - MAX_TIP_AGE_SECONDS), [networkTime, networkTime])).toBe(true);
  expect(hasFreshTipTime(header(networkTime - MAX_TIP_AGE_SECONDS - 1), [networkTime, networkTime])).toBe(false);
  expect(hasFreshTipTime(header(networkTime + MAX_FUTURE_SKEW_SECONDS), [networkTime, networkTime])).toBe(true);
  expect(hasFreshTipTime(header(networkTime + MAX_FUTURE_SKEW_SECONDS + 1), [networkTime, networkTime])).toBe(false);
});

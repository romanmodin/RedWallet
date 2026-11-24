export const MAX_TIP_AGE_SECONDS = 3 * 60 * 60;
export const MAX_FUTURE_SKEW_SECONDS = 2 * 60 * 60;
export const MAX_TIME_SOURCE_SKEW_SECONDS = 2 * 60;

/**
 * Fail-closed tip freshness using two authenticated response clocks. The phone's
 * adjustable wall clock is deliberately absent. The header time remains
 * miner-selected, while both fixed providers remain part of the trust model.
 */
export function hasFreshTipTime(header: string, serverTimes: number[]): boolean {
  if (!/^[0-9a-f]{160}$/i.test(header) || serverTimes.length !== 2 || serverTimes.some((value) => !Number.isInteger(value))) return false;
  const lower = Math.min(...serverTimes);
  const upper = Math.max(...serverTimes);
  if (lower < 0 || upper > 0xffffffff || upper - lower > MAX_TIME_SOURCE_SKEW_SECONDS) return false;
  const blockTime = Buffer.from(header, 'hex').readUInt32LE(68);
  if (blockTime > lower + MAX_FUTURE_SKEW_SECONDS) return false;
  return upper - blockTime <= MAX_TIP_AGE_SECONDS;
}

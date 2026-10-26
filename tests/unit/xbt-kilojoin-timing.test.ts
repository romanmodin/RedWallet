import { poolCountdown, roundTiming, participationElapsed } from '../../class/xbt/kilojoin/timing';
import type { SessionState } from '../../class/xbt/kilojoin/session';
import type { Journal } from '../../class/xbt/kilojoin/round';
const timing = (phase: string, journalPhase = 'joined') =>
  roundTiming({ phase, deadline: 700 } as SessionState, { phase: journalPhase, deadline: 900 } as Journal);
test('countdown uses the absolute deadline and never goes negative', () => {
  expect(poolCountdown(700, 100)).toBe('10m 0s remaining');
  expect(poolCountdown(700, 701)).toBe('Deadline reached');
  expect(poolCountdown(NaN, 100)).toBe('Time unavailable');
  expect(poolCountdown(7300, 100)).toBe('2h 0m remaining');
});
test('phase deadlines use actual session values, not a newly started timer', () => {
  for (const p of ['voting', 'closing', 'review']) expect(timing(p).deadline).toBe(700);
  expect(timing('open').deadline).toBe(900);
});
test('terminal and signed rounds never show a stale response deadline', () => {
  expect(timing('open', 'complete').deadline).toBeUndefined();
  expect(timing('open', 'complete').detail).toContain('leave');
  expect(timing('review', 'aborted').deadline).toBeUndefined();
  expect(timing('signed').deadline).toBeUndefined();
  expect(timing('review', 'uncertain').deadline).toBeUndefined();
});

test('participation elapsed includes time away and does not claim creator start time', () => {
  expect(participationElapsed(100, 220)).toBe('2m 0s');
  expect(participationElapsed(100, 520)).toBe('7m 0s');
  expect(participationElapsed(100, 7300)).toBe('2h 0m');
  expect(participationElapsed(100, 50)).toBe('0m 0s');
  expect(participationElapsed(NaN, 200)).toBe('Join time unavailable');
});

import { roundAttention, RoundAttentionMonitor } from '../../class/xbt/kilojoin/attention';
import { poolCountdown } from '../../class/xbt/kilojoin/timing';
import type { ClientView } from '../../class/xbt/kilojoin/client';
const view = (phase = 'voting', error?: string) =>
  ({
    session: { phase, deadline: 1000, voteId: 'vote1' },
    journal: { phase: 'joined', poolId: 'pool1' },
    error,
  }) as ClientView;
test('absolute deadline catches up after suspension instead of pausing or restarting', () => {
  expect(poolCountdown(1000, 400)).toBe('10m 0s remaining');
  expect(poolCountdown(1000, 700)).toBe('5m 0s remaining');
  expect(poolCountdown(1000, 1100)).toBe('Deadline reached');
  expect(roundAttention(view(), 1100)?.title).toBe('Response deadline reached');
});
test('vote and signing demand explicit action, while output registration is automatic', () => {
  expect(roundAttention(view(), 400)?.title).toBe('Action required: closing vote');
  expect(roundAttention(view('review'), 400)?.title).toBe('Action required: review and sign');
  expect(roundAttention(view('closing'), 400)?.detail).toContain('automatic');
  const monitor = new RoundAttentionMonitor();
  expect(monitor.check(view('closing'), 400, true, false)).toBeUndefined();
});
test('background action is announced once on return using the actual remaining window', () => {
  const monitor = new RoundAttentionMonitor();
  expect(monitor.check(view(), 400, false, false)).toBeUndefined();
  const notice = monitor.check(view(), 700, true, false);
  expect(notice?.detail).toContain('5m 0s remaining');
  expect(monitor.check(view(), 701, true, false)).toBeUndefined();
  expect(monitor.check(view(), 1100, true, false)?.title).toContain('deadline reached');
  const anotherVote = view();
  anotherVote.session.voteId = 'vote2';
  expect(monitor.check(anotherVote, 700, true, false)).toBeDefined();
});
test('busy approval is never interrupted, errors are not presented as verified requests', () => {
  const monitor = new RoundAttentionMonitor();
  expect(monitor.check(view('review'), 400, true, true)).toBeUndefined();
  expect(monitor.check(view('review'), 401, true, false)?.title).toContain('review and sign');
  expect(roundAttention(view('review', 'Relay failed'), 400)?.detail).toContain('not a verified current request');
});
test('resolved, signed and uncertain rounds never demand another signature', () => {
  for (const phase of ['complete', 'aborted', 'signed', 'uncertain']) {
    const v = view('review');
    v.journal.phase = phase as ClientView['journal']['phase'];
    expect(roundAttention(v, 400)).toBeUndefined();
  }
  const v = view();
  v.session.deadline = NaN;
  expect(roundAttention(v, 400)).toBeUndefined();
});

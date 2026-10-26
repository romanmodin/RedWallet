import type { SessionState } from './session';
import type { Journal } from './round';

/** Display only. Deadlines never change protocol guards or reservations. */
export function poolCountdown(deadline: number, now: number): string {
  if (!Number.isSafeInteger(deadline) || deadline <= 0) return 'Time unavailable';
  const remaining = Math.max(0, Math.ceil(deadline - now));
  if (!remaining) return 'Deadline reached';
  const minutes = Math.floor(remaining / 60);
  return minutes >= 60
    ? Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm remaining'
    : minutes + 'm ' + (remaining % 60) + 's remaining';
}

export function roundTiming(session: SessionState, journal: Journal): { label: string; deadline?: number; detail: string } {
  if (journal.phase === 'complete')
    return {
      label: 'Round complete',
      detail: 'Confirmed. You can leave this screen.',
    };
  if (journal.phase === 'aborted')
    return {
      label: 'Participation ended',
      detail: 'There is no active response deadline.',
    };
  if (journal.phase === 'uncertain' || session.phase === 'signed')
    return {
      label: 'Waiting for blockchain confirmation',
      detail: 'There is no guaranteed confirmation time. Signed coins remain reserved until resolved.',
    };
  if (session.phase === 'voting')
    return {
      label: 'Closing vote deadline',
      deadline: session.deadline,
      detail: 'Respond to this vote within the remaining time. The normal vote window is 10 minutes.',
    };
  if (session.phase === 'closing')
    return {
      label: 'Output registration deadline',
      deadline: session.deadline,
      detail: 'Output registration normally has a 5-minute window after closing.',
    };
  if (session.phase === 'review')
    return {
      label: 'Review and signing deadline',
      deadline: session.deadline,
      detail: 'Review and approve before this deadline. The normal signing window is 20 minutes; the pool deadline may shorten it.',
    };
  return {
    label: 'Announced pool deadline',
    deadline: journal.deadline,
    detail: 'The pool may close earlier if participants agree. This is not a guaranteed completion time.',
  };
}

/** Elapsed time is a wall-clock difference, never an accumulated tick count. */
export function participationElapsed(joinedAt: number, now: number): string {
  if (!Number.isSafeInteger(joinedAt) || joinedAt <= 0 || !Number.isFinite(now)) return 'Join time unavailable';
  const seconds = Math.max(0, Math.floor(now - joinedAt));
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm' : minutes + 'm ' + (seconds % 60) + 's';
}

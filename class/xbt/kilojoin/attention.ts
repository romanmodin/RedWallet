import { closingResponse } from './participation-progress';
import type { ClientView } from './client';
import { poolCountdown, roundTiming } from './timing';

export function roundAttention(view: ClientView, now: number): { key: string; title: string; detail: string } | undefined {
  const { session, journal } = view;
  if (['complete', 'aborted', 'signed', 'uncertain'].includes(journal.phase) || ['signed', 'aborted'].includes(session.phase))
    return undefined;
  if (!['voting', 'closing', 'review'].includes(session.phase)) return undefined;
  const timing = roundTiming(session, journal);
  const deadline = timing.deadline;
  if (!Number.isSafeInteger(deadline) || !deadline || deadline <= 0) return undefined;
  const key = [journal.poolId, session.phase, session.voteId, session.roundId, deadline].join(':');
  if (view.error)
    return {
      key: key + ':connection',
      title: 'Round needs attention',
      detail:
        'Connection or validation failed. This is the last received deadline, not a verified current request. Return to active pool to inspect it.',
    };
  if (now >= deadline)
    return {
      key: key + ':expired',
      title: 'Response deadline reached',
      detail: 'The last received response window has ended. Check the round status; reopening does not extend it.',
    };
  if (session.phase === 'voting' && closingResponse(session) !== undefined) return undefined;
  if (session.phase === 'closing')
    return {
      key,
      title: 'Output registration in progress',
      detail: 'Output registration is automatic. Return to active pool if it fails; transaction approval will need your attention.',
    };
  return {
    key,
    title: session.phase === 'voting' ? 'Action required: closing vote' : 'Action required: review and sign',
    detail:
      (session.phase === 'voting' ? 'Accept or decline closing.' : 'Review the transaction and choose whether to sign.') +
      ' Respond by ' +
      new Date(deadline * 1000).toLocaleString() +
      ' · ' +
      poolCountdown(deadline, now) +
      '. Open CoinJoin → Return to active pool. Nothing is approved automatically.',
  };
}

/** Presentation only; a notice can never perform a financial action. */
export class RoundAttentionMonitor {
  private readonly seen = new Set<string>();
  check(view: ClientView, now: number, foreground: boolean, busy: boolean) {
    const notice = roundAttention(view, now);
    // Automatic output registration gets a persistent status card, not a demand to act.
    if (!notice || !foreground || busy || (view.session.phase === 'closing' && !view.error && now < view.session.deadline))
      return undefined;
    if (this.seen.has(notice.key)) return undefined;
    this.seen.add(notice.key);
    return notice;
  }
}

import type { SessionState } from './session';
import { outpoint } from './transaction';

/** Only local publication and cryptographically validated signatures are counted. */
export function closingResponse(session: Readonly<SessionState>): boolean | undefined {
  return session.voteId && session.closingResponse?.voteId === session.voteId ? session.closingResponse.accept : undefined;
}

export function signingProgress(session: Readonly<SessionState>) {
  const started = ['review', 'signed'].includes(session.phase);
  const signedParticipants = session.seats.filter(
    seat => seat.coins.length > 0 && seat.coins.every(coin => !!session.signatures[outpoint(coin)]),
  ).length;
  return {
    started,
    participants: session.seats.length,
    signedParticipants,
    inputs: session.seats.reduce((count, seat) => count + seat.coins.length, 0),
    signatures: Object.keys(session.signatures).length,
  };
}

/** Publication acknowledgments do not prove the creator collected every output. */
export function outputRegistrationProgress(session: Readonly<SessionState>) {
  if (session.phase !== 'closing') return undefined;
  const progress = session.outputProgress;
  if (!progress?.prepared)
    return {
      title: 'Waiting for output preparation',
      detail: 'Waiting for the creator’s blinded response. If this stalls, retry output preparation before the deadline.',
    };
  if (progress.submitted < progress.total)
    return {
      title: 'Sending your outputs',
      detail:
        progress.submitted +
        '/' +
        progress.total +
        ' of your outputs acknowledged by the relay. Output submission is automatic while the app is running.',
    };
  return {
    title: '✓ Your outputs were sent',
    detail:
      progress.submitted +
      '/' +
      progress.total +
      ' acknowledged by the relay. Waiting for the creator’s complete output list; other participants’ progress is unavailable.',
  };
}

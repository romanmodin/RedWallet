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

import { participantFailure, relayFailureMessage } from '../../class/xbt/kilojoin/relay-error';

describe('CoinJoin relay error display', () => {
  it('distinguishes connection failure from participant processing failure', () => {
    expect(relayFailureMessage(new Error('Relay connection error'))).toContain('Could not connect');
    expect(relayFailureMessage(new Error('Participant message rejected'))).toContain('could not be validated or processed');
  });
  it.each(['private peer payload', 'constructor', '__proto__'])('does not echo untrusted error %s', message => {
    expect(relayFailureMessage(new Error(message))).toBe(
      'CoinJoin relay communication failed. Coins remain reserved until the round is resolved.',
    );
  });
  it('preserves the reservation warning for a disconnected relay', () => {
    expect(relayFailureMessage(new Error('Relay disconnected'))).toBe(
      'The CoinJoin relay connection was lost. Coins remain reserved until the round is resolved.',
    );
  });
});

test.each(['Invalid welcome', 'Replayed message', 'Unauthorized message route'])('provides a bounded diagnostic for %s', message => {
  expect(relayFailureMessage(participantFailure(new Error(message)))).toMatch(/Diagnostic: KJ-(WELCOME|REPLAY|ROUTE)/);
});
test.each(['private peer payload', 'constructor', '__proto__', 'Invalid welcome: private payload'])(
  'sanitizes participant exception %s',
  message => {
    const failure = participantFailure(new Error(message));
    expect(failure.message).toBe('Participant message rejected [KJ-PROCESS]');
    expect(relayFailureMessage(failure)).not.toContain(message);
  },
);

test.each([
  ['Invalid ownership proof', 'KJ-PROOF'],
  ['Invalid seat change', 'KJ-CHANGE'],
  ['Own seat missing or changed', 'KJ-OWN-SEAT'],
  ['Invalid or replayed roster sequence', 'KJ-ROSTER-SEQ'],
  ['CoinJoin requires a verified confirmed unspent coin', 'KJ-CHAIN'],
  ['Unverified chain tip', 'KJ-TIP'],
  ['Immature CoinJoin coinbase', 'KJ-MATURITY'],
  ['Session action pending', 'KJ-BUSY'],
  ['Invalid or expired session phase', 'KJ-PHASE'],
  ['Invalid vote caller', 'KJ-VOTE'],
  ['Invalid round/vote identifier', 'KJ-ROUND-ID'],
])('distinguishes exact local failure %s without echoing details', (message, code) => {
  expect(relayFailureMessage(participantFailure(new Error(message)))).toContain(`Diagnostic: ${code}.`);
  const untrusted = `${message}: private peer details`;
  expect(relayFailureMessage(participantFailure(new Error(untrusted)))).toContain('Diagnostic: KJ-PROCESS.');
  expect(relayFailureMessage(participantFailure(new Error(untrusted)))).not.toContain('private peer details');
});

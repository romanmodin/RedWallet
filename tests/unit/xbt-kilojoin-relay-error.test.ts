import { relayFailureMessage } from '../../class/xbt/kilojoin/relay-error';

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

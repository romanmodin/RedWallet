import { closingResponse, signingProgress, outputRegistrationProgress } from '../../class/xbt/kilojoin/participation-progress';
import type { SessionState } from '../../class/xbt/kilojoin/session';

const state = () =>
  ({
    phase: 'closing',
    voteId: 'first',
    sequence: 1,
    deadline: 100,
    seats: [
      {
        coins: [
          { txid: 'a', vout: 0 },
          { txid: 'a', vout: 1 },
        ],
      },
      { coins: [{ txid: 'b', vout: 0 }] },
    ],
    signatures: {},
  }) as unknown as SessionState;

test('a sent response belongs only to its vote and a decline is not an approval', () => {
  const s = state();
  expect(closingResponse(s)).toBeUndefined();
  s.closingResponse = { voteId: 'first', accept: true };
  expect(closingResponse(s)).toBe(true);
  s.closingResponse.accept = false;
  expect(closingResponse(s)).toBe(false);
  s.voteId = 'second';
  expect(closingResponse(s)).toBeUndefined();
  s.voteId = undefined;
  expect(closingResponse(s)).toBeUndefined();
});

test('signing starts after output registration and a participant needs every input signature', () => {
  const s = state();
  expect(signingProgress(s).started).toBe(false);
  s.phase = 'review';
  s.signatures = { 'a:0': 'validated' };
  expect(signingProgress(s)).toEqual({ started: true, participants: 2, signedParticipants: 0, inputs: 3, signatures: 1 });
  s.signatures['b:0'] = 'validated';
  expect(signingProgress(s).signedParticipants).toBe(1);
  s.signatures['a:1'] = 'validated';
  expect(signingProgress(s).signedParticipants).toBe(2);
});

test('output presentation separates preparation, partial relay publication and waiting for creator', () => {
  const s = state();
  expect(outputRegistrationProgress(s)?.title).toContain('preparation');
  s.outputProgress = { total: 5, submitted: 2, prepared: true };
  expect(outputRegistrationProgress(s)?.detail).toContain('2/5');
  s.outputProgress.submitted = 5;
  expect(outputRegistrationProgress(s)?.title).toBe('✓ Your outputs were sent');
  expect(outputRegistrationProgress(s)?.detail).toContain('Waiting for the creator');
  s.phase = 'review';
  expect(outputRegistrationProgress(s)).toBeUndefined();
});

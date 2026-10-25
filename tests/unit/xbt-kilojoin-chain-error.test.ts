import { ChainValidationError, chainDiagnostics } from '../../class/xbt/kilojoin/chain-error';
import { participantFailure, relayFailureMessage } from '../../class/xbt/kilojoin/relay-error';
import { coinjoinIssue } from '../../class/xbt/kilojoin/presentation';

test('only trusted fixed chain codes survive classification; raw backend details do not', () => {
  const error = new ChainValidationError('KJ-CHAIN-HISTORY', 'private backend response and input');
  const message = relayFailureMessage(participantFailure(error));
  expect(message).toContain('Diagnostic: KJ-CHAIN-HISTORY.');
  expect(message).not.toContain('private');
  expect(coinjoinIssue(message)).toEqual({
    category: 'Coin validation',
    detail: chainDiagnostics['KJ-CHAIN-HISTORY'],
  });
  const forged = Object.assign(new Error('private'), {
    code: 'KJ-CHAIN-HISTORY',
  });
  expect(participantFailure(forged).message).toBe('Participant message rejected [KJ-PROCESS]');
});

test('future native error codes cannot introduce arbitrary diagnostic text', () => {
  const forged = new ChainValidationError('KJ-CHAIN-secret' as never, 'private input');
  expect(participantFailure(forged).message).toBe('Participant message rejected [KJ-PROCESS]');
  expect(JSON.stringify(coinjoinIssue('Diagnostic: KJ-CHAIN-UNKNOWN.'))).not.toContain('private');
});

import { coinjoinIssue, coinjoinProgress } from '../../class/xbt/kilojoin/presentation';
import type { Journal } from '../../class/xbt/kilojoin/round';
import type { SessionState } from '../../class/xbt/kilojoin/session';

const progress = (phase: string, seats = 0, journalPhase = 'joined', terminalCause?: string) =>
  coinjoinProgress(
    { phase, seats: Array.from({ length: seats }, () => ({})), terminalCause } as SessionState,
    { phase: journalPhase } as Journal,
  );

test('welcome acceptance is distinct from a validated participant list', () => {
  expect(progress('joining').title).toBe('Joining pool');
  expect(progress('open').title).toBe('Accepted · validating participants');
  expect(progress('open').detail).toContain('has not passed validation');
  expect(progress('open', 3).title).toBe('In pool');
  expect(progress('open', 3).detail).toContain('has been validated');
});

test('durable journal terminal state takes precedence over stale session phase', () => {
  expect(progress('open', 3, 'uncertain').title).toBe('Stopped · coins reserved');
  expect(progress('open', 3, 'complete').title).toBe('Confirmed');
  expect(progress('open', 3, 'aborted').title).toBe('Stopped');
});

test.each([
  ['creator-rejected', 'Rejected by pool'],
  ['creator-aborted', 'Aborted by pool'],
])('distinguishes automatic terminal cause %s', (cause, title) => {
  expect(progress('aborted', 0, 'aborted', cause).title).toBe(title);
});

test.each([
  ['KJ-WALLET-INVENTORY', 'Wallet check'],
  ['KJ-WALLET-INPUTS', 'Coin protection'],
  ['KJ-STORAGE', 'Wallet storage'],
  ['KJ-BACKEND', 'Blockchain connection'],
  ['KJ-CHAIN', 'Coin validation'],
  ['KJ-MATURITY', 'Coin validation'],
  ['KJ-PROOF', 'Coin validation'],
  ['KJ-ROSTER-PARSE', 'Pool message validation'],
])('classifies the fixed diagnostic %s', (code, category) => {
  expect(coinjoinIssue('Diagnostic: ' + code + '.').category).toBe(category);
});

test('relay failure does not reclassify an already accepted roster as a rejected coin', () => {
  expect(coinjoinIssue('Could not connect to the CoinJoin relay.').category).toBe('Relay connection');
  expect(progress('open', 3).title).toBe('In pool');
});

test('unknown details cannot appear in the fixed explanation', () => {
  expect(JSON.stringify(coinjoinIssue('private input or native exception'))).not.toContain('private input');
});

test('selected-coin failure is distinct from the whole-wallet inventory', () => {
  expect(coinjoinIssue('Selected coins are no longer available').category).toBe('Coin selection');
});

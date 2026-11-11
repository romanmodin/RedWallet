import { resizeProgressText, LightningResize, selectedChannelAfterResize } from '../../blue_modules/lightning-resize';
const splice: LightningResize = {
  status: 'pending',
  progress: 'confirmed',
  txid: 'new-tx',
  confirmations: '0',
  lockDepth: '6',
  weLocked: true,
  peerLocked: false,
};

test('shows exact measured confirmations and independent peer lock, never 0/6 after twelve confirmations', () => {
  const text = resizeProgressText({ ...splice, onchainConfirmations: '12' });
  expect(text).toContain('On-chain confirmations: 12');
  expect(text).toContain('Our side: locked');
  expect(text).toContain('Peer: waiting');
  expect(text).toContain('required depth is not reported');
  expect(text).not.toContain('0/6');
});
test('unknown counts remain unavailable; zero and reorg counts are allowed to go backwards', () => {
  expect(resizeProgressText(splice)).toContain('count unavailable');
  expect(resizeProgressText({ ...splice, onchainConfirmations: '0' })).toContain('confirmations: 0');
  expect(resizeProgressText({ ...splice, onchainConfirmations: '-1' })).toContain('conflicted');
});
test('completion is taken only from native locked outcome', () => {
  const text = resizeProgressText({
    ...splice,
    progress: 'locked',
    weLocked: true,
    peerLocked: true,
  });
  expect(text).toContain('Channel resize: completed');
  expect(text).not.toContain('Channel resize: locked');
  expect(text).toContain('Peer: locked');
  expect(text).not.toContain('Funds update after');
});

test('keeps the same channel selected across repeated resizes without switching to another channel with that peer', () => {
  const previous = [{ point: 'second:0', originalPoint: 'first:0' }];
  const next = [
    { point: 'unrelated:0', originalPoint: 'other:0' },
    { point: 'third:1', originalPoint: 'first:0' },
  ];
  expect(selectedChannelAfterResize('second:0', previous, next)).toBe('third:1');
  expect(selectedChannelAfterResize(undefined, previous, next)).toBeUndefined();
  expect(selectedChannelAfterResize('removed:0', previous, next)).toBeUndefined();
});

test('an on-chain rollback overrides a stale confirmed label', () => {
  const rolledBack = resizeProgressText({ ...splice, onchainConfirmations: '0' });
  expect(rolledBack).toContain('awaiting on-chain confirmation');
  expect(rolledBack).not.toContain('confirmed on chain;');
});

test.each(['aborted', 'dead'])('a %s resize never promises to finish after peer locking', progress => {
  const text = resizeProgressText({ ...splice, progress });
  expect(text).toContain('This resize did not complete');
  expect(text).not.toContain('waiting');
  expect(text).not.toContain('Funds update after');
  expect(text).not.toContain('Local confirmation requirement');
});
test('a conflicted resize does not wait for peer locking', () => {
  const text = resizeProgressText({ ...splice, onchainConfirmations: '-1' });
  expect(text).toContain('transaction conflicted');
  expect(text).not.toContain('waiting');
  expect(text).not.toContain('Funds update after');
});

export type LightningResize = {
  status: string;
  progress: string;
  txid: string;
  confirmations: string;
  lockDepth: string;
  onchainConfirmations?: string;
  weLocked?: boolean;
  peerLocked?: boolean;
};

export function resizeProgressText(splice: LightningResize): string {
  const chainCount = splice.onchainConfirmations;
  const measured = chainCount !== undefined && /^-?\d+$/.test(chainCount) && Number.isSafeInteger(Number(chainCount));
  const rpcCount = /^\d+$/.test(splice.confirmations) && Number(splice.confirmations) > 0;
  const count = measured ? Number(chainCount) : rpcCount ? Number(splice.confirmations) : undefined;
  const completed = splice.progress === 'locked';
  const phase =
    count !== undefined && count < 0
      ? 'transaction conflicted'
      : splice.progress === 'confirmed'
        ? count === 0
          ? 'awaiting on-chain confirmation'
          : 'confirmed on chain; waiting for both peers to lock'
        : splice.progress.replace(/_/g, ' ');
  const lines = ['Channel resize: ' + phase];
  if (count !== undefined)
    lines.push(count < 0 ? 'On-chain transaction conflicted. Check node history.' : 'On-chain confirmations: ' + count);
  else if (splice.txid) lines.push('On-chain confirmation count unavailable.');
  if (splice.lockDepth !== '0') lines.push('Local confirmation requirement: ' + splice.lockDepth);
  const state = (locked?: boolean) => (locked === undefined ? 'not reported' : locked ? 'locked' : 'waiting');
  lines.push('Our side: ' + state(splice.weLocked), 'Peer: ' + state(splice.peerLocked));
  if (!completed) lines.push('The peer’s required depth is not reported. Funds update after both sides lock.');
  if (splice.txid) lines.push('Transaction: ' + splice.txid);
  return lines.join('\n');
}

/** A resize changes the current outpoint; follow the original channel, never just its peer. */
export function selectedChannelAfterResize(
  current: string | undefined,
  previous: { point: string; originalPoint?: string }[],
  next: { point: string; originalPoint?: string }[],
): string | undefined {
  if (!current) return undefined;
  const original = previous.find(channel => channel.point === current)?.originalPoint || current;
  return next.find(channel => channel.point === current || channel.originalPoint === original)?.point;
}

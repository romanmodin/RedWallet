import type { LndOverview } from '../class/wallets/lnd-wallet';

function amount(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2_100_000_000_000_000)
    throw new Error('Balance breakdown unavailable. Refresh the node.');
  return Number(value);
}

/** Informational rows overlap; never sum locked funds or reserves into the total again. */
export function lndBalanceBreakdown(overview: LndOverview) {
  return {
    // ConfirmedBalance uses ListUnspentWitness, which already excludes locked UTXOs.
    onchainAvailable: Math.max(0, amount(overview.fundingConfirmed) - amount(overview.anchorReserve)),
    lightningAvailable: overview.lightningAvailable === undefined ? undefined : amount(overview.lightningAvailable),
    fundingPending: amount(overview.fundingPending),
    channelPending: amount(overview.channelPending),
    splicePending: amount(overview.splicePending),
    fundingLocked: amount(overview.fundingLocked),
    anchorReserve: amount(overview.anchorReserve),
  };
}

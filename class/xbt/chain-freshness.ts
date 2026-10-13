/** Advisory only: never authorizes a spend or changes the selected provider. */
export type ChainState = 'checking' | 'verified' | 'unverified' | 'suspect' | 'behind' | 'disagreement';
export type ReferenceResult = {
  source: string;
  height: number;
  comparisonHeight: number;
  matches: boolean;
};
export type ChainStatus = {
  state: ChainState;
  serverLabel: string;
  checkedAt?: number;
  verifiedAt?: number;
  height?: number;
  source?: string;
  message: string;
  references: ReferenceResult[];
};

export const CHAIN_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const CHAIN_RETRY_MS = 2 * 60 * 1000;
export const CHAIN_PROPAGATION_GRACE_BLOCKS = 2;

export function serverLabel(name: string | false): string {
  return typeof name === 'string' && /fulcrum|shulcrum/i.test(name) ? 'Fulcrum' : 'Electrum';
}

export function assessChain(
  height: number,
  references: ReferenceResult[],
  repeat: boolean,
): Pick<ChainStatus, 'state' | 'source' | 'message'> {
  const ahead = references.find(r => r.height - height > CHAIN_PROPAGATION_GRACE_BLOCKS);
  if (ahead) {
    return {
      state: repeat ? 'behind' : 'suspect',
      source: ahead.source,
      message: `${ahead.source} is ${ahead.height - height} blocks ahead. Balance and recent transactions may be outdated.`,
    };
  }
  const conflict = references.find(r => !r.matches);
  if (conflict) {
    return {
      state: repeat ? 'disagreement' : 'suspect',
      source: conflict.source,
      message: `Recent block data differs from ${conflict.source}. This may be a temporary reorganization; retry verification.`,
    };
  }
  const match = references.find(r => r.matches && Math.abs(r.height - height) <= CHAIN_PROPAGATION_GRACE_BLOCKS);
  return match
    ? {
        state: 'verified',
        source: match.source,
        message: `Recent chain data matches ${match.source}. This is a cross-check, not full SPV verification.`,
      }
    : {
        state: 'unverified',
        message: 'Unable to verify current chain data. You can still view addresses and saved wallet data.',
      };
}

export function chainStatusTitle(status: ChainStatus): string {
  switch (status.state) {
    case 'verified':
      return status.source === 'Knots' ? 'Matches your Knots' : 'Chain verified';
    case 'checking':
      return 'Checking chain…';
    case 'behind':
      return `Your ${status.serverLabel} is behind`;
    case 'disagreement':
      return 'Chain data differs';
    case 'suspect':
      return 'Potential chain issue';
    default:
      return `Your ${status.serverLabel} is unverified`;
  }
}

export function validateReferenceUrl(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const url = new URL(text);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error('Use an HTTPS read-only chain endpoint without credentials, query parameters or fragments.');
  }
  return url.toString();
}

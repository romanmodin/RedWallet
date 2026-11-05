import { observeNativeCondition } from './observe-native-condition';

// iOS 26 can still be completing a sheet transition when the control mounts.
// A short native timeout starts expensive failure screenshots while that same
// control becomes visible (run 41992677029). Keep the actual visibility check,
// allow it 20s, and bound the single outstanding request at 25s / 30s overall.
// A timed-out native request is never retried or followed by a wallet action.
export function observeTransitionVisibility(label: string, waitForVisibility: (timeoutMs: number) => Promise<unknown>): Promise<void> {
  return observeNativeCondition(label, () => waitForVisibility(20_000), 30_000, 25_000);
}

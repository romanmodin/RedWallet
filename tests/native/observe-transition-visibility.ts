import { observeNativeCondition } from './observe-native-condition';

// A plain expectation snapshots an in-progress navigation and may spend the
// entire request budget capturing failure diagnostics. Let the native driver
// poll the SAME visibility condition while the screen mounts. Keep the original
// 15s overall / 10s per-request limits and never retry a pending native request.
export function observeTransitionVisibility(label: string, waitForVisibility: (timeoutMs: number) => Promise<unknown>): Promise<void> {
  return observeNativeCondition(label, () => waitForVisibility(5_000), 15_000);
}

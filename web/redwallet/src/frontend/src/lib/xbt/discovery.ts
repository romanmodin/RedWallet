/** Bounded account-0 discovery. Public keys only; no storage, signing or network implementation. */
import { publicAddress } from "./key-material";

export interface DiscoveredAddress {
  branch: 0 | 1;
  index: number;
  address: string;
}
export interface BranchDiscovery {
  used: DiscoveredAddress[];
  next: DiscoveredAddress;
  scanned: number;
}
export interface DiscoveryOptions {
  /** Native RedWallet's default is 20 consecutive addresses without history. */
  gapLimit?: number;
  maxAddressesPerBranch?: number;
  /** Highest locally issued index, including unused addresses; -1 means none. */
  issuedThrough?: readonly [number, number];
  signal?: AbortSignal;
}
export type HistoryProbe = (
  address: string,
  signal?: AbortSignal,
) => Promise<boolean>;

/**
 * A probe must return true for ANY history, including fully spent/unconfirmed activity.
 * Errors must reject, never become false. Caller must use the checkpoint-verified
 * configured backend and impose request timeouts. No partial result is returned.
 * A gap can hide later funds: this is bounded discovery, not proof of no other funds.
 */
export async function discoverAccount(
  accountXpub: string,
  hasHistory: HistoryProbe,
  options: DiscoveryOptions = {},
): Promise<readonly [BranchDiscovery, BranchDiscovery]> {
  const gap = options.gapLimit ?? 20;
  const cap = options.maxAddressesPerBranch ?? 1000;
  const issued = options.issuedThrough ?? [-1, -1];
  if (!Number.isInteger(gap) || gap < 20 || gap > 100 ||
      !Number.isInteger(cap) || cap < gap || cap > 2000 ||
      issued.length !== 2 || issued.some(i => !Number.isInteger(i) || i < -1 || i + gap >= cap)) {
    throw Error("Invalid discovery bounds");
  }
  const cancelled = () => {
    if (options.signal?.aborted) throw Error("Discovery cancelled");
  };
  const results: BranchDiscovery[] = [];
  for (const branch of [0, 1] as const) {
    let empty = 0;
    let lastUsed = -1;
    const used: DiscoveredAddress[] = [];
    let result: BranchDiscovery | undefined;
    for (let index = 0; index < cap; index++) {
      cancelled();
      const address = publicAddress(accountXpub, branch, index);
      const active = await hasHistory(address, options.signal);
      cancelled();
      if (typeof active !== "boolean") throw Error("Invalid history observation");
      if (active) {
        used.push({ branch, index, address });
        lastUsed = index;
        empty = 0;
      } else {
        empty++;
      }
      // Scan the full gap beyond every locally issued address, even if unused.
      if (empty >= gap && index >= issued[branch] + gap) {
        const nextIndex = Math.max(lastUsed, issued[branch]) + 1;
        result = {
          used,
          next: { branch, index: nextIndex, address: publicAddress(accountXpub, branch, nextIndex) },
          scanned: index + 1,
        };
        break;
      }
    }
    if (!result) throw Error("Discovery limit reached; recovery is incomplete");
    results.push(result);
  }
  return [results[0]!, results[1]!];
}

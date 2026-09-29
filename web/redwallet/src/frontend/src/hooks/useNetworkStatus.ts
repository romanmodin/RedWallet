/**
 * Thin typed hook over the shared network-status context.
 *
 * Screens and indicators import this instead of reaching into the context
 * module directly, so every consumer reads the same latest network result.
 */

import { useNetworkStatusContext } from "@/context/NetworkStatusContext";

export function useNetworkStatus() {
  return useNetworkStatusContext();
}

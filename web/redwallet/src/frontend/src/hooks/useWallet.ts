/**
 * Thin typed hook over the wallet context.
 *
 * Screens import this instead of reaching into the context module directly.
 */

import { useWalletContext } from "@/context/WalletContext";

export function useWallet() {
  return useWalletContext();
}

/**
 * Barrel export for the RedWallet demo service layer.
 *
 * Import domain types, the wallet service, settings service, and fiat rate
 * helper from `@/services`.
 */

export * from "./types";
export * from "./walletService";
export * from "./bridgeService";
export * from "./settingsService";
export * from "./fiatRate";

/** The shared network-status source lives in the context layer. */
export {
  NetworkStatusProvider,
  useNetworkStatusContext,
  type NetworkStatusContextValue,
} from "@/context/NetworkStatusContext";

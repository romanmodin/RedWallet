/**
 * Local fiat rate.
 *
 * The demo app never contacts a public endpoint. The XBT/USD rate is served
 * exclusively from the fixed local fallback constant in `walletService`, so
 * this module performs no network access of any kind.
 */

import { type FiatRate, type ServiceResult, ok } from "./types";
import { FALLBACK_USD_PER_XBT } from "./walletService";

/** The fixed demo rate, always available. */
export function fallbackRate(): FiatRate {
  return {
    usdPerXbt: FALLBACK_USD_PER_XBT,
    source: "fallback",
    fetchedAt: Date.now(),
  };
}

/**
 * Resolve the XBT/USD rate. Always resolves to the local fallback rate —
 * no network request is made.
 */
export async function fetchFiatRate(): Promise<ServiceResult<FiatRate>> {
  return ok(fallbackRate());
}

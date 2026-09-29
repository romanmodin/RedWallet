/**
 * NetworkSetting — XBT network status.
 *
 * This build has no real XBT backend, so there is no network to select and no
 * Mainnet/Testnet claim. The surface states plainly that the network is a demo
 * and not configured, and never discovers or connects to anything.
 */

import { Info } from "lucide-react";

export function NetworkSetting() {
  return (
    <div
      data-ocid="settings.network"
      className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3.5"
    >
      <Info
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-display text-sm font-semibold tracking-tight text-foreground">
          XBT network · read-only bridge
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Open Network status to check connectivity and the configured XBT
          checkpoint. Demo accounts remain simulated.
        </p>
      </div>
    </div>
  );
}

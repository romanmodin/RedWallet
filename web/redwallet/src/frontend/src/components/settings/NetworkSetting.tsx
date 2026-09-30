/** Public network overview; actual status is read from the deployed backend. */

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
          XBT network · wallet bridge
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Open Network status to check connectivity and the configured XBT
          checkpoint. Local wallets sign on this device; the bridge relays only
          signed transactions. Watched addresses cannot sign. Demo accounts
          remain simulated.
        </p>
      </div>
    </div>
  );
}

/**
 * NetworkIndicator — compact connection status chip linking to /status.
 *
 * Reads the shared network status from `useNetworkStatus`, so every indicator
 * on every screen shows the same latest actual result and updates together
 * when any consumer refreshes. When no bridge is configured the status is
 * Offline by design. Always links to the full status page.
 */

import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/services/types";
import { Link } from "@tanstack/react-router";

const STATE_LABEL: Record<ConnectionState, string> = {
  connected: "Connected",
  connecting: "Connecting",
  offline: "Offline",
  error: "Error",
};

const STATE_DOT: Record<ConnectionState, string> = {
  connected: "bg-success",
  connecting: "bg-accent animate-pulse-soft",
  offline: "bg-muted-foreground",
  error: "bg-destructive",
};

export function NetworkIndicator({ compact = false }: { compact?: boolean }) {
  const { connectionState } = useNetworkStatus();

  return (
    <Link
      to="/status"
      data-ocid="network_indicator.link"
      aria-label={`Network status: ${STATE_LABEL[connectionState]}. Open network status.`}
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-secondary/60 font-medium text-muted-foreground transition-smooth outline-none hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-1.5 text-xs",
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          STATE_DOT[connectionState],
        )}
        aria-hidden="true"
      />
      <span>{STATE_LABEL[connectionState]}</span>
    </Link>
  );
}

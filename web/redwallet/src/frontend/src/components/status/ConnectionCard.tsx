/**
 * ConnectionCard — connection state readout with distinct treatment per state.
 *
 * Renders one of four states (connected, connecting, offline, error) with a
 * colour-coded dot, icon, headline, and plain-language explanation. The
 * `connecting` state shows a live "Checking…" affordance so a manual refresh
 * has visible feedback.
 */

import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/services/types";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  type LucideIcon,
  WifiOff,
} from "lucide-react";

interface StatePresentation {
  label: string;
  headline: string;
  description: string;
  icon: LucideIcon;
  /** Icon chip background + foreground. */
  chip: string;
  /** Status dot colour. */
  dot: string;
  /** Card border tint. */
  border: string;
}

const STATE_PRESENTATION: Record<ConnectionState, StatePresentation> = {
  connected: {
    label: "Connected",
    headline: "Server reachable",
    description:
      "The configured Fulcrum bridge responded. Refresh your wallet to read its latest balance and history.",
    icon: CheckCircle2,
    chip: "bg-success/15 text-success",
    dot: "bg-success",
    border: "border-success/30",
  },
  connecting: {
    label: "Connecting",
    headline: "Reaching the server",
    description:
      "Opening a session with your configured server and requesting the latest block header.",
    icon: Loader2,
    chip: "bg-accent/15 text-accent",
    dot: "bg-accent animate-pulse-soft",
    border: "border-accent/30",
  },
  offline: {
    label: "Offline",
    headline: "No server configured",
    description:
      "The bridge is not configured or could not be reached. Contact the deployment operator.",
    icon: WifiOff,
    chip: "bg-secondary text-muted-foreground",
    dot: "bg-muted-foreground",
    border: "border-border",
  },
  error: {
    label: "Error",
    headline: "Connection failed",
    description:
      "The server did not respond as expected. Check the host, port, and TLS setting, then try again.",
    icon: AlertTriangle,
    chip: "bg-destructive/15 text-destructive",
    dot: "bg-destructive",
    border: "border-destructive/40",
  },
};

interface ConnectionCardProps {
  state: ConnectionState;
  /** True while a manual refresh is in flight. */
  isRefreshing?: boolean;
  className?: string;
}

export function ConnectionCard({
  state,
  isRefreshing = false,
  className,
}: ConnectionCardProps) {
  const presentation = STATE_PRESENTATION[state];
  const Icon = presentation.icon;
  const spinning = state === "connecting" || isRefreshing;

  return (
    <section
      data-ocid="status.connection_card"
      aria-label="Connection state"
      className={cn(
        "rounded-2xl border bg-card p-5 shadow-subtle",
        presentation.border,
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-full",
            presentation.chip,
          )}
        >
          <Icon
            className={cn("size-6", spinning && "animate-spin")}
            aria-hidden="true"
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn("size-2 shrink-0 rounded-full", presentation.dot)}
              aria-hidden="true"
            />
            <span className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {presentation.label}
            </span>
          </div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
            {presentation.headline}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {presentation.description}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * SyncReadout — demo sync status readout.
 *
 * Shows the last-synced time and a block-height-style value from the service,
 * plus the demo peer count. Every value is explicitly labelled as demo data.
 */

import { formatBlockHeight, formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Boxes, Clock, ShieldAlert, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SyncReadoutProps {
  blockHeight: number;
  /** Unix epoch milliseconds of the last successful sync. */
  lastSyncedAt: number;
  peers: number;
  /**
   * Whether a verified XBT checkpoint/network identity is configured. False
   * in this build — no checkpoint is inferred and no BTC compatibility is
   * claimed.
   */
  checkpointConfigured: boolean;
  className?: string;
  isLive?: boolean;
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-muted/30 p-4">
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
      <span className="font-mono text-xl font-semibold tracking-tight text-foreground">
        {value}
      </span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function SyncReadout({
  blockHeight,
  lastSyncedAt,
  peers,
  checkpointConfigured,
  className,
  isLive = false,
}: SyncReadoutProps) {
  return (
    <section
      data-ocid="status.sync_readout"
      aria-label="Sync status"
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-subtle",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Sync status
        </h2>
        <span
          data-ocid="status.sync_readout.demo_pill"
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-accent"
        >
          <span
            className="size-1.5 rounded-full bg-accent animate-pulse-soft"
            aria-hidden="true"
          />
          {isLive ? "Live bridge" : "Unavailable"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric
          icon={Boxes}
          label="Block height"
          value={formatBlockHeight(blockHeight)}
          hint={isLive ? "Reported by Fulcrum" : "Backend not connected"}
        />
        <Metric
          icon={Clock}
          label="Last synced"
          value={formatRelativeDate(lastSyncedAt)}
          hint="Time of last successful status read"
        />
        <Metric
          icon={Users}
          label="Peers"
          value={Number.isFinite(peers) ? String(peers) : "Unavailable"}
          hint="Peer count is not supplied by the bridge"
        />
      </div>

      <p
        data-ocid="status.sync_readout.checkpoint"
        className="mt-4 flex items-start gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground"
      >
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {checkpointConfigured
          ? "A checkpoint is configured for this server."
          : "Checkpoint not configured — RedWallet makes no network-identity or BTC-compatibility claim."}
      </p>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The bridge supplies chain height and checkpoint verification. Missing
        metrics are shown as unavailable.
      </p>
    </section>
  );
}

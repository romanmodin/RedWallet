/**
 * ServerSummary — the configured Electrum/Fulcrum server summary.
 *
 * Shows the configured host, port, and TLS setting from user settings. When no
 * host is configured it renders a clear prompt directing the user to Settings
 * — it never substitutes a public server and never claims a network.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Lock, LockOpen, Server, Settings2 } from "lucide-react";

interface ServerSummaryProps {
  host: string;
  port: number;
  tls: boolean;
  className?: string;
}

function DetailRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: typeof Server;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-sm font-medium text-foreground",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function ServerSummary({
  host,
  port,
  tls,
  className,
}: ServerSummaryProps) {
  const hasHost = host.trim().length > 0;

  return (
    <section
      data-ocid="status.server_summary"
      aria-label="Selected server"
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-subtle",
        className,
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <Server className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Selected server
        </h2>
      </div>

      {hasHost ? (
        <div className="divide-y divide-border/70">
          <DetailRow icon={Server} label="Host" value={host} mono />
          <DetailRow icon={Server} label="Port" value={String(port)} mono />
          <DetailRow
            icon={tls ? Lock : LockOpen}
            label="TLS"
            value={tls ? "Enabled" : "Disabled"}
          />
        </div>
      ) : (
        <div
          data-ocid="status.server_summary.empty_state"
          className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4"
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            No server host is configured. RedWallet will not connect to a public
            server on your behalf — choose your own Electrum or Fulcrum server
            in Settings.
          </p>
          <Button
            asChild
            variant="outline"
            className="rounded-xl"
            data-ocid="status.server_summary.settings_link"
          >
            <Link to="/settings">
              <Settings2 className="size-4" aria-hidden="true" />
              Configure server
            </Link>
          </Button>
        </div>
      )}

      {hasHost ? (
        <div className="mt-4 border-t border-border/70 pt-4">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="rounded-xl text-muted-foreground hover:text-foreground"
            data-ocid="status.server_summary.settings_link"
          >
            <Link to="/settings">
              <Settings2 className="size-4" aria-hidden="true" />
              Change server in Settings
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

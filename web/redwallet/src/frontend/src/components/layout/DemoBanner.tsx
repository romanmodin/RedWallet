/**
 * DemoBanner — persistent demo-data label.
 *
 * Every screen in this build shows demo data, so the banner is always
 * visible. It uses the warm gold accent reserved for the demo pill and
 * status dots, keeping crimson for primary actions.
 */

import { useWallet } from "@/hooks/useWallet";
import { cn } from "@/lib/utils";

interface DemoBannerProps {
  className?: string;
  /** Compact variant used inside the mobile header. */
  compact?: boolean;
}

export function DemoBanner({ className, compact = false }: DemoBannerProps) {
  const { activeWallet } = useWallet();
  const isDemo = activeWallet?.isDemo !== false;
  return (
    <div
      data-ocid="demo_banner"
      role="note"
      className={cn(
        "flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 text-accent",
        compact ? "px-2.5 py-1" : "px-3 py-1.5",
        className,
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full bg-accent animate-pulse-soft"
        aria-hidden="true"
      />
      <span
        className={cn(
          "font-display font-semibold uppercase tracking-[0.14em]",
          compact ? "text-[10px]" : "text-[11px]",
        )}
      >
        {isDemo ? "Demo mode" : "Watch only"}
      </span>
      {!compact ? (
        <span className="text-[11px] font-medium text-accent/80">
          {isDemo
            ? "— all data is simulated"
            : "— live address reads · sending unavailable"}
        </span>
      ) : null}
    </div>
  );
}

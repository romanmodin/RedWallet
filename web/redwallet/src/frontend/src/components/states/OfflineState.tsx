/**
 * OfflineState — shown when the configured server is unreachable.
 *
 * Explains the situation in plain language and offers a retry action so the
 * user always has a recovery path.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WifiOff } from "lucide-react";

interface OfflineStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function OfflineState({
  title = "You're offline",
  description = "RedWallet can't reach the configured server. Check your connection and try again — your demo data is safe.",
  onRetry,
  className,
}: OfflineStateProps) {
  return (
    <output
      data-ocid="offline_state"
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <WifiOff className="size-6" aria-hidden="true" />
      </span>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="font-display text-base font-semibold text-foreground">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          data-ocid="offline_state.retry_button"
        >
          Try again
        </Button>
      ) : null}
    </output>
  );
}

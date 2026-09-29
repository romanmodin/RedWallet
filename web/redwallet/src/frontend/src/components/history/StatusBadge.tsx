/**
 * StatusBadge — colour-coded lifecycle badge for a demo transaction.
 *
 * Confirmed uses the success token, pending the warm gold accent (reserved
 * for the demo pill and status dots), and failed the destructive token. The
 * dot carries the colour so the label stays readable at small sizes.
 */

import { cn } from "@/lib/utils";
import type { TransactionStatus } from "@/services/types";

interface StatusBadgeProps {
  status: TransactionStatus;
  className?: string;
}

const STATUS_LABEL: Record<TransactionStatus, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  failed: "Failed",
};

const STATUS_STYLE: Record<TransactionStatus, string> = {
  confirmed: "border-success/40 bg-success/10 text-success",
  pending: "border-accent/40 bg-accent/10 text-accent",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

const STATUS_DOT: Record<TransactionStatus, string> = {
  confirmed: "bg-success",
  pending: "bg-accent animate-pulse-soft",
  failed: "bg-destructive",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      data-ocid={`history.status_badge.${status}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.12em]",
        STATUS_STYLE[status],
        className,
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status])}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * FeeEstimate — live fee estimate readout for the send flow.
 *
 * Renders the service-provided estimate, clearly labelled as an estimate,
 * with the sat/vB rate and expected confirmation window. Shows a compact
 * skeleton while the estimate is loading and a quiet inline note when the
 * estimate could not be produced.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { formatAmount, formatFiat } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  DisplayUnit,
  FeeEstimate as FeeEstimateValue,
} from "@/services/types";
import { Gauge } from "lucide-react";

interface FeeEstimateProps {
  estimate: FeeEstimateValue | null;
  isLoading: boolean;
  error: string | null;
  displayUnit: DisplayUnit;
  className?: string;
}

export function FeeEstimate({
  estimate,
  isLoading,
  error,
  displayUnit,
  className,
}: FeeEstimateProps) {
  return (
    <div
      data-ocid="send.fee_estimate"
      className={cn(
        "rounded-2xl border border-border/70 bg-secondary/40 p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Gauge className="size-4 shrink-0" aria-hidden="true" />
          <span className="font-display text-xs font-semibold uppercase tracking-[0.14em]">
            Estimated network fee
          </span>
        </div>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
          Estimate
        </span>
      </div>

      {isLoading ? (
        <output
          data-ocid="send.fee_estimate.loading_state"
          aria-live="polite"
          className="mt-3 flex flex-col gap-2"
        >
          <span className="sr-only">Loading fee estimate</span>
          <Skeleton className="h-6 w-40 rounded-full" />
          <Skeleton className="h-3 w-52 rounded-full" />
        </output>
      ) : error ? (
        <p
          data-ocid="send.fee_estimate.error_state"
          className="mt-3 text-sm text-muted-foreground"
        >
          {error}
        </p>
      ) : estimate ? (
        <div className="mt-3 flex flex-col gap-1">
          <p className="font-mono text-lg font-medium tabular-nums text-foreground">
            {formatAmount(estimate.feeXbt, displayUnit)}
          </p>
          <p className="text-xs text-muted-foreground">
            ≈ {formatFiat(estimate.feeUsd)} · {estimate.satPerVbyte} sat/vB ·
            confirms in ~{estimate.estimatedBlocks} blocks
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Enter an amount to see an estimated network fee.
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
        Fees are estimates only and can change before a transaction is
        confirmed. This demo never broadcasts.
      </p>
    </div>
  );
}

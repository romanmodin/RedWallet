/**
 * SendReview — step two of the demo send flow.
 *
 * Summarizes recipient, amount, estimated fee, and total, with a back action
 * to edit. The confirm control is intentionally disabled and demo-only: this
 * build never creates, signs, or broadcasts a transaction.
 */

import { Button } from "@/components/ui/button";
import { formatAmount, formatFiat, truncateAddress } from "@/lib/format";
import type { DisplayUnit, FeeEstimate } from "@/services/types";
import { ArrowLeft, Info, Lock, ShieldCheck } from "lucide-react";

interface SendReviewProps {
  recipient: string;
  amountXbt: number;
  note: string;
  feeEstimate: FeeEstimate | null;
  displayUnit: DisplayUnit;
  onBack: () => void;
}

interface SummaryRow {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}

export function SendReview({
  recipient,
  amountXbt,
  note,
  feeEstimate,
  displayUnit,
  onBack,
}: SendReviewProps) {
  const feeXbt = feeEstimate?.feeXbt ?? 0;
  const totalXbt = amountXbt + feeXbt;

  const rows: SummaryRow[] = [
    {
      label: "Recipient",
      value: truncateAddress(recipient, 12, 8),
      hint: "Demo address — not validated on-chain",
    },
    {
      label: "Amount",
      value: formatAmount(amountXbt, displayUnit),
    },
    {
      label: "Estimated fee",
      value: feeEstimate ? formatAmount(feeXbt, displayUnit) : "—",
      hint: feeEstimate
        ? `≈ ${formatFiat(feeEstimate.feeUsd)} · estimate only`
        : "Fee estimate unavailable",
    },
    {
      label: "Total",
      value: formatAmount(totalXbt, displayUnit),
      hint: "Amount plus estimated fee",
      emphasis: true,
    },
  ];

  return (
    <div data-ocid="send.review" className="flex flex-col gap-5">
      <div className="rounded-2xl border border-border/70 bg-card p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-xs font-semibold uppercase tracking-[0.14em]">
            Review payment
          </h2>
        </div>

        <dl className="mt-4 flex flex-col divide-y divide-border/60">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd className="flex min-w-0 flex-col items-end text-right">
                <span
                  className={
                    row.emphasis
                      ? "font-mono text-base font-semibold tabular-nums text-foreground"
                      : "font-mono text-sm tabular-nums text-foreground"
                  }
                >
                  {row.value}
                </span>
                {row.hint ? (
                  <span className="text-[11px] text-muted-foreground">
                    {row.hint}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>

        {note.trim() ? (
          <div className="mt-4 rounded-xl border border-border/60 bg-secondary/40 p-3">
            <p className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Note
            </p>
            <p className="mt-1 break-words text-sm text-foreground">{note}</p>
          </div>
        ) : null}
      </div>

      <div
        data-ocid="send.demo_notice"
        role="note"
        className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4"
      >
        <Info
          className="mt-0.5 size-4 shrink-0 text-accent"
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed text-accent">
          <span className="font-semibold">Demo only.</span> No real transaction
          is created, signed, or broadcast. Confirming records a local demo
          entry and nothing leaves this device.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <Button
          type="button"
          disabled
          aria-disabled="true"
          data-ocid="send.confirm_button"
          className="h-12 w-full rounded-full text-sm font-semibold sm:flex-1"
        >
          <Lock className="size-4" aria-hidden="true" />
          Confirm payment
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          data-ocid="send.back_button"
          className="h-12 w-full rounded-full text-sm font-semibold sm:w-auto sm:px-6"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to edit
        </Button>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Confirmation is disabled in this demo build.
      </p>
    </div>
  );
}

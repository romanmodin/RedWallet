import { XbtAmountEstimate } from "@/components/settings/XbtAmountEstimate";
/**
 * TransactionRow — a single transaction card in the history list.
 *
 * Shows direction, status, relative date, the signed amount in the selected
 * display unit, and its fiat equivalent. The whole row is a real link to the
 * detail route so it is keyboard reachable and announced as a link.
 */

import { StatusBadge } from "@/components/history/StatusBadge";
import { formatAmount, formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DisplayUnit, Transaction } from "@/services/types";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  History,
} from "lucide-react";

interface TransactionRowProps {
  transaction: Transaction;
  displayUnit: DisplayUnit;
  /** 1-based position, used for deterministic test markers. */
  index: number;
}

export function TransactionRow({
  transaction,
  displayUnit,
  index,
}: TransactionRowProps) {
  const isReceive = transaction.direction === "receive";
  const DirectionIcon = transaction.isLive
    ? History
    : isReceive
      ? ArrowDownLeft
      : ArrowUpRight;
  const signedAmount = transaction.isLive
    ? "Amount unavailable"
    : `${isReceive ? "+" : "−"}${formatAmount(
        transaction.amountXbt,
        displayUnit,
      )}`;

  return (
    <Link
      to="/history/$id"
      params={{ id: transaction.id }}
      search={{}}
      data-ocid={`history.item.${index}`}
      aria-label={`${transaction.isLive ? "Transaction" : isReceive ? "Received" : "Sent"} ${formatAmount(
        transaction.amountXbt,
        displayUnit,
      )}, ${transaction.status}, ${transaction.isLive ? transaction.txid : formatRelativeDate(transaction.timestamp)}`}
      className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-smooth outline-none hover:-translate-y-0.5 hover:border-border/80 hover:bg-muted/40 hover:shadow-subtle focus-visible:ring-2 focus-visible:ring-ring sm:gap-4"
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full transition-smooth",
          isReceive
            ? "bg-success/12 text-success"
            : "bg-primary/12 text-primary",
        )}
        aria-hidden="true"
      >
        <DirectionIcon className="size-5" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-display text-sm font-semibold tracking-tight text-foreground">
            {transaction.isLive
              ? "Transaction"
              : isReceive
                ? "Received"
                : "Sent"}
          </span>
          <StatusBadge status={transaction.status} />
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {transaction.note || "No note"}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground/80">
          {transaction.isLive
            ? transaction.txid
            : formatRelativeDate(transaction.timestamp)}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span
          className={cn(
            "font-mono text-sm font-medium tabular-nums",
            isReceive ? "text-success" : "text-foreground",
          )}
        >
          {signedAmount}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {transaction.isLive ? (
            ""
          ) : (
            <XbtAmountEstimate amountXbt={transaction.amountXbt} />
          )}
        </span>
      </span>

      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground/60 transition-smooth group-hover:translate-x-0.5 group-hover:text-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

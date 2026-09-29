/**
 * RecentTransactions — the dashboard's latest-activity preview.
 *
 * Renders the most recent transactions for the active wallet as card rows
 * with direction, status, relative date, and a signed amount. Each row links
 * to its detail route; a "view all" link leads to the full history.
 */

import { EmptyState } from "@/components/states/EmptyState";
import {
  formatAmount,
  formatRelativeDate,
  truncateAddress,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  DisplayUnit,
  Transaction,
  TransactionStatus,
} from "@/services/types";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  History,
} from "lucide-react";

const STATUS_LABEL: Record<TransactionStatus, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  failed: "Failed",
};

const STATUS_CLASS: Record<TransactionStatus, string> = {
  confirmed: "bg-success/15 text-success",
  pending: "bg-accent/15 text-accent",
  failed: "bg-destructive/15 text-destructive",
};

interface RecentTransactionsProps {
  transactions: Transaction[];
  displayUnit: DisplayUnit;
  visible: boolean;
  className?: string;
}

export function RecentTransactions({
  transactions,
  displayUnit,
  visible,
  className,
}: RecentTransactionsProps) {
  return (
    <section
      data-ocid="dashboard.recent_transactions"
      aria-label="Recent transactions"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
          Recent activity
        </h2>
        <Link
          to="/history"
          data-ocid="dashboard.recent_transactions.view_all_link"
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-primary transition-smooth outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
        >
          View all
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {transactions.length === 0 ? (
        <EmptyState
          icon={History}
          title="No activity yet"
          description="Transactions for the selected address will appear here after the next refresh."
          action={
            <Link
              to="/receive"
              data-ocid="dashboard.recent_transactions.empty_state.action"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-smooth outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Receive
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {transactions.map((tx, index) => {
            const incoming = tx.direction === "receive";
            const Icon = tx.isLive
              ? History
              : incoming
                ? ArrowDownLeft
                : ArrowUpRight;
            const signed = tx.isLive
              ? "Amount unavailable"
              : `${incoming ? "+" : "−"}${formatAmount(tx.amountXbt, displayUnit)}`;
            return (
              <li
                key={tx.id}
                className="animate-fade-up"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <Link
                  to="/history/$id"
                  params={{ id: tx.id }}
                  data-ocid={`dashboard.recent_transactions.item.${index + 1}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-subtle transition-smooth outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full",
                      incoming
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {tx.note || (incoming ? "Received" : "Sent")}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate font-mono">
                        {truncateAddress(
                          tx.isLive ? tx.txid : tx.counterpartyAddress,
                        )}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">
                        {tx.isLive
                          ? "Time unavailable"
                          : formatRelativeDate(tx.timestamp)}
                      </span>
                    </span>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold tabular-nums",
                        incoming ? "text-success" : "text-foreground",
                      )}
                    >
                      {visible ? signed : "••••"}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        STATUS_CLASS[tx.status],
                      )}
                    >
                      {STATUS_LABEL[tx.status]}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

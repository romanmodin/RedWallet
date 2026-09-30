/**
 * TransactionDetailPage — full metadata for a single demo transaction.
 *
 * Reads the transaction id from the route params and loads it through the
 * typed service layer. Handles loading, offline, error, and unknown-id
 * (not-found) states, and offers a back action to the history list.
 */

import { StatusBadge } from "@/components/history/StatusBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { OfflineState } from "@/components/states/OfflineState";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { formatAmount, formatFiat, truncateAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { bridgeWalletService } from "@/services/bridgeService";
import {
  PROVIDER_EVENT,
  providerGeneration,
} from "@/services/networkGeneration";
import type { ServiceError, Transaction } from "@/services/types";
import { Link, useParams } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
  FileQuestion,
  History,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface DetailRow {
  label: string;
  value: string;
  mono?: boolean;
  /** Render a copy control for this value. */
  copyValue?: string;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TransactionDetailPage() {
  const { id } = useParams({ from: "/history/$id" });
  const { settings } = useSettings();

  const request = useRef(0);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ServiceError | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    const generation = providerGeneration();
    setTransaction(null);
    setIsLoading(true);
    const result = await bridgeWalletService.getTransaction(id);
    if (sequence !== request.current || generation !== providerGeneration())
      return;
    if (result.ok) {
      setTransaction(result.value);
      setError(null);
      setIsOffline(false);
      setNotFound(false);
    } else if (result.error.code === "not_found") {
      setNotFound(true);
      setError(null);
      setIsOffline(false);
    } else if (
      result.error.code === "network" ||
      result.error.code === "timeout"
    ) {
      setIsOffline(true);
      setError(null);
      setNotFound(false);
    } else {
      setError(result.error);
      setIsOffline(false);
      setNotFound(false);
    }
    setIsLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    const changed = () => {
      request.current++;
      setTransaction(null);
      void load();
    };
    window.addEventListener(PROVIDER_EVENT, changed);
    return () => {
      request.current++;
      window.removeEventListener(PROVIDER_EVENT, changed);
    };
  }, [load]);

  const copyAddress = useCallback(async () => {
    if (!transaction) return;
    try {
      await navigator.clipboard.writeText(transaction.counterpartyAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [transaction]);

  const backAction = (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="rounded-full"
      data-ocid="history.detail.back_to_list_button"
    >
      <Link to="/history" search={{}}>
        <History className="size-4" aria-hidden="true" />
        All activity
      </Link>
    </Button>
  );

  if (isLoading) {
    return (
      <section data-ocid="history.detail.page" className="flex flex-col">
        <PageHeader title="Transaction" showBack />
        <LoadingState rows={4} label="Loading transaction" />
      </section>
    );
  }

  if (isOffline) {
    return (
      <section data-ocid="history.detail.page" className="flex flex-col">
        <PageHeader title="Transaction" showBack />
        <OfflineState onRetry={() => void load()} />
      </section>
    );
  }

  if (error) {
    return (
      <section data-ocid="history.detail.page" className="flex flex-col">
        <PageHeader title="Transaction" showBack />
        <ErrorState
          title="Couldn't load this transaction"
          description={error.message}
          onRetry={() => void load()}
        />
      </section>
    );
  }

  if (notFound || !transaction) {
    return (
      <section data-ocid="history.detail.page" className="flex flex-col">
        <PageHeader title="Transaction" showBack />
        <EmptyState
          icon={FileQuestion}
          title="Transaction not found"
          description="We couldn't find a demo transaction with that id. It may have been removed, or the link may be incorrect."
          action={backAction}
        />
      </section>
    );
  }

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
        transaction.isLive ? "XBT" : settings.displayUnit,
      )}`;

  const rows: DetailRow[] = [
    {
      label: "Transaction ID",
      value: transaction.txid,
      mono: true,
      copyValue: transaction.txid,
    },
    {
      label: "Direction",
      value: transaction.isLive
        ? "Unavailable"
        : isReceive
          ? "Received"
          : "Sent",
    },
    {
      label: transaction.isLive ? "Block inclusion" : "Confirmations",
      value: transaction.isLive
        ? transaction.blockHeight && transaction.blockHeight > 0
          ? `Included in block ${transaction.blockHeight}`
          : "Awaiting confirmation"
        : transaction.confirmations > 0
          ? transaction.confirmations.toLocaleString("en-US")
          : "Awaiting confirmation",
    },
    {
      label: "Amount",
      value: formatAmount(
        transaction.amountXbt,
        transaction.isLive ? "XBT" : settings.displayUnit,
      ),
      mono: true,
    },
    {
      label: "Network fee",
      value: formatAmount(
        transaction.feeXbt,
        transaction.isLive ? "XBT" : settings.displayUnit,
      ),
      mono: true,
    },
    {
      label: "Fiat value",
      value: formatFiat(transaction.fiatUsd),
      mono: true,
    },
    {
      label: "Timestamp",
      value: formatTimestamp(transaction.timestamp),
    },
  ];

  return (
    <section data-ocid="history.detail.page" className="flex flex-col">
      <PageHeader title="Transaction" showBack action={backAction} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 rounded-[20px] border border-border bg-card p-6 text-center shadow-subtle animate-fade-up">
          <span
            className={cn(
              "flex size-14 items-center justify-center rounded-full",
              isReceive
                ? "bg-success/12 text-success"
                : "bg-primary/12 text-primary",
            )}
            aria-hidden="true"
          >
            <DirectionIcon className="size-6" />
          </span>
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-sm font-semibold tracking-tight text-foreground">
              {transaction.isLive
                ? "Transaction"
                : isReceive
                  ? "Received"
                  : "Sent"}
            </span>
            <output
              data-ocid="history.detail.amount"
              aria-live="polite"
              className={cn(
                "font-mono text-2xl font-bold tabular-nums",
                isReceive ? "text-success" : "text-foreground",
              )}
            >
              {signedAmount}
            </output>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {transaction.isLive
                ? "Amount and time are not supplied by address history"
                : `≈ ${formatFiat(transaction.fiatUsd)}`}
            </span>
          </div>
          <StatusBadge status={transaction.status} />
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-subtle">
          <h2 className="mb-3 font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Details
          </h2>
          <dl className="flex flex-col divide-y divide-border/70">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <dt className="shrink-0 text-sm text-muted-foreground">
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    "min-w-0 break-all text-right text-sm text-foreground",
                    row.mono && "font-mono text-xs tabular-nums",
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {!transaction.isLive ? (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-subtle">
            <h2 className="mb-3 font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Counterparty
            </h2>
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/40 p-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-foreground">
                  {truncateAddress(transaction.counterpartyAddress, 14, 8)}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {isReceive ? "Sending address" : "Recipient address"}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={copied ? "Address copied" : "Copy address"}
                data-ocid="history.detail.copy_address_button"
                onClick={() => void copyAddress()}
                className="size-10 shrink-0 rounded-full"
              >
                {copied ? (
                  <Check className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
            {copied ? (
              <output
                data-ocid="history.detail.copy_success"
                aria-live="polite"
                className="mt-2 block text-xs text-success"
              >
                Address copied to clipboard
              </output>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-2xl border border-border bg-card p-4 shadow-subtle">
          <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Note
          </h2>
          <p className="text-sm leading-relaxed text-foreground">
            {transaction.note || "No note was added to this transaction."}
          </p>
        </div>

        <p className="rounded-2xl border border-accent/30 bg-accent/[0.07] px-3.5 py-2.5 text-xs leading-relaxed text-accent/90">
          {transaction.isLive
            ? "Live XBT address history from the configured Fulcrum bridge. Unavailable details are left blank."
            : "Demo record — this transaction is simulated and was never signed or broadcast to any network."}
        </p>
      </div>
    </section>
  );
}

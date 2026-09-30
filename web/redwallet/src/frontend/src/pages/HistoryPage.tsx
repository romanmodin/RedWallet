/**
 * HistoryPage — chronological transaction history for the active wallet.
 *
 * Filters (status, direction, search) live in the URL search state so the
 * view is shareable and survives navigation. Data comes from the typed
 * service layer via the wallet context; the mock adapter is never imported
 * directly here.
 */

import {
  type DirectionFilter,
  type StatusFilter,
  TransactionFilters,
} from "@/components/history/TransactionFilters";
import { TransactionList } from "@/components/history/TransactionList";
import { LocalWalletEntry } from "@/components/layout/LocalWalletEntry";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { OfflineState } from "@/components/states/OfflineState";
import { useSettings } from "@/hooks/useSettings";
import { useWallet } from "@/hooks/useWallet";
import { bridgeWalletService } from "@/services/bridgeService";
import type { ServiceError, Transaction } from "@/services/types";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { History, SearchX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Search params accepted by the history route. */
export interface HistorySearch {
  status?: StatusFilter;
  direction?: DirectionFilter;
  q?: string;
}

const STATUS_VALUES: StatusFilter[] = ["all", "confirmed", "pending", "failed"];
const DIRECTION_VALUES: DirectionFilter[] = ["all", "receive", "send"];

/** Validate and coerce raw search params into a `HistorySearch`. */
export function validateHistorySearch(
  search: Record<string, unknown>,
): HistorySearch {
  const status = STATUS_VALUES.includes(search.status as StatusFilter)
    ? (search.status as StatusFilter)
    : undefined;
  const direction = DIRECTION_VALUES.includes(
    search.direction as DirectionFilter,
  )
    ? (search.direction as DirectionFilter)
    : undefined;
  const q = typeof search.q === "string" && search.q ? search.q : undefined;
  return { status, direction, q };
}

export function HistoryPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/history" });
  const {
    activeWallet,
    isLoading: walletLoading,
    error: walletError,
  } = useWallet();
  const { settings } = useSettings();

  const status: StatusFilter = search.status ?? "all";
  const direction: DirectionFilter = search.direction ?? "all";
  const query = search.q ?? "";

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const requestSequence = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ServiceError | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const load = useCallback(async () => {
    if (!activeWallet) return;
    const request = ++requestSequence.current;
    setTransactions([]);
    setIsLoading(true);
    const result = await bridgeWalletService.listTransactions(activeWallet.id, {
      status,
      direction,
      query,
    });
    if (request !== requestSequence.current) return;
    if (result.ok) {
      setTransactions(result.value);
      setError(null);
      setIsOffline(false);
    } else if (
      result.error.code === "network" ||
      result.error.code === "timeout"
    ) {
      setIsOffline(true);
      setError(null);
    } else {
      setError(result.error);
      setIsOffline(false);
    }
    setIsLoading(false);
  }, [activeWallet, status, direction, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const setFilters = useCallback(
    (patch: Partial<HistorySearch>) => {
      void navigate({
        to: "/history",
        search: (prev: HistorySearch) => ({ ...prev, ...patch }),
        replace: true,
      });
    },
    [navigate],
  );

  const hasActiveFilters =
    status !== "all" || direction !== "all" || query.trim() !== "";

  const clearFilters = useCallback(() => {
    void navigate({ to: "/history", search: {}, replace: true });
  }, [navigate]);

  const showLoading = walletLoading || (isLoading && transactions.length === 0);

  return (
    <section data-ocid="history.page" className="flex flex-col">
      <LocalWalletEntry purpose="history" />
      <PageHeader
        title="Activity"
        description={
          activeWallet
            ? `${activeWallet.name} · ${activeWallet.isDemo ? "demo transactions" : "XBT address history"}`
            : "Every demo transaction"
        }
      />

      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/[0.07] px-3.5 py-2.5">
        <span
          className="size-1.5 shrink-0 rounded-full bg-accent animate-pulse-soft"
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed text-accent/90">
          {activeWallet?.isDemo !== false
            ? "Demo data — these transactions are simulated and were never broadcast to any network."
            : "Live address history. Amount, direction, and time are unavailable from this endpoint."}
        </p>
      </div>

      <TransactionFilters
        status={status}
        direction={direction}
        query={query}
        hasActiveFilters={hasActiveFilters}
        onStatusChange={(next) => setFilters({ status: next })}
        onDirectionChange={(next) => setFilters({ direction: next })}
        onQueryChange={(next) => setFilters({ q: next || undefined })}
        onClear={clearFilters}
      />

      <div className="mt-5">
        {showLoading ? (
          <LoadingState rows={5} label="Loading transactions" />
        ) : isOffline ? (
          <OfflineState onRetry={() => void load()} />
        ) : error || walletError ? (
          <ErrorState
            title="Couldn't load activity"
            description={
              (error ?? walletError)?.message ??
              "We couldn't load your transactions. Try again in a moment."
            }
            onRetry={() => void load()}
          />
        ) : transactions.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No matching transactions"
              description="No transactions match the current filters. Try widening your search or clearing the filters."
              action={
                <button
                  type="button"
                  data-ocid="history.empty_state.clear_filters_button"
                  onClick={clearFilters}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-smooth outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={History}
              title="No activity yet"
              description={
                activeWallet?.isDemo !== false
                  ? "This demo wallet has no transactions."
                  : "No transactions were reported for this XBT address."
              }
            />
          )
        ) : (
          <TransactionList
            transactions={transactions}
            displayUnit={
              activeWallet?.isDemo !== false ? settings.displayUnit : "XBT"
            }
          />
        )}
      </div>
    </section>
  );
}

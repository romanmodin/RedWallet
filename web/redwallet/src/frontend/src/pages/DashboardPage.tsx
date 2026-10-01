/**
 * DashboardPage — the default landing route at "/".
 *
 * Shows the active demo wallet's balance, quick actions, a compact network
 * status chip, and a preview of the latest transactions. All data comes from
 * the typed service layer via WalletContext and useSettings; every amount is
 * labeled as demo data.
 */

import { BalanceCard } from "@/components/dashboard/BalanceCard";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { LocalWalletEntry } from "@/components/layout/LocalWalletEntry";
import { NetworkIndicator } from "@/components/layout/NetworkIndicator";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { OfflineState } from "@/components/states/OfflineState";
import { Button } from "@/components/ui/button";
import { useLocalAccount } from "@/components/vault/LocalAccountContext";
import { LocalAccountOverview } from "@/components/vault/LocalAccountOverview";
import { useSettings } from "@/hooks/useSettings";
import { useWallet } from "@/hooks/useWallet";
import { bridgeWalletService } from "@/services/bridgeService";
import type { Transaction } from "@/services/types";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const RECENT_LIMIT = 5;

export function DashboardPage() {
  const local = useLocalAccount();
  return local?.selected ? (
    <LocalAccountOverview key={local.selected.id} selected={local.selected} />
  ) : (
    <WatchedDashboardPage />
  );
}

function WatchedDashboardPage() {
  const { activeWallet, isLoading, error, refresh } = useWallet();
  const { settings } = useSettings();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const requestSequence = useRef(0);
  const [isOffline, setIsOffline] = useState(false);
  const [isLoadingActivity, setIsLoadingActivity] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  const walletId = activeWallet?.id ?? null;

  const loadActivity = useCallback(async () => {
    if (!walletId) {
      ++requestSequence.current;
      setTransactions([]);
      setIsLoadingActivity(false);
      return;
    }
    const request = ++requestSequence.current;
    setTransactions([]);
    setIsLoadingActivity(true);
    const result = await bridgeWalletService.listTransactions(walletId);
    if (request !== requestSequence.current) return;
    if (result.ok) {
      setTransactions(result.value.slice(0, RECENT_LIMIT));
      setActivityError(null);
    } else {
      setTransactions([]);
      setActivityError(result.error.message);
    }
    setIsLoadingActivity(false);
  }, [walletId]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const handleRetry = useCallback(() => {
    void refresh();
    void loadActivity();
  }, [refresh, loadActivity]);

  return (
    <section data-ocid="dashboard.page" className="flex flex-col gap-6">
      <LocalWalletEntry purpose="home" />
      <PageHeader
        title="Dashboard"
        description={
          !activeWallet
            ? "Add or recover a wallet to get started"
            : activeWallet.isDemo
              ? "Your demo wallet at a glance"
              : "Your watched XBT address at a glance"
        }
        action={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={isLoading || isLoadingActivity}
              aria-label="Refresh wallet"
            >
              <RefreshCw className="size-4" />
            </Button>
            <NetworkIndicator compact />
          </div>
        }
      />

      {isOffline ? (
        <OfflineState onRetry={handleRetry} />
      ) : error ? (
        <ErrorState
          title="Couldn't load your wallet"
          description={error.message}
          onRetry={handleRetry}
        />
      ) : isLoading ? (
        <LoadingState rows={4} label="Loading your wallet" />
      ) : !activeWallet ? (
        <EmptyState
          title="No wallet selected"
          description="Add a public address, create an encrypted wallet, or recover your wallet from a backup."
          action={
            <Button asChild>
              <Link to="/wallets">Open wallets</Link>
            </Button>
          }
        />
      ) : (
        <>
          <BalanceCard
            isDemo={activeWallet.isDemo}
            balanceError={activeWallet.balanceError}
            walletName={activeWallet.name}
            walletShortId={activeWallet.shortId}
            balanceXbt={activeWallet.balanceXbt}
            fiatUsd={Number.NaN}
            displayUnit={activeWallet.isDemo ? settings.displayUnit : "XBT"}
            visible={visible}
            onToggleVisibility={() => setVisible((current) => !current)}
          />

          <QuickActions />

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-subtle">
            <div className="flex min-w-0 flex-col">
              <span className="font-display text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Network
              </span>
              <span className="truncate text-sm text-foreground">
                {activeWallet.isDemo
                  ? "XBT network — demo, not configured"
                  : "XBT · read-only Fulcrum bridge"}
              </span>
            </div>
            <NetworkIndicator compact />
          </div>

          {activityError ? (
            <ErrorState
              title="Couldn't load activity"
              description={activityError}
              onRetry={handleRetry}
            />
          ) : isLoadingActivity ? (
            <LoadingState rows={3} label="Loading recent activity" />
          ) : (
            <RecentTransactions
              transactions={transactions}
              displayUnit={activeWallet.isDemo ? settings.displayUnit : "XBT"}
              visible={visible}
            />
          )}

          <p className="text-center text-[11px] text-muted-foreground">
            Estimates use the XBT price source selected in Settings. Demo
            balances are simulated.
          </p>
        </>
      )}
    </section>
  );
}

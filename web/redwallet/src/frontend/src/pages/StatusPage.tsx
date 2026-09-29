/**
 * StatusPage — network and backend status screen at "/status".
 *
 * Reads the selected server from user settings and the network status from the
 * bridge-backed wallet service. Renders a connection-state readout, the server
 * summary, and a sync readout, with a manual refresh action. When no bridge is
 * configured the read reports the offline-by-design state and the page prompts
 * the user to open Settings; it never substitutes a public server.
 */

import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { OfflineState } from "@/components/states/OfflineState";
import { ConnectionCard } from "@/components/status/ConnectionCard";
import { SyncReadout } from "@/components/status/SyncReadout";
import { Button } from "@/components/ui/button";
import { bridgeWalletService } from "@/services/bridgeService";
import type { ConnectionState, NetworkStatus } from "@/services/types";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function StatusPage() {
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const result = await bridgeWalletService.getNetworkStatus();
    if (result.ok) {
      setStatus(result.value);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void loadStatus().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadStatus();
    setIsRefreshing(false);
  }, [loadStatus]);

  /**
   * The effective connection state. The read reports the live bridge state
   * when one is configured and the offline-by-design demo state otherwise —
   * the app never falls back to a public server.
   */
  const connectionState: ConnectionState = isRefreshing
    ? "connecting"
    : (status?.state ?? "offline");

  const refreshButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void handleRefresh()}
      disabled={isRefreshing}
      data-ocid="status.refresh_button"
      className="rounded-xl border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
    >
      <RefreshCw
        className={isRefreshing ? "size-4 animate-spin" : "size-4"}
        aria-hidden="true"
      />
      {isRefreshing ? "Refreshing…" : "Refresh"}
    </Button>
  );

  return (
    <section data-ocid="status.page" className="flex flex-col gap-5">
      <PageHeader
        title="Network"
        description="Server connection and sync status"
        action={refreshButton}
      />

      {isLoading ? (
        <LoadingState rows={3} label="Loading network status" />
      ) : error ? (
        <ErrorState
          title="Couldn't load network status"
          description={error}
          onRetry={() => void handleRefresh()}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <ConnectionCard
              state={connectionState}
              isRefreshing={isRefreshing}
            />
            <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              The deployment operator manages the Fulcrum bridge. Connection
              details and credentials are kept on the server.
            </div>
          </div>

          <div className="flex flex-col gap-5">
            {connectionState === "offline" ? (
              <OfflineState
                title="Not connected to a server"
                description="The operator must configure a reachable Fulcrum bridge before live wallet reads are available."
                onRetry={() => void handleRefresh()}
              />
            ) : null}

            {status ? (
              <SyncReadout
                isLive={status.state === "connected"}
                blockHeight={status.blockHeight}
                lastSyncedAt={status.lastSyncedAt}
                peers={status.peers}
                checkpointConfigured={status.checkpointConfigured}
              />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

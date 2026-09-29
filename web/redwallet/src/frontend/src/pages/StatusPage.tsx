/**
 * StatusPage — network and backend status screen at "/status".
 *
 * Reads the shared network status from `useNetworkStatus`, the same source the
 * header/sidebar/top-bar indicators subscribe to. Its manual refresh triggers
 * the shared refresh, so every indicator updates together. When no bridge is
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
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { RefreshCw } from "lucide-react";

export function StatusPage() {
  const { status, connectionState, isLoading, isRefreshing, error, refresh } =
    useNetworkStatus();

  const refreshButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void refresh()}
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
          description={error.message}
          onRetry={() => void refresh()}
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
                onRetry={() => void refresh()}
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

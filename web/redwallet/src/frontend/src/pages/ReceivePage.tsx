/**
 * ReceivePage — demo receive address, QR code, and wallet context.
 *
 * Mobile-first: a single centered column with a large, scannable QR code at
 * phone width that settles into a comfortable centered card at lg. The active
 * wallet name is shown with a link to switch wallets. Loading, error, and
 * offline states are handled explicitly.
 */

import { LocalWalletEntry } from "@/components/layout/LocalWalletEntry";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/receive/AddressDisplay";
import { QrCodeCard } from "@/components/receive/QrCodeCard";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { OfflineState } from "@/components/states/OfflineState";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The demo receive address shown on this screen.
 *
 * This is an unmistakably invalid placeholder string. It is not a real wallet
 * address, is not derived from key material, has no valid XBT prefix, and
 * cannot receive funds.
 */
const DEMO_RECEIVE_ADDRESS = "xbt-demo-address-not-valid";

export function ReceivePage() {
  const { activeWallet, isLoading, error, refresh } = useWallet();
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  useEffect(() => {
    function goOnline() {
      setIsOffline(false);
    }
    function goOffline() {
      setIsOffline(true);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const address = activeWallet
    ? activeWallet.isDemo
      ? DEMO_RECEIVE_ADDRESS
      : (activeWallet.address ?? "")
    : "";
  const isDemo = activeWallet?.isDemo !== false;

  return (
    <section data-ocid="receive.page" className="animate-fade-up">
      <LocalWalletEntry purpose="receive" />
      <PageHeader
        title="Receive"
        description={
          isDemo
            ? "Share a demo receiving address"
            : "Share the XBT address you added"
        }
      />

      <div className="mx-auto flex w-full max-w-md flex-col gap-5 lg:max-w-lg">
        {isOffline ? (
          <OfflineState
            description="RedWallet can't reach the configured server. Reconnect to load your demo receive address — your demo data is safe."
            onRetry={() => {
              void refresh();
            }}
          />
        ) : isLoading ? (
          <LoadingState rows={3} label="Loading demo receive address" />
        ) : error || !activeWallet || !address ? (
          <ErrorState
            title="Couldn't load the receive address"
            description={
              error?.message ??
              "No active demo wallet is selected. Choose a wallet and try again."
            }
            onRetry={() => {
              void refresh();
            }}
          />
        ) : (
          <>
            <QrCodeCard address={address} isDemo={isDemo} />

            <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-subtle sm:p-6">
              <AddressDisplay address={address} isDemo={isDemo} />

              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Receiving into
                    </span>
                    <span
                      data-ocid="receive.wallet_name"
                      className="truncate font-display text-base font-semibold text-foreground"
                    >
                      {activeWallet.name}
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    <ShieldCheck
                      className="size-3.5 text-success"
                      aria-hidden="true"
                    />
                    {isDemo ? "Demo wallet" : "Watch-only address"}
                  </span>
                </div>

                <Button
                  asChild
                  variant="outline"
                  className="h-11 w-full rounded-full"
                >
                  <Link to="/wallets" data-ocid="receive.switch_wallet_link">
                    <ArrowLeftRight className="size-4" aria-hidden="true" />
                    Switch wallet
                  </Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

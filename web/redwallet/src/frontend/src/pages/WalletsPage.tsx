/**
 * WalletsPage — demo wallet / account selector.
 *
 * Lists the demo wallets, marks the active one, and lets the user switch the
 * active wallet (reflected everywhere the wallet context is consumed) or add
 * a new clearly-labeled demo wallet by name. No keys, mnemonics, imports, or
 * address derivation exist anywhere on this screen.
 */

import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocalWalletWorkspace } from "@/components/vault/LocalWalletWorkspace";
import { WalletList } from "@/components/wallets/WalletList";
import { useSettings } from "@/hooks/useSettings";
import { useWallet } from "@/hooks/useWallet";
import { useNavigate } from "@tanstack/react-router";
import { Plus, ShieldCheck, Wallet as WalletIcon } from "lucide-react";
import { useState } from "react";

export function WalletsPage() {
  const {
    wallets,
    activeWallet,
    isLoading,
    error,
    refresh,
    selectWallet,
    addWallet,
  } = useWallet();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [watchOnly, setWatchOnly] = useState(true);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);

  const handleSelect = async (walletId: string) => {
    if (walletId === activeWallet?.id) return;
    setIsSelecting(true);
    await selectWallet(walletId);
    setIsSelecting(false);
    void navigate({ to: "/" });
  };

  const handleAdd = async () => {
    const name = draftName.trim();
    if (!name) {
      setAddError("Enter a name for the wallet.");
      return;
    }
    setIsAdding(true);
    setAddError(null);
    const created = await addWallet(name, watchOnly ? draftAddress : undefined);
    setIsAdding(false);
    if (!created) {
      setAddError(
        "Could not add the wallet. Check the address and backend connection, then retry.",
      );
      return;
    }
    setDraftName("");
    setDraftAddress("");
    setIsAddOpen(false);
    if (watchOnly) {
      await selectWallet(created.id);
      void navigate({ to: "/" });
    }
  };

  const openAddDialog = () => {
    setDraftName("");
    setDraftAddress("");
    setAddError(null);
    setIsAddOpen(true);
  };

  const addAction = (
    <Button
      type="button"
      onClick={openAddDialog}
      data-ocid="wallets.add_button"
      className="rounded-xl bg-gradient-primary text-primary-foreground shadow-card-red transition-smooth hover:brightness-110"
    >
      <Plus className="size-4" aria-hidden="true" />
      Add wallet
    </Button>
  );

  return (
    <section data-ocid="wallets.page" className="flex flex-col">
      <PageHeader
        title="Wallets"
        description="Manage watched addresses and local encrypted XBT wallets"
        action={addAction}
      />

      <LocalWalletWorkspace />
      <h2 className="mb-3 mt-8 font-display text-lg font-semibold">
        Watched addresses and demo accounts
      </h2>

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/[0.07] p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-display text-sm font-semibold tracking-tight text-foreground">
            Watch-only wallets
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Add your public XBT address to view its live balance and history.
            The wallet that owns the address keeps your keys. Demo accounts are
            labelled.
          </p>
        </div>
      </div>

      {isLoading ? (
        <LoadingState rows={3} label="Loading wallets" />
      ) : error ? (
        <ErrorState
          title="We couldn't load your wallets"
          description={error.message}
          onRetry={() => void refresh()}
        />
      ) : wallets.length === 0 ? (
        <EmptyState
          icon={WalletIcon}
          title="No wallets yet"
          description="Add an XBT address to watch its balance."
          action={addAction}
        />
      ) : (
        <WalletList
          wallets={wallets}
          activeWalletId={activeWallet?.id ?? null}
          displayUnit={settings.displayUnit}
          disabled={isSelecting}
          onSelect={(walletId) => void handleSelect(walletId)}
        />
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent data-ocid="wallets.add_dialog">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">
              Add a wallet
            </DialogTitle>
            <DialogDescription>
              Enter a public address from your existing XBT wallet. Watch-only
              mode cannot sign or send funds. Never enter a seed phrase or
              private key.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-kind">Wallet type</Label>
            <select
              id="wallet-kind"
              value={watchOnly ? "watch" : "demo"}
              onChange={(e) => setWatchOnly(e.target.value === "watch")}
              className="rounded-xl border border-border bg-background p-2"
            >
              <option value="watch">Watch-only XBT address</option>
              <option value="demo">Demo account (simulated)</option>
            </select>
            <Label htmlFor="demo-wallet-name">Wallet name</Label>
            <Input
              id="demo-wallet-name"
              data-ocid="wallets.name_input"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="e.g. Travel Fund"
              autoComplete="off"
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? "demo-wallet-name-error" : undefined}
            />
            {watchOnly ? (
              <>
                <Label htmlFor="watch-address">Public XBT address</Label>
                <Input
                  id="watch-address"
                  data-ocid="wallets.address_input"
                  value={draftAddress}
                  onChange={(e) => setDraftAddress(e.target.value)}
                  placeholder="Paste an address from your XBT wallet"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Confirm this is your address on the XBT network. A matching
                  address format does not establish ownership.
                </p>
              </>
            ) : null}
            {addError ? (
              <p
                id="demo-wallet-name-error"
                data-ocid="wallets.name_error"
                className="text-xs font-medium text-destructive"
              >
                {error?.message ?? addError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddOpen(false)}
              data-ocid="wallets.cancel_button"
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleAdd()}
              disabled={
                isAdding ||
                draftName.trim().length === 0 ||
                (watchOnly && !draftAddress.trim())
              }
              data-ocid="wallets.submit_button"
              className="rounded-xl bg-gradient-primary text-primary-foreground shadow-card-red transition-smooth hover:brightness-110"
            >
              {isAdding ? "Adding…" : "Add wallet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

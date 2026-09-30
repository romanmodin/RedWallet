import type { backendInterface } from "@/backend";
import type { AccountSnapshot } from "@/lib/xbt/account-reader";
import { clearAccountViewSessions } from "@/lib/xbt/account-view-session";
import { IssuedAddresses } from "@/lib/xbt/issued-addresses";
import { VaultCatalog } from "@/lib/xbt/vault-catalog";
import { type BridgeActor, resolveBridgeActor } from "@/services/bridgeService";
import {
  PROVIDER_EVENT,
  providerGeneration,
} from "@/services/networkGeneration";
import { useEffect, useMemo, useState } from "react";
import { AccountReadPanel } from "./AccountReadPanel";
import {
  type LocalAccountSelection,
  useLocalAccount,
} from "./LocalAccountContext";
import { LocalVaultPanel } from "./LocalVaultPanel";
import { SendPaymentPanel } from "./SendPaymentPanel";
import { WalletCompatibilityCheck } from "./WalletCompatibilityCheck";

/** Local keys are scoped to this workspace. Only authenticated public account data reaches reads. */
export function LocalWalletWorkspace({
  purpose = "wallets",
}: { purpose?: "wallets" | "send" | "receive" }) {
  const [protectedPage, setProtectedPage] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setProtectedPage(root.dataset.remoteScriptProtection === "blocked");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-remote-script-protection"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="mt-6 space-y-4">
      {protectedPage ? (
        <ProtectedLocalWorkspace purpose={purpose} />
      ) : (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Encrypted wallet setup is unavailable until this page confirms that
          its external-script restriction is enforced. Watched public addresses
          remain available.
        </p>
      )}
    </div>
  );
}

function ProtectedLocalWorkspace({
  purpose,
}: { purpose: "wallets" | "send" | "receive" }) {
  const local = useLocalAccount();
  const [providerVersion, setProviderVersion] = useState(providerGeneration);
  useEffect(() => {
    const changed = () => setProviderVersion(providerGeneration());
    window.addEventListener(PROVIDER_EVENT, changed);
    return () => window.removeEventListener(PROVIDER_EVENT, changed);
  }, []);
  const [catalog] = useState(() => {
    try {
      return new VaultCatalog(window.localStorage);
    } catch {
      return null;
    }
  });
  const [selected, setSelected] = useState<LocalAccountSelection | null>(
    local?.selected ?? null,
  );
  const [actor, setActor] = useState<BridgeActor | null>(null);
  const [actorError, setActorError] = useState(false);
  const [locked, setLocked] = useState(true);
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const book = useMemo(() => {
    if (!selected) return null;
    try {
      return new IssuedAddresses(
        selected.account.accountXpub,
        window.localStorage,
      );
    } catch {
      return null;
    }
  }, [selected]);
  useEffect(() => {
    const generation = providerVersion;
    let current = true;
    setActor(null);
    setActorError(false);
    setSnapshot(null);
    if (selected)
      void resolveBridgeActor().then((value) => {
        if (current && generation === providerGeneration()) {
          setActor(value);
          setActorError(value === null);
        }
      });
    return () => {
      current = false;
    };
  }, [selected, providerVersion]);
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("redwallet.vault.v1.")) {
        clearAccountViewSessions();
        setSelected(null);
        local?.select(null);
      }
    };
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("storage", storage);
      catalog?.lockAll();
    };
  }, [catalog, local?.select]);
  if (!catalog)
    return (
      <p role="alert">
        Encrypted wallet storage is unavailable in this browser.
      </p>
    );
  return (
    <>
      {purpose === "wallets" && <WalletCompatibilityCheck />}
      <LocalVaultPanel
        catalog={catalog}
        onUnlocked={(id, account) => {
          const name =
            catalog.list().find((vault) => vault.id === id)?.name ??
            `Encrypted wallet ${id.slice(0, 8)}`;
          local?.select({ id, account, name });
          setSelected((current) =>
            !actorError &&
            current?.id === id &&
            current.account.accountXpub === account.accountXpub
              ? current
              : { id, account, name },
          );
          setLocked(false);
        }}
        onLocked={() => setLocked(true)}
      />
      {selected && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Public account: {`Encrypted wallet ${selected.id.slice(0, 8)}`}.{" "}
            {locked
              ? "Keys are locked; public account reads can continue."
              : "Keys lock after five minutes or when you leave this page."}
          </p>
          {!book && (
            <p role="alert">
              Could not open the saved address index. Keep your recovery backup.
            </p>
          )}
          {actorError && (
            <p role="alert">
              The configured account backend is unavailable. Unlock again after
              the connection is restored.
            </p>
          )}
          {book && actor && (
            <>
              <AccountReadPanel
                key={`read:${selected.id}`}
                account={selected.account}
                actor={actor}
                addressBook={book}
                onSnapshot={setSnapshot}
                showHistory={purpose === "wallets"}
              />
              {purpose !== "receive" && (
                <SendPaymentPanel
                  key={selected.id}
                  account={selected.account}
                  actor={actor as backendInterface}
                  addressBook={book}
                  snapshot={snapshot}
                  controller={catalog.controller(selected.id)}
                  locked={locked}
                />
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

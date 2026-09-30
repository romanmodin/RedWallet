import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { PROVIDER_EVENT } from "@/services/networkGeneration";
import {
  BUILTIN_BACKUPS,
  type CustomProvider,
  HOME_ADAPTER,
  providerRouter,
  readProviderSelection,
  saveProviderSelection,
  validateCustomProvider,
} from "@/services/providerService";
import { useEffect, useState } from "react";
const empty: CustomProvider = {
  host: "",
  port: 50002,
  tls: true,
  endpoint: "",
  canisterId: "",
  allowBuiltinFallback: false,
};
export function NetworkSetting() {
  const network = useNetworkStatus();
  const [selection, setSelection] = useState(readProviderSelection);
  const [form, setForm] = useState<CustomProvider>(() =>
    selection.mode === "custom" ? selection.config : empty,
  );
  const [editing, setEditing] = useState(selection.mode === "custom");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const changed = () => setSelection(readProviderSelection());
    window.addEventListener(PROVIDER_EVENT, changed);
    return () => window.removeEventListener(PROVIDER_EVENT, changed);
  }, []);
  async function test(save = false) {
    setBusy(true);
    setMessage("");
    const exact = JSON.stringify(form);
    try {
      const config = validateCustomProvider(form);
      const info = await providerRouter.test(config);
      if (exact !== JSON.stringify(form)) return;
      if (save) {
        saveProviderSelection({ mode: "custom", config });
        setSelection(readProviderSelection());
        void network.refresh();
      }
      setMessage(
        `${save ? "Saved. " : "Test passed. "}Entered Fulcrum identity and pinned XBT checkpoint verified at block ${info.height}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }
  function builtin() {
    try {
      saveProviderSelection({ mode: "builtin" });
      setSelection({ mode: "builtin" });
      setEditing(false);
      setMessage(
        "Built-in service selected. Wallet data and signed receipts are preserved.",
      );
      void network.refresh();
    } catch {
      setMessage("Could not save provider selection on this device.");
    }
  }
  const active = providerRouter.current();
  return (
    <div data-ocid="settings.network" className="space-y-4">
      <p className="font-semibold text-sm">XBT network · wallet bridge</p>
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="sr-only">Network provider</legend>
        <label className="flex gap-2 rounded-xl border border-border p-3">
          <input
            type="radio"
            name="provider"
            checked={!editing && selection.mode === "builtin"}
            onChange={builtin}
          />
          Built-in RedWallet service
        </label>
        <label className="flex gap-2 rounded-xl border border-border p-3">
          <input
            type="radio"
            name="provider"
            checked={editing}
            onChange={() => setEditing(true)}
          />
          My own Fulcrum
        </label>
      </fieldset>
      <div
        className="rounded-xl bg-secondary/40 p-4 text-sm"
        aria-live="polite"
      >
        <p className="font-semibold">
          {active?.name ??
            (selection.mode === "custom"
              ? "My own Fulcrum"
              : "Built-in RedWallet service")}{" "}
          · {network.connectionState}
        </p>
        {active && (
          <>
            <p className="break-all text-xs">
              Active HTTPS bridge: {active.endpoint}
            </p>
            <p className="break-all text-xs">
              Adapter: {active.id} · Fulcrum {active.host}:{active.port} ·{" "}
              {active.tls ? "TLS" : "local TCP"}
            </p>
          </>
        )}
        {network.error && <p role="alert">{network.error.message}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {BUILTIN_BACKUPS.length
            ? `${BUILTIN_BACKUPS.length} verified independent backup adapter(s) configured.`
            : "No independent backup is configured. The built-in service currently depends on the home Umbrel."}
        </p>
      </div>
      {editing && (
        <fieldset disabled={busy} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Test verifies these details. Save selects this connection for this
            browser.
          </p>
          <div>
            <Label htmlFor="provider-host">
              Fulcrum host (as reached by your bridge)
            </Label>
            <Input
              id="provider-host"
              value={form.host}
              onChange={(e) =>
                setForm({ ...form, host: e.target.value.trim() })
              }
            />
          </div>
          <div>
            <Label htmlFor="provider-port">Fulcrum port</Label>
            <Input
              id="provider-port"
              inputMode="numeric"
              value={form.port || ""}
              onChange={(e) =>
                setForm({ ...form, port: Number(e.target.value) })
              }
            />
          </div>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.tls}
              onChange={(e) => setForm({ ...form, tls: e.target.checked })}
            />
            Fulcrum TLS
          </label>
          <div>
            <Label htmlFor="provider-endpoint">HTTPS bridge endpoint</Label>
            <Input
              id="provider-endpoint"
              placeholder={HOME_ADAPTER.endpoint}
              value={form.endpoint}
              onChange={(e) =>
                setForm({ ...form, endpoint: e.target.value.trim() })
              }
            />
          </div>
          <div>
            <Label htmlFor="provider-canister">ICP adapter canister ID</Label>
            <Input
              id="provider-canister"
              placeholder="Automatic for the built-in home bridge"
              value={form.canisterId}
              onChange={(e) =>
                setForm({ ...form, canisterId: e.target.value.trim() })
              }
            />
          </div>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowBuiltinFallback === true}
              onChange={(e) =>
                setForm({ ...form, allowBuiltinFallback: e.target.checked })
              }
            />
            Use the built-in service if my connection fails
          </label>
          <p className="text-xs text-muted-foreground">
            Fallback is opt-in and visibly changes the active service. Otherwise
            a failed custom connection stays failed. Public services see the
            public addresses and signed transactions you request; your keys stay
            here.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void test()}>
              Test connection
            </Button>
            <Button onClick={() => void test(true)}>Save</Button>
            <Button variant="outline" onClick={builtin}>
              Return to built-in service
            </Button>
          </div>
        </fieldset>
      )}
      {message && (
        <output className="block text-sm" aria-live="polite">
          {message}
        </output>
      )}
      {!editing && (
        <Button
          variant="outline"
          disabled={busy || network.isRefreshing}
          onClick={() => void network.refresh()}
        >
          Test connection
        </Button>
      )}
      <details className="rounded-xl border border-border p-3 text-xs leading-relaxed">
        <summary className="cursor-pointer font-semibold">
          How to connect your Fulcrum
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            A browser cannot open Fulcrum’s TCP/TLS port. Deploy the RedWallet
            HTTPS bridge beside your Fulcrum and a separate ICP adapter canister
            using this project’s backend. Configure that adapter’s bridge URL
            and private credential as its operator; never paste operator
            credentials into this app.
          </p>
          <p>
            Enter the HTTPS bridge URL, adapter canister ID, and the bridge’s
            actual Fulcrum host, port and TLS setting. Test checks that exact
            adapter’s identity, pinned XBT checkpoint and a tip no older than
            two hours. Save changes only this browser’s route; it never changes
            the shared bridge or any other user’s settings. Plain TCP is
            supported only when the bridge reaches Fulcrum on loopback.
          </p>
          <p>
            Provider changes cancel active payment reviews and require fresh
            network reads. Saved wallets, address discovery and signed receipts
            remain. An uncertain payment is checked by its original transaction
            ID before any explicit retry.
          </p>
        </div>
      </details>
    </div>
  );
}

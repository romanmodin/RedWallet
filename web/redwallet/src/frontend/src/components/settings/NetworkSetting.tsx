import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { PROVIDER_EVENT } from "@/services/networkGeneration";
import { providerGeneration } from "@/services/networkGeneration";
import {
  BUILTIN_BACKUPS,
  type CustomProvider,
  type ProviderSelection,
  providerRouter,
  readProviderSelection,
  saveProviderSelection,
  validateCustomProvider,
} from "@/services/providerService";
import { validateWebsocketProvider } from "@/services/websocketConfig";
import { useEffect, useRef, useState } from "react";
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
  const [editing, setEditing] = useState<ProviderSelection["mode"]>(
    selection.mode,
  );
  const [websocketUrl, setWebsocketUrl] = useState(
    selection.mode === "websocket" ? selection.config.endpoint : "",
  );
  const draft = useRef("");
  draft.current = JSON.stringify({ editing, form, websocketUrl });
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
    const exact = draft.current;
    const generation = providerGeneration();
    try {
      const config = validateCustomProvider(form);
      const info = await providerRouter.test(config);
      if (exact !== draft.current || generation !== providerGeneration())
        return;
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
  async function testWebsocket(save = false) {
    setBusy(true);
    setMessage("");
    const exact = draft.current;
    const generation = providerGeneration();
    try {
      const config = validateWebsocketProvider({ endpoint: websocketUrl });
      const info = await providerRouter.testWebsocket(config);
      if (exact !== draft.current || generation !== providerGeneration())
        return;
      if (save) {
        saveProviderSelection({ mode: "websocket", config });
        setSelection(readProviderSelection());
        void network.refresh();
      }
      setMessage(
        `${save ? "Saved. " : "Test passed. "}Direct home connection verified at XBT block ${info.height}. No shared relay was used.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Direct connection failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  function builtin() {
    try {
      saveProviderSelection({ mode: "builtin" });
      setSelection({ mode: "builtin" });
      setEditing("builtin");
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
      <p className="font-semibold text-sm">XBT network</p>
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="sr-only">Network provider</legend>
        <label className="flex gap-2 rounded-xl border border-border p-3">
          <input
            type="radio"
            name="provider"
            checked={editing === "builtin"}
            onChange={builtin}
          />
          Built-in RedWallet service (shared relay)
        </label>
        <label className="flex gap-2 rounded-xl border border-border p-3">
          <input
            type="radio"
            name="provider"
            checked={editing === "websocket"}
            onChange={() => {
              setEditing("websocket");
              setMessage("");
            }}
          />
          My home Fulcrum (direct WebSocket)
        </label>
      </fieldset>
      <div
        className="rounded-xl bg-secondary/40 p-4 text-sm"
        aria-live="polite"
      >
        <p className="font-semibold">
          {active?.name ??
            (selection.mode === "websocket"
              ? "My home Fulcrum · direct WSS"
              : selection.mode === "custom"
                ? "My own Fulcrum"
                : "Built-in RedWallet service")}{" "}
          · {network.connectionState}
        </p>
        {active && (
          <>
            <p className="break-all text-xs">
              {active.endpoint.startsWith("wss://")
                ? "Direct WSS endpoint"
                : "Active HTTPS bridge"}
              : {active.endpoint}
            </p>
            <p className="break-all text-xs">
              {active.endpoint.startsWith("wss://")
                ? active.backup
                  ? "Browser connects directly to mempool.guide while the primary is unavailable."
                  : "Browser connects directly to your Fulcrum; no shared relay."
                : `Adapter: ${active.id} · Fulcrum ${active.host}:${active.port} · ${active.tls ? "TLS" : "local TCP"}`}
            </p>
          </>
        )}
        {network.error && <p role="alert">{network.error.message}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {selection.mode === "websocket"
            ? "Direct mode never falls back to a public relay. Your Fulcrum sees the requests and your device’s IP address."
            : selection.mode === "custom"
              ? selection.config.allowBuiltinFallback
                ? "Your adapter is primary. If it fails, the built-in service can use home Umbrel, then mempool.guide over WSS. Public services see queried addresses and signed transactions; the WSS backup also sees your device’s IP address. Payments are never automatically retried."
                : "Your adapter is primary. Public fallback is disabled; a failed custom connection stays disconnected."
              : BUILTIN_BACKUPS.length
                ? "Primary: home Umbrel. Backup: mempool.guide over WSS. The backup sees queried public addresses, signed transactions and your device’s IP address. Switching services requires fresh payment checks; payments are never automatically retried."
                : "No independent backup is configured. The built-in service currently depends on the home Umbrel."}
        </p>
      </div>
      {editing === "websocket" && (
        <fieldset disabled={busy} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect directly to your own Fulcrum. Wallet address lookups and
            signed transactions bypass the shared relay. No canister or bridge
            setup is required.
          </p>
          <Label htmlFor="provider-websocket">
            Home Fulcrum WebSocket address
          </Label>
          <Input
            id="provider-websocket"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="wss://fulcrum.example.com:50004"
            value={websocketUrl}
            onChange={(e) => {
              setWebsocketUrl(e.target.value);
              setMessage("");
            }}
            aria-describedby="provider-websocket-help"
          />
          <p
            id="provider-websocket-help"
            className="text-sm text-muted-foreground"
          >
            Your server needs WSS enabled and a browser-trusted certificate. Use
            its WebSocket port, not its ordinary TCP/TLS port. It must be
            reachable from this device, on your home network or VPN, or through
            your server’s public address.
          </p>
          <p className="text-sm text-muted-foreground">
            These are draft settings. The active connection stays as shown above
            until a successful test and Save. If your home connection fails,
            wallet requests stay disconnected; no public fallback is used. Auto
            pricing still contacts the public price service without wallet
            addresses.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void testWebsocket()}>
              Test connection
            </Button>
            <Button onClick={() => void testWebsocket(true)}>Save</Button>
            <Button variant="outline" onClick={builtin}>
              Return to built-in service
            </Button>
          </div>
        </fieldset>
      )}
      <details
        open={editing === "custom"}
        className="rounded-xl border border-border p-3 text-sm"
      >
        <summary className="cursor-pointer font-semibold">
          Advanced HTTPS adapter
        </summary>
        <Button
          variant="outline"
          disabled={busy}
          className="mt-3"
          onClick={() => {
            setEditing("custom");
            setMessage("");
          }}
        >
          Configure existing adapter
        </Button>
      </details>
      <a
        href="/help/icp-canister.html"
        target="_blank"
        rel="noopener noreferrer"
        className="block text-sm text-primary underline underline-offset-4"
      >
        How to set up your own ICP canister (opens a new tab)
      </a>
      {editing === "custom" && (
        <fieldset disabled={busy} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            These are draft settings. The active service stays as shown above
            until Test connection and Save succeed.
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
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              aria-describedby="provider-endpoint-help"
              placeholder="Enter your HTTPS bridge URL"
              value={form.endpoint}
              onChange={(e) =>
                setForm({ ...form, endpoint: e.target.value.trim() })
              }
            />
            <p
              id="provider-endpoint-help"
              className="mt-1 text-xs text-muted-foreground"
            >
              Required. Type or paste your bridge URL; gray example text is not
              saved. To use the home Umbrel, choose Built-in RedWallet service.
            </p>
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
      {editing === "builtin" && (
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
          Connection privacy and setup
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            The built-in shared service is ready to use and sees the public
            addresses and signed transactions you request. Your private keys and
            recovery phrase stay on this device.
          </p>
          <p>
            Direct home WebSocket mode uses Fulcrum’s built-in WSS support.
            Enter one secure WebSocket address and test it; no personal ICP
            canister is needed. This avoids our shared wallet relay, but does
            not hide your requests from your own server or make your IP
            anonymous.
          </p>
          <p>
            The advanced option preserves existing HTTPS bridges and their
            independently configured adapters. Only that advanced option needs a
            canister ID. No connection setting reconfigures the shared service.
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

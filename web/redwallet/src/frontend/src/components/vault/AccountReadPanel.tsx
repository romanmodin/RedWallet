import { Button } from "@/components/ui/button";
import { AccountReader, type AccountSnapshot } from "@/lib/xbt/account-reader";
import { accountViewSession } from "@/lib/xbt/account-view-session";
import type { IssuedAddresses } from "@/lib/xbt/issued-addresses";
import type { PublicXbtAccount } from "@/lib/xbt/key-material";
import { savePublicSnapshot } from "@/lib/xbt/public-wallet-storage";
import type { BridgeActor } from "@/services/bridgeService";
import { QRCodeSVG } from "qrcode.react";
/** Public account view for the local vault workspace; no key material enters this component. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ManualFiatEstimate } from "../settings/ManualFiatEstimate";
import { AccountHistory } from "./AccountHistory";

export function AccountReadPanel({
  account,
  actor,
  addressBook,
  onSnapshot,
  showHistory = true,
}: {
  account: PublicXbtAccount;
  actor: BridgeActor;
  addressBook: IssuedAddresses;
  onSnapshot?: (snapshot: AccountSnapshot | null) => void;
  showHistory?: boolean;
}) {
  const session = useMemo(
    () => accountViewSession(actor, account.accountXpub),
    [actor, account.accountXpub],
  );
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(
    session.snapshot,
  );
  const [checked, setChecked] = useState(session.checked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receive, setReceive] = useState<{
    address: string;
    index: number;
  } | null>(session.receive);
  const [copied, setCopied] = useState(false);
  const [gap, setGap] = useState(session.gap);
  const [cap, setCap] = useState(session.cap);
  const notify = useRef(onSnapshot);
  notify.current = onSnapshot;
  useEffect(() => {
    // A completed observation remains an address hint after a failed refresh.
    // SpendPreparation always verifies current coins, parents, fees and the pin.
    notify.current?.(busy ? null : snapshot);
  }, [snapshot, busy]);
  const reader = useRef<AccountReader | null>(session.reader);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);

  // Restore only same-tab, actor-scoped public observations. The timestamp is never renewed.
  useEffect(() => {
    reader.current = session.reader;
    setSnapshot(session.snapshot);
    setReceive(session.receive);
    setChecked(session.checked);
    setGap(session.gap);
    setCap(session.cap);
    setBusy(false);
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [session]);
  async function scan(fresh: boolean) {
    if (busy) return;
    const operation = ++generation.current;
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError("");
    // Keep the last completed view visible while refreshing, but invalidate spending.
    notify.current?.(null);
    setCopied(false);
    try {
      if (fresh || !reader.current) {
        reader.current = new AccountReader(account.accountXpub, actor, {
          gapLimit: gap,
          maxAddressesPerBranch: cap,
          issuedThrough: addressBook.read(),
        });
        session.reader = reader.current;
        session.gap = gap;
        session.cap = cap;
        session.checked = 0;
        setChecked(0);
      }
      const result = await reader.current.scan(abort.signal, (value) => {
        if (generation.current === operation) {
          session.checked = value.checked;
          setChecked(value.checked);
        }
      });
      if (generation.current === operation && !abort.signal.aborted) {
        session.reader = null;
        reader.current = null;
        session.snapshot = result;
        setSnapshot(result);
        try {
          savePublicSnapshot(account.accountXpub, result);
        } catch {
          setError(
            "Scan completed, but this browser could not save it. Keep this tab open; another scan may be needed after closing it.",
          );
        }
      }
    } catch (e) {
      if (generation.current === operation)
        setError(
          e instanceof Error
            ? /Provider changed/.test(e.message)
              ? "The connection changed. Use Reconnect selected connection above, then retry. Your completed scan is retained."
              : e.message
            : "Account discovery failed. No empty wallet was assumed.",
        );
    } finally {
      if (generation.current === operation) {
        setBusy(false);
        request.current = null;
      }
    }
  }
  async function reserveReceive() {
    if (!snapshot || busy) return;
    const operation = ++generation.current;
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError("");
    setReceive(null);
    setCopied(false);
    try {
      const result = await addressBook.reserve(
        0,
        snapshot.branches[0].next.index,
        abort.signal,
      );
      if (generation.current === operation && !abort.signal.aborted) {
        session.receive = result;
        setReceive(result);
      }
    } catch (e) {
      if (generation.current === operation)
        setError(
          e instanceof Error ? e.message : "Could not reserve an address.",
        );
    } finally {
      if (generation.current === operation) {
        setBusy(false);
        request.current = null;
      }
    }
  }
  async function copy() {
    if (!receive) return;
    try {
      await navigator.clipboard.writeText(receive.address);
      setCopied(true);
    } catch {
      setError(
        "Copy was unavailable. Select the displayed public address to copy it manually.",
      );
    }
  }
  function amount(value: bigint) {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    return `${negative ? "−" : ""}${absolute / 100_000_000n}.${(absolute % 100_000_000n).toString().padStart(8, "0")} XBT`;
  }
  return (
    <section
      aria-label="Encrypted wallet account"
      className="space-y-4 rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="font-display text-lg font-semibold">
        Account balance and recovery scan
      </h2>
      <p className="text-sm text-muted-foreground">
        Account 0, receive and change branches. A scan takes at least a few
        minutes. Only derived public addresses go to the configured XBT bridge.
        Keys and recovery words stay in this browser. Completed results are
        saved on this device, including after a reload. Unlock the same wallet
        to restore them. A paused, incomplete scan can resume in this tab.
        Switching connections keeps the completed scan; no new recovery scan is
        required. Preparing a payment checks current coins again through the
        selected connection. Refresh account runs a new recovery scan to update
        the displayed balance and find new transfers.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Unused-address gap{" "}
          <select
            aria-label="Recovery gap"
            disabled={busy}
            value={gap}
            onChange={(e) => {
              setGap(Number(e.target.value));
              reader.current = null;
              session.reader = null;
            }}
            className="rounded border border-border bg-background p-2"
          >
            <option value={20}>20 (native default)</option>
            <option value={100}>100 (extended)</option>
          </select>
        </label>
        <label className="text-sm">
          Per-branch limit{" "}
          <select
            aria-label="Recovery limit"
            disabled={busy}
            value={cap}
            onChange={(e) => {
              setCap(Number(e.target.value));
              reader.current = null;
              session.reader = null;
            }}
            className="rounded border border-border bg-background p-2"
          >
            <option value={1000}>1,000</option>
            <option value={2000}>2,000</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        A gap can hide later addresses. This bounded scan does not prove that no
        other funds exist. Use the native wallet for other accounts or larger
        limits. Reads share the server quota with other wallet activity.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void scan(true)}>
          {snapshot ? "Refresh account" : "Scan account"}
        </Button>
        {reader.current && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void scan(false)}
          >
            Resume scan
          </Button>
        )}
        {busy && (
          <Button variant="outline" onClick={() => request.current?.abort()}>
            Pause
          </Button>
        )}
      </div>
      <output className="block text-sm">
        {busy ? "Reading account… " : ""}
        {checked} addresses checked
      </output>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!snapshot && (
        <p className="text-sm text-muted-foreground">
          The new receive-address button becomes available when the scan
          finishes. If interrupted, use Resume scan; observations expire after a
          five-minute pause.
        </p>
      )}
      {snapshot && (
        <>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">
                Confirmed balance at last scan
              </dt>
              <dd className="font-mono">{amount(snapshot.confirmed)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                Pending balance change at last scan
              </dt>
              <dd className="font-mono">{amount(snapshot.unconfirmed)}</dd>
            </div>
          </dl>
          <ManualFiatEstimate satoshis={snapshot.confirmed} />
          <p className="text-xs text-muted-foreground">
            Last completed scan:{" "}
            {new Date(snapshot.observedAt).toLocaleString()}, block{" "}
            {snapshot.height.toLocaleString()}. Refresh to check new transfers.
            Confirming a sent payment keeps this history; refresh to update the
            balance. These reads span the scan; they are not an atomic snapshot
            or a spendable-balance guarantee.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void reserveReceive()}
          >
            Get a new receive address
          </Button>
          {receive && (
            <div className="space-y-3">
              <p className="text-sm">XBT receive address #{receive.index}</p>
              <div className="inline-block rounded-xl bg-white p-3">
                <QRCodeSVG value={receive.address} size={176} />
              </div>
              <p className="break-all font-mono text-sm">{receive.address}</p>
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? "Address copied" : "Copy receive address"}
              </Button>
            </div>
          )}
          {showHistory && (
            <>
              <h3 className="font-semibold">Account history</h3>
              <AccountHistory
                key={`${account.accountXpub}:${snapshot.observedAt}`}
                xpub={account.accountXpub}
                snapshot={snapshot}
                actor={actor}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

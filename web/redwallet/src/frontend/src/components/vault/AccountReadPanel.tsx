import { Button } from "@/components/ui/button";
import { AccountReader, type AccountSnapshot } from "@/lib/xbt/account-reader";
import type { IssuedAddresses } from "@/lib/xbt/issued-addresses";
import type { PublicXbtAccount } from "@/lib/xbt/key-material";
import type { BridgeActor } from "@/services/bridgeService";
import { QRCodeSVG } from "qrcode.react";
/** Public account view for the local vault workspace; no key material enters this component. */
import { useEffect, useRef, useState } from "react";

export function AccountReadPanel({
  account,
  actor,
  addressBook,
}: {
  account: PublicXbtAccount;
  actor: BridgeActor;
  addressBook: IssuedAddresses;
}) {
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [checked, setChecked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receive, setReceive] = useState<{
    address: string;
    index: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [gap, setGap] = useState(20);
  const [cap, setCap] = useState(1000);
  const reader = useRef<AccountReader | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Account, transport or storage changes must discard prior results.
  useEffect(() => {
    reader.current = null;
    setSnapshot(null);
    setReceive(null);
    setChecked(0);
    setBusy(false);
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [account, actor, addressBook]);
  async function scan(fresh: boolean) {
    if (busy) return;
    const operation = ++generation.current;
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError("");
    setSnapshot(null);
    setReceive(null);
    setCopied(false);
    try {
      if (fresh || !reader.current) {
        reader.current = new AccountReader(account.accountXpub, actor, {
          gapLimit: gap,
          maxAddressesPerBranch: cap,
          issuedThrough: addressBook.read(),
        });
        setChecked(0);
      }
      const result = await reader.current.scan(abort.signal, (value) => {
        if (generation.current === operation) setChecked(value.checked);
      });
      if (generation.current === operation && !abort.signal.aborted)
        setSnapshot(result);
    } catch (e) {
      if (generation.current === operation)
        setError(
          e instanceof Error
            ? e.message
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
      if (generation.current === operation && !abort.signal.aborted)
        setReceive(result);
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
        Keys and recovery words stay in this browser.
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
          Scan account
        </Button>
        {!snapshot && reader.current && (
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
      {snapshot && (
        <>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">
                Confirmed balance
              </dt>
              <dd className="font-mono">{amount(snapshot.confirmed)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                Pending balance change
              </dt>
              <dd className="font-mono">{amount(snapshot.unconfirmed)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Observed at block {snapshot.height.toLocaleString()}. These reads
            span the scan; they are not an atomic snapshot or a
            spendable-balance guarantee.
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
          <h3 className="font-semibold">Account history</h3>
          <p className="text-xs text-muted-foreground">
            Transaction IDs and confirming heights are available. Amounts,
            directions and timestamps have not been inferred.
          </p>
          {snapshot.history.length ? (
            <ul className="max-h-72 space-y-2 overflow-auto">
              {snapshot.history.map((row) => (
                <li
                  key={row.txid}
                  className="rounded-xl border border-border p-3"
                >
                  <p className="break-all font-mono text-xs">{row.txid}</p>
                  <p className="text-xs">
                    {row.height > 0n
                      ? `Confirmed at block ${row.height}`
                      : "Unconfirmed"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">
              No history found within these scan bounds.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Sending is not enabled in this revision.
          </p>
        </>
      )}
    </section>
  );
}

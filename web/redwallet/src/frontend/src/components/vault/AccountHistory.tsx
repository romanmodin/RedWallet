import { Button } from "@/components/ui/button";
import type { AccountSnapshot } from "@/lib/xbt/account-reader";
import {
  type HistoryOutcome,
  HistoryReader,
  HistoryTransactions,
  ownedHistoryScripts,
} from "@/lib/xbt/history-outcome";
import { PendingPayments } from "@/lib/xbt/pending-payment";
import { type BridgeActor, resolveBridgeActor } from "@/services/bridgeService";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Clock3,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function historyAmount(value: bigint, signed = false) {
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % 100000000n)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return `${value < 0n ? "−" : signed && value > 0n ? "+" : ""}${absolute / 100000000n}${fraction ? `.${fraction}` : ""} XBT`;
}
/** Only an explicit amount lookup reads the network. Saved proofs and signed
 * receipts survive reload; they never authorize a payment or imply a fresh tip.
 */
export function AccountHistory({
  xpub,
  snapshot,
  actor,
  recent = false,
  exclude = [],
}: {
  xpub: string;
  snapshot: AccountSnapshot;
  actor?: BridgeActor;
  recent?: boolean;
  exclude?: readonly string[];
}) {
  const cache = useMemo(() => new HistoryTransactions(xpub), [xpub]);
  const account = useMemo(() => {
    try {
      return { owned: ownedHistoryScripts(xpub, snapshot), error: "" };
    } catch {
      return {
        owned: null,
        error:
          "Saved address information could not be verified. Keep your recovery backup; amounts are unavailable.",
      };
    }
  }, [xpub, snapshot]);
  const receipts = useMemo(() => {
    try {
      return new Map(
        new PendingPayments(xpub, localStorage)
          .readConfirmed()
          .payments.filter((p) =>
            snapshot.history.some((row) => row.txid === p.txid),
          )
          .map((p) => [
            p.txid,
            {
              kind: "sent",
              amount: -BigInt(p.amount),
              fee: BigInt(p.fee),
              balanceChange: -BigInt(p.amount) - BigInt(p.fee),
            } as HistoryOutcome,
          ]),
      );
    } catch {
      return new Map<string, HistoryOutcome>();
    }
  }, [xpub, snapshot]);
  const rows = [...snapshot.history]
    .filter((row) => !exclude.includes(row.txid))
    .sort(
      (a, b) =>
        Number(b.height <= 0n) - Number(a.height <= 0n) ||
        Number(b.height - a.height),
    );
  const [page, setPage] = useState(0);
  const size = recent ? 5 : 20;
  const shown = rows.slice(page * size, (page + 1) * size);
  const outcomes = new Map(
    shown.map((row) => [
      row.txid,
      receipts.get(row.txid) ??
        (account.owned ? cache.outcome(row.txid, account.owned) : null),
    ]),
  );
  const missing = shown
    .filter((row) => !outcomes.get(row.txid))
    .map((row) => row.txid);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [, redraw] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => request.current?.abort();
  }, []);
  useEffect(() => {
    const pause = () => request.current?.abort();
    const visibility = () => {
      if (document.visibilityState !== "visible") pause();
    };
    window.addEventListener("pagehide", pause);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", pause);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function load() {
    if (busy || !account.owned) return;
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setMessage("Loading transaction amounts…");
    try {
      const backend = actor ?? (await resolveBridgeActor());
      if (abort.signal.aborted) return;
      if (!backend)
        throw Error("The account backend is unavailable; retry shortly");
      let completed = 0;
      let allSaved = true;
      await new HistoryReader(backend, cache).load(
        missing,
        account.owned,
        abort.signal,
        (_id, _outcome, saved) => {
          completed++;
          allSaved = allSaved && saved;
          redraw((value) => value + 1);
          setMessage(
            `Loading amounts… ${completed} of ${missing.length} complete.`,
          );
        },
      );
      // Cache proofs are revalidated and amounts recomputed on every render.
      completed = missing.length;
      try {
        cache.save();
      } catch {
        allSaved = false;
      }
      redraw((value) => value + 1);
      setMessage(
        allSaved
          ? `${completed} transaction amounts loaded and saved on this device.`
          : "Amounts loaded, but storage is full or unavailable. Keep this tab open.",
      );
    } catch (error) {
      if (!abort.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load transaction amounts",
        );
      else
        setMessage(
          "Amount lookup paused. Completed amounts are kept; load again to continue.",
        );
      redraw((value) => value + 1);
    } finally {
      setBusy(false);
      request.current = null;
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Amounts use transaction inputs and outputs for discovered account
        addresses. Sent amounts exclude change; fees are shown separately. Block
        status is from the last scan.
      </p>
      {account.error && (
        <p role="alert" className="text-sm text-destructive">
          {account.error}
        </p>
      )}
      <ul className="space-y-3">
        {shown.map((row) => {
          const outcome = outcomes.get(row.txid);
          const incoming = outcome?.kind === "received";
          const label = incoming
            ? "Received"
            : outcome?.kind === "sent"
              ? "Sent"
              : outcome?.kind === "self"
                ? "Transfer within wallet"
                : outcome?.kind === "net"
                  ? "Net wallet change"
                  : "Transaction";
          const Icon = incoming
            ? ArrowDownLeft
            : outcome?.kind === "sent"
              ? ArrowUpRight
              : outcome
                ? ArrowLeftRight
                : Clock3;
          const color = incoming
            ? "text-emerald-600 dark:text-emerald-400"
            : outcome?.kind === "sent"
              ? "text-rose-600 dark:text-rose-400"
              : "text-foreground";
          return (
            <li
              key={row.txid}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-muted ${color}`}
                >
                  <Icon size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.height > 0n
                      ? `Confirmed at block ${row.height}`
                      : "Unconfirmed at last scan"}
                  </p>
                  <p
                    className={`break-all font-mono text-lg font-semibold tabular-nums ${color}`}
                  >
                    {outcome
                      ? historyAmount(outcome.amount, true)
                      : "Amount not loaded"}
                  </p>
                  {outcome?.fee !== null && outcome?.fee !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      Fee {historyAmount(outcome.fee)} · Balance change{" "}
                      {historyAmount(outcome.balanceChange, true)}
                    </p>
                  )}
                  <details className="pt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      Transaction ID · {row.txid.slice(0, 8)}…
                      {row.txid.slice(-8)}
                    </summary>
                    <p className="mt-2 break-all select-text font-mono">
                      {row.txid}
                    </p>
                  </details>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!rows.length && (
        <p className="text-sm">No history found within these scan bounds.</p>
      )}
      {missing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !account.owned}
            onClick={() => void load()}
          >
            Load transaction amounts
          </Button>
          {busy && (
            <Button variant="outline" onClick={() => request.current?.abort()}>
              Pause amount lookup
            </Button>
          )}
        </div>
      )}
      {message && (
        <output className="block text-xs text-muted-foreground">
          {message}
        </output>
      )}
      {!recent && rows.length > size && (
        <nav
          aria-label="Transaction history pages"
          className="flex items-center justify-between gap-2"
        >
          <Button
            variant="outline"
            disabled={busy || page === 0}
            onClick={() => setPage((n) => n - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            {page * size + 1}–{Math.min((page + 1) * size, rows.length)} of{" "}
            {rows.length}
          </span>
          <Button
            variant="outline"
            disabled={busy || (page + 1) * size >= rows.length}
            onClick={() => setPage((n) => n + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}

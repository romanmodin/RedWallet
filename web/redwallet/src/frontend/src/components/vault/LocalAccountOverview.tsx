import { PageHeader } from "@/components/layout/PageHeader";
import { ACCOUNT_SCAN_EVENT } from "@/lib/xbt/account-view-session";
import {
  type PendingPayment,
  PendingPayments,
} from "@/lib/xbt/pending-payment";
import { loadPublicSnapshot } from "@/lib/xbt/public-wallet-storage";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ManualFiatEstimate } from "../settings/ManualFiatEstimate";
import { AccountHistory, historyAmount } from "./AccountHistory";
import type { LocalAccountSelection } from "./LocalAccountContext";

export function xbtAmount(value: bigint) {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "−" : ""}${absolute / 100000000n}.${(absolute % 100000000n).toString().padStart(8, "0")} XBT`;
}

/** Validated public observations only. Viewing a tab performs no account scan,
 * signing, fee estimate or submission. The protected workspace owns those actions.
 */
export function LocalAccountOverview({
  selected,
  history = false,
}: {
  selected: LocalAccountSelection;
  history?: boolean;
}) {
  const xpub = selected.account.accountXpub;
  const read = useCallback(() => {
    const snapshot = loadPublicSnapshot(xpub);
    let receipts: PendingPayment[] = [];
    let pending: PendingPayment | null = null;
    let damaged = false;
    try {
      const store = new PendingPayments(xpub, localStorage);
      const saved = store.readConfirmed();
      receipts = saved.payments;
      damaged = saved.incomplete;
      try {
        pending = store.read();
      } catch {
        damaged = true;
      }
    } catch {
      damaged = true;
    }
    return { snapshot, receipts, pending, damaged };
  }, [xpub]);
  const [view, setView] = useState(read);
  useEffect(() => {
    setView(read());
    const update = () => setView(read());
    window.addEventListener("storage", update);
    window.addEventListener(ACCOUNT_SCAN_EVENT, update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener(ACCOUNT_SCAN_EVENT, update);
    };
  }, [read]);
  const { snapshot, receipts, pending, damaged } = view;
  const sentIds = new Set(receipts.map((payment) => payment.txid));
  const rows = [...(snapshot?.history ?? [])]
    .filter((row) => !sentIds.has(row.txid) && row.txid !== pending?.txid)
    .sort(
      (a, b) =>
        Number(b.height <= 0n) - Number(a.height <= 0n) ||
        Number(b.height - a.height),
    );
  return (
    <section
      data-ocid={history ? "local.activity" : "local.home"}
      className="space-y-5"
    >
      <PageHeader
        title={history ? "Activity" : "Home"}
        description={`${selected.name} · local XBT wallet`}
      />
      <nav aria-label="Local wallet actions" className="flex flex-wrap gap-3">
        {(
          [
            ["/send", "Send"],
            ["/receive", "Receive"],
            ["/wallets", "Refresh or switch wallet"],
            [
              history ? "/" : "/history",
              history ? "Home" : "View all activity",
            ],
          ] as const
        ).map(([to, label]) => (
          <Link
            key={to}
            to={to}
            className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-primary"
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
        {snapshot ? (
          <>
            <p className="text-sm text-muted-foreground">
              Confirmed balance at last scan
            </p>
            <p className="break-all font-mono text-2xl">
              {xbtAmount(snapshot.confirmed)}
            </p>
            <ManualFiatEstimate satoshis={snapshot.confirmed} />
            <p className="text-sm">
              Pending balance change at last scan:{" "}
              {xbtAmount(snapshot.unconfirmed)}
            </p>
            <p className="text-xs text-muted-foreground">
              Last completed scan:{" "}
              {new Date(snapshot.observedAt).toLocaleString()}, block{" "}
              {snapshot.height.toLocaleString()}.{" "}
              {snapshot.branches.reduce((n, branch) => n + branch.scanned, 0)}{" "}
              addresses checked.
            </p>
            <p className="text-xs text-muted-foreground">
              Saved observations; refresh in Wallets to check new transfers.
              Preparing a payment always checks current coins, fees and the
              network again.
            </p>
          </>
        ) : (
          <p>
            No completed scan saved for this wallet. Open Wallets to scan its
            public account.
          </p>
        )}
      </div>
      {damaged && (
        <p role="alert">
          Some saved payment records could not be read. They have been kept.
          Open Send to resolve the saved payment before preparing another.
        </p>
      )}
      <section aria-label="Local wallet activity" className="space-y-3">
        <h2 className="font-display text-lg font-semibold">
          {history ? "Wallet activity" : "Recent activity"}
        </h2>
        {pending && (
          <div className="space-y-2 rounded-xl border border-primary/30 bg-card p-4">
            <p className="font-semibold">
              {pending.state === "acknowledged"
                ? "Sent — awaiting confirmation"
                : pending.state === "signed"
                  ? "Signed — submission not recorded"
                  : "Submission outcome needs checking"}
            </p>
            <p>
              {xbtAmount(BigInt(pending.amount))} to{" "}
              <span className="break-all font-mono text-xs">
                {pending.destination}
              </span>
            </p>
            <p className="break-all font-mono text-xs">{pending.txid}</p>
            <Link to="/send" className="text-primary underline">
              Check saved payment
            </Link>
          </div>
        )}
        {(history ? receipts : receipts.slice(0, 5)).map((payment) => (
          <div
            key={payment.txid}
            className="space-y-2 rounded-xl border border-border bg-card p-4"
          >
            <p className="font-semibold">Sent · Confirmation recorded</p>
            <p>
              {historyAmount(-BigInt(payment.amount), true)} · Fee{" "}
              {xbtAmount(BigInt(payment.fee))}
            </p>
            <p className="break-all font-mono text-xs">
              To: {payment.destination}
            </p>
            <p className="break-all font-mono text-xs">{payment.txid}</p>
          </div>
        ))}
        {receipts.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Sent receipts are past confirmation observations saved on this
            device, not a live confirmation count.
          </p>
        )}
        {snapshot && rows.length > 0 && (
          <AccountHistory
            key={`${xpub}:${snapshot.observedAt}`}
            xpub={xpub}
            snapshot={snapshot}
            recent={!history}
            exclude={[...sentIds, ...(pending ? [pending.txid] : [])]}
          />
        )}
        {!pending && receipts.length === 0 && rows.length === 0 && (
          <p>No saved activity for this account yet.</p>
        )}
      </section>
    </section>
  );
}

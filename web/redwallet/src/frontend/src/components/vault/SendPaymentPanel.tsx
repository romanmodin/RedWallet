import type { backendInterface } from "@/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountSnapshot } from "@/lib/xbt/account-reader";
import type { IssuedAddresses } from "@/lib/xbt/issued-addresses";
import type { PublicXbtAccount } from "@/lib/xbt/key-material";
import { publicAddress } from "@/lib/xbt/key-material";
import { confirmOriginal, submitOriginal } from "@/lib/xbt/payment-network";
import {
  type PendingPayment,
  PendingPayments,
} from "@/lib/xbt/pending-payment";
import {
  loadPaymentDraft,
  savePaymentDraft,
} from "@/lib/xbt/public-wallet-storage";
import { SpendPreparation } from "@/lib/xbt/spend-preparation";
import type { SpendReview } from "@/lib/xbt/spend-review";
import type { VaultController } from "@/lib/xbt/vault-controller";
import { useEffect, useMemo, useRef, useState } from "react";

function xbt(value: string) {
  const n = BigInt(value);
  return `${n / 100000000n}.${(n % 100000000n).toString().padStart(8, "0")} XBT`;
}
/** Client-only; reviewed keys never enter a network argument. Explicit two-step sign/send. */
export function SendPaymentPanel({
  account,
  actor,
  addressBook,
  snapshot,
  controller,
  locked,
  onConfirmed,
}: {
  account: PublicXbtAccount;
  actor: backendInterface;
  addressBook: IssuedAddresses;
  snapshot: AccountSnapshot | null;
  controller: VaultController;
  locked: boolean;
  onConfirmed: () => void;
}) {
  const store = useMemo(
    () => new PendingPayments(account.accountXpub, window.localStorage),
    [account.accountXpub],
  );
  const preparation = useMemo(
    () => new SpendPreparation(account.accountXpub, actor, addressBook),
    [account.accountXpub, actor, addressBook],
  );
  const [draft] = useState(() => loadPaymentDraft(account.accountXpub));
  const [destination, setDestination] = useState(draft.destination);
  const [amount, setAmount] = useState(draft.amount);
  const [rate, setRate] = useState(draft.rate);
  const [review, setReview] = useState<SpendReview | null>(null);
  const activeReview = useRef<SpendReview | null>(null);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [broken, setBroken] = useState(false);
  const operation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const draftWarning = useRef(false);
  function persistDraft(next: {
    destination: string;
    amount: string;
    rate: string;
  }) {
    try {
      savePaymentDraft(account.accountXpub, next);
    } catch {
      if (!draftWarning.current)
        setNotice(
          "Browser storage is unavailable; this payment draft cannot survive a reload.",
        );
      draftWarning.current = true;
    }
  }
  function invalidate() {
    activeReview.current?.invalidate();
    activeReview.current = null;
    setReview(null);
    setAccepted(false);
  }
  // Storage changes in any other tab invalidate reviews, including changes to signed receipts.
  useEffect(() => {
    const reload = () => {
      try {
        setPending(store.read());
        setBroken(false);
      } catch {
        setBroken(true);
        setError(
          "Saved payment could not be verified. Do not create a replacement payment.",
        );
      }
    };
    const reset = () => {
      operation.current++;
      abort.current?.abort();
      activeReview.current?.invalidate();
      activeReview.current = null;
      setReview(null);
      setAccepted(false);
      setBusy(false);
    };
    const storage = (e: StorageEvent) => {
      if (
        e.key === null ||
        e.key.startsWith("redwallet.payment.v1.") ||
        e.key.startsWith("redwallet.issued.v1.")
      ) {
        reset();
        reload();
      }
    };
    const hide = () => {
      if (document.visibilityState !== "visible") reset();
    };
    reload();
    window.addEventListener("storage", storage);
    window.addEventListener("pagehide", reset);
    document.addEventListener("visibilitychange", hide);
    return () => {
      reset();
      window.removeEventListener("storage", storage);
      window.removeEventListener("pagehide", reset);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [store]);
  useEffect(() => {
    if (locked) {
      operation.current++;
      abort.current?.abort();
      setBusy(false);
      activeReview.current?.invalidate();
      activeReview.current = null;
      setReview(null);
      setAccepted(false);
    }
  }, [locked]);
  useEffect(() => {
    if (!snapshot) {
      activeReview.current?.invalidate();
      activeReview.current = null;
      setReview(null);
      setAccepted(false);
    }
  }, [snapshot]);
  useEffect(() => {
    if (!review) return;
    const timer = setInterval(() => {
      if (!review.active) {
        setReview(null);
        setAccepted(false);
        setNotice("Review expired. Prepare a fresh review.");
      }
    }, 250);
    return () => clearInterval(timer);
  }, [review]);
  async function prepare() {
    if (!snapshot || busy || broken || pending) return;
    if (locked || controller.locked) {
      setNotice("Wallet locked. Unlock above before preparing a new review.");
      return;
    }
    invalidate();
    const gen = ++operation.current;
    const cancel = new AbortController();
    abort.current = cancel;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await preparation.prepare(
        snapshot,
        destination,
        amount,
        Number(rate),
        cancel.signal,
      );
      if (
        gen !== operation.current ||
        cancel.signal.aborted ||
        controller.locked
      ) {
        result.review.invalidate();
        return;
      }
      activeReview.current = result.review;
      setReview(result.review);
      setNotice(
        `Current estimate: ${result.suggestedFeeRate} sat/vB. Review expires after 60 seconds.`,
      );
    } catch (e) {
      if (gen === operation.current)
        setError(e instanceof Error ? e.message : "Preparation failed");
    } finally {
      if (gen === operation.current) setBusy(false);
    }
  }
  async function sign() {
    if (!review || !accepted || busy || locked || broken) return;
    const gen = operation.current;
    const exact = review;
    setBusy(true);
    setError("");
    try {
      const payment = await store.signAndSave(exact.plan, () => {
        if (
          gen !== operation.current ||
          document.visibilityState !== "visible" ||
          activeReview.current !== exact
        )
          throw Error("Review cancelled");
        return controller.withUnlocked((keys) => exact.sign(keys));
      });
      if (gen === operation.current) {
        setPending(payment);
        invalidate();
        setNotice("Signed locally and saved. Nothing has been sent yet.");
      }
    } catch (e) {
      if (gen === operation.current) {
        invalidate();
        setError(e instanceof Error ? e.message : "Signing failed");
      }
    } finally {
      if (gen === operation.current) setBusy(false);
    }
  }
  async function submit() {
    if (!pending || !accepted || busy || broken) return;
    const gen = operation.current;
    setBusy(true);
    setError("");
    setAccepted(false);
    try {
      const result = await store.submit((hex, txid) =>
        submitOriginal(
          actor,
          hex,
          txid,
          () =>
            gen === operation.current && document.visibilityState === "visible",
        ),
      );
      if (gen === operation.current) {
        setPending(result);
        setNotice(
          result.state === "acknowledged"
            ? "Node acknowledged this transaction. It is not yet confirmed."
            : "Outcome unknown. The original signed transaction remains saved; do not create a replacement.",
        );
      }
    } catch (e) {
      if (gen === operation.current)
        setError(
          e instanceof Error
            ? e.message
            : "Outcome unknown; check the saved transaction",
        );
    } finally {
      if (gen === operation.current) setBusy(false);
    }
  }
  async function confirm() {
    if (!pending || busy || broken) return;
    const gen = operation.current;
    setBusy(true);
    setError("");
    try {
      await store.archiveConfirmed((p) => confirmOriginal(actor, p));
      if (gen === operation.current) {
        setPending(null);
        setAccepted(false);
        setNotice(
          "Confirmed transaction archived locally. Scan again before another payment.",
        );
        onConfirmed();
      }
    } catch (e) {
      if (gen === operation.current)
        setError(e instanceof Error ? e.message : "Confirmation unavailable");
    } finally {
      if (gen === operation.current) setBusy(false);
    }
  }
  function edit(action: () => void) {
    invalidate();
    setError("");
    action();
  }
  return (
    <section
      aria-label="Local XBT payment"
      className="space-y-4 rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="font-display text-lg font-semibold">
        XBT payment preparation
      </h2>
      <p className="text-sm">
        Preview: review carefully. Submission requires a fresh network check and
        your explicit confirmation.
      </p>
      <p className="text-sm text-muted-foreground">
        XBT only. Native SegWit recipients and confirmed, non-coinbase inputs
        are supported. This is not a Bitcoin BTC payment. Keys sign locally;
        only signed transaction bytes reach the bridge.
      </p>
      {error && (
        <p role="alert" className="break-words text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && <output className="block text-sm">{notice}</output>}
      {pending ? (
        <>
          <h3 className="font-semibold">Saved signed payment</h3>
          <p className="break-all font-mono text-xs">
            Transaction ID: {pending.txid}
          </p>
          <p className="break-all">To: {pending.destination}</p>
          <p>Amount: {xbt(pending.amount)}</p>
          <p>Fee: {xbt(pending.fee)}</p>
          <p>
            Local receipt: {pending.state}. Check the network for confirmation.
          </p>
          <p className="text-sm text-muted-foreground">
            A lost reply does not mean failure. Retries use these exact signed
            bytes; no replacement is created. Keep browser storage until this
            payment is resolved.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={accepted}
              disabled={busy || broken}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I checked this XBT recipient, amount and fee, and want to submit
            this exact transaction.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !accepted || broken}
              onClick={() => void submit()}
            >
              {pending.state === "signed"
                ? "Send signed transaction"
                : "Submit the same transaction again"}
            </Button>
            <Button
              variant="outline"
              disabled={busy || broken}
              onClick={() => void confirm()}
            >
              Check confirmation
            </Button>
          </div>
        </>
      ) : (
        <>
          <fieldset disabled={busy || broken} className="space-y-3">
            <div>
              <Label htmlFor="xbt-pay-to">XBT recipient</Label>
              <Input
                id="xbt-pay-to"
                autoComplete="off"
                value={destination}
                onChange={(e) =>
                  edit(() => {
                    const value = e.target.value.trim().slice(0, 128);
                    setDestination(value);
                    persistDraft({ destination: value, amount, rate });
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="xbt-pay-amount">Amount in XBT</Label>
              <Input
                id="xbt-pay-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) =>
                  edit(() => {
                    const value = e.target.value.slice(0, 32);
                    setAmount(value);
                    persistDraft({ destination, amount: value, rate });
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="xbt-pay-fee">Fee rate (sat/vB)</Label>
              <Input
                id="xbt-pay-fee"
                inputMode="numeric"
                value={rate}
                onChange={(e) =>
                  edit(() => {
                    const value = e.target.value.slice(0, 8);
                    setRate(value);
                    persistDraft({ destination, amount, rate: value });
                  })
                }
              />
            </div>
          </fieldset>
          {locked && (
            <p className="text-sm">
              Unlock this wallet above before preparing a review. Your draft and
              completed scan stay saved; returning from another app locks keys
              and cancels only the review.
            </p>
          )}
          {locked && (
            <Button
              variant="outline"
              onClick={() => {
                const panel = document.getElementById("local-wallet-unlock");
                panel?.scrollIntoView({ block: "start" });
                panel?.focus({ preventScroll: true });
              }}
            >
              Go to wallet unlock
            </Button>
          )}
          {!snapshot && (
            <p className="text-sm">
              Complete the initial account scan above first. Saved scans restore
              after unlocking.
            </p>
          )}
          <Button
            variant="outline"
            disabled={busy || !snapshot || broken || locked}
            onClick={() => void prepare()}
          >
            {busy ? "Checking payment data…" : "Prepare transaction review"}
          </Button>
          {review && (
            <div className="space-y-2 rounded-xl border border-border p-4">
              <h3 className="font-semibold">Review before signing</h3>
              <p className="break-all">To: {review.plan.destination}</p>
              <p>Amount: {xbt(review.plan.amount)}</p>
              <p>
                Fee: {xbt(review.plan.fee)} ({review.plan.feeRate} sat/vB)
              </p>
              <p>
                Total leaving the wallet:{" "}
                {xbt(
                  (
                    BigInt(review.plan.amount) + BigInt(review.plan.fee)
                  ).toString(),
                )}
              </p>
              <p className="break-all">
                Change: {xbt(review.plan.change)} to{" "}
                {publicAddress(account.accountXpub, 1, review.plan.changeIndex)}
              </p>
              <p>
                {review.plan.inputs.length} confirmed inputs; observed block{" "}
                {review.plan.tipHeight}.
              </p>
              {locked && (
                <p>Unlock this same wallet above, then prepare a new review.</p>
              )}
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={busy || locked}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                I checked the XBT recipient, exact amount, fee and change.
              </label>
              <Button
                disabled={busy || locked || !accepted}
                onClick={() => void sign()}
              >
                Sign reviewed transaction locally
              </Button>
            </div>
          )}
        </>
      )}
      {busy && (
        <Button
          variant="outline"
          onClick={() => {
            operation.current++;
            abort.current?.abort();
            invalidate();
            setBusy(false);
            setNotice(
              "View cancelled. Any submitted transaction may still be accepted; check its saved receipt.",
            );
            try {
              setPending(store.read());
            } catch {
              setBroken(true);
            }
          }}
        >
          Cancel waiting
        </Button>
      )}
    </section>
  );
}

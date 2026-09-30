/**
 * SendPage — two-step demo send flow at /send.
 *
 * Step one collects recipient, amount, and an optional note with inline
 * validation and a live fee estimate. Step two reviews the payment and
 * presents a disabled, demo-only confirm action. No signing, transaction
 * construction, or broadcast happens anywhere in this flow.
 */

import { PageHeader } from "@/components/layout/PageHeader";
import {
  SendForm,
  type SendFormErrors,
  type SendFormValues,
} from "@/components/send/SendForm";
import { SendReview } from "@/components/send/SendReview";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { OfflineState } from "@/components/states/OfflineState";
import { useLocalAccount } from "@/components/vault/LocalAccountContext";
import { LocalWalletWorkspace } from "@/components/vault/LocalWalletWorkspace";
import { useSettings } from "@/hooks/useSettings";
import { useWallet } from "@/hooks/useWallet";
import { formatAmount } from "@/lib/format";
import { bridgeWalletService } from "@/services/bridgeService";
import type { FeeEstimate } from "@/services/types";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

type Step = "form" | "review";

const EMPTY_VALUES: SendFormValues = { recipient: "", amount: "", note: "" };

/**
 * Demo recipient check.
 *
 * This deliberately does NOT validate against any real XBT address rules —
 * demo only — and does not assume any XBT address prefix. It only rejects empty
 * or whitespace-only input so the demo flow can proceed with any
 * clearly-labeled demo string.
 */
function isPlausibleAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed);
}

export function SendPage() {
  const local = useLocalAccount();
  return local?.selected ? (
    <section data-ocid="send.page" className="space-y-4">
      <PageHeader
        title="Send"
        description={`${local.selected.name} · local XBT wallet`}
      />
      <LocalWalletWorkspace purpose="send" />
    </section>
  ) : (
    <WatchedSendPage />
  );
}

function WatchedSendPage() {
  const {
    activeWallet,
    isLoading: isWalletLoading,
    error: walletError,
  } = useWallet();
  const { settings } = useSettings();

  const [step, setStep] = useState<Step>("form");
  const [values, setValues] = useState<SendFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<SendFormErrors>({});
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [isFeeLoading, setIsFeeLoading] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const availableXbt = activeWallet?.balanceXbt ?? 0;
  const availableFiatUsd = activeWallet?.fiatValueUsd ?? 0;

  const parsedAmount = useMemo(() => {
    const normalized = values.amount.trim().replace(/,/g, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }, [values.amount]);

  // Live fee estimate, debounced as the amount changes.
  useEffect(() => {
    if (parsedAmount === null || parsedAmount <= 0) {
      setFeeEstimate(null);
      setFeeError(null);
      setIsFeeLoading(false);
      return;
    }

    let cancelled = false;
    setIsFeeLoading(true);
    const timer = window.setTimeout(() => {
      void bridgeWalletService.estimateFee(parsedAmount).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setFeeEstimate(result.value);
          setFeeError(null);
        } else {
          setFeeEstimate(null);
          setFeeError(result.error.message);
        }
        setIsFeeLoading(false);
      });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [parsedAmount]);

  function handleChange(patch: Partial<SendFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      if (patch.recipient !== undefined) next.recipient = undefined;
      if (patch.amount !== undefined) next.amount = undefined;
      return next;
    });
  }

  function validate(): SendFormErrors {
    const next: SendFormErrors = {};
    const recipient = values.recipient.trim();

    if (!recipient) {
      next.recipient = "Enter a recipient address.";
    } else if (!isPlausibleAddress(recipient)) {
      next.recipient = "Enter an XBT demo recipient without spaces.";
    }

    if (!values.amount.trim()) {
      next.amount = "Enter an amount to send.";
    } else if (parsedAmount === null) {
      next.amount = "Enter a valid number.";
    } else if (parsedAmount <= 0) {
      next.amount = "Amount must be greater than zero.";
    } else if (parsedAmount > availableXbt) {
      next.amount = `Amount exceeds your available balance of ${formatAmount(
        availableXbt,
        settings.displayUnit,
      )}.`;
    }

    return next;
  }

  function handleReview() {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setStep("review");
  }

  function handleRetry() {
    setIsOffline(false);
    setFeeError(null);
  }

  const header = (
    <PageHeader
      title="Send"
      description="Create a demo payment — nothing is broadcast"
    />
  );

  if (isWalletLoading) {
    return (
      <section data-ocid="send.page">
        {header}
        <LoadingState rows={4} label="Loading your demo wallet" />
      </section>
    );
  }

  if (isOffline) {
    return (
      <section data-ocid="send.page">
        {header}
        <OfflineState
          title="You're offline"
          description="RedWallet can't reach the configured server, so fee estimates are unavailable. Reconnect and try again — your demo data is safe."
          onRetry={handleRetry}
        />
      </section>
    );
  }

  if (walletError || !activeWallet) {
    return (
      <section data-ocid="send.page">
        {header}
        <ErrorState
          title="Couldn't load your demo wallet"
          description={
            walletError?.message ??
            "No active demo wallet is selected. Pick one and try again."
          }
          onRetry={() => setIsOffline(true)}
        />
      </section>
    );
  }

  if (!activeWallet.isDemo) {
    return (
      <section data-ocid="send.page">
        <PageHeader title="Send" description="Watch-only address" />
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">
            Sending is unavailable
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This selected wallet watches a public address and cannot sign. Use
            an encrypted local wallet in Wallets to prepare an XBT payment.
          </p>
          <Link
            to="/wallets"
            className="mt-4 inline-block text-primary underline"
          >
            Open local XBT wallets
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section data-ocid="send.page" className="mx-auto w-full max-w-xl">
      {header}

      <p className="mb-5 text-sm text-muted-foreground">
        For real XBT payments,{" "}
        <Link to="/wallets" className="text-primary underline">
          open your encrypted local wallet
        </Link>
        . The form below is a demo only.
      </p>
      <div className="mb-5 flex items-center gap-3">
        <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
          Demo data
        </span>
        <span className="text-xs text-muted-foreground">
          {step === "form" ? "Step 1 of 2 — Details" : "Step 2 of 2 — Review"}
        </span>
      </div>

      <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-subtle sm:p-6">
        {step === "form" ? (
          <SendForm
            values={values}
            errors={errors}
            onChange={handleChange}
            onSubmit={handleReview}
            displayUnit={settings.displayUnit}
            availableXbt={availableXbt}
            availableFiatUsd={availableFiatUsd}
            feeEstimate={feeEstimate}
            isFeeLoading={isFeeLoading}
            feeError={feeError}
          />
        ) : (
          <SendReview
            recipient={values.recipient.trim()}
            amountXbt={parsedAmount ?? 0}
            note={values.note}
            feeEstimate={feeEstimate}
            displayUnit={settings.displayUnit}
            onBack={() => setStep("form")}
          />
        )}
      </div>
    </section>
  );
}

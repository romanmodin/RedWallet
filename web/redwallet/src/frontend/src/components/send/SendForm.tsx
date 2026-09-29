/**
 * SendForm — step one of the demo send flow.
 *
 * Collects a recipient address, an amount entered in the user's selected
 * display unit, and an optional note. Validation is inline and reachable:
 * empty recipient, malformed address, zero amount, and amount exceeding the
 * available demo balance. The live fee estimate is rendered beneath the
 * amount field and updates as the amount changes.
 */

import { FeeEstimate } from "@/components/send/FeeEstimate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount, formatFiat } from "@/lib/format";
import type {
  DisplayUnit,
  FeeEstimate as FeeEstimateValue,
} from "@/services/types";
import { ArrowRight, Wallet } from "lucide-react";
import { useId } from "react";

export interface SendFormValues {
  recipient: string;
  amount: string;
  note: string;
}

export interface SendFormErrors {
  recipient?: string;
  amount?: string;
}

interface SendFormProps {
  values: SendFormValues;
  errors: SendFormErrors;
  onChange: (patch: Partial<SendFormValues>) => void;
  onSubmit: () => void;
  displayUnit: DisplayUnit;
  availableXbt: number;
  availableFiatUsd: number;
  feeEstimate: FeeEstimateValue | null;
  isFeeLoading: boolean;
  feeError: string | null;
}

export function SendForm({
  values,
  errors,
  onChange,
  onSubmit,
  displayUnit,
  availableXbt,
  availableFiatUsd,
  feeEstimate,
  isFeeLoading,
  feeError,
}: SendFormProps) {
  const recipientId = useId();
  const amountId = useId();
  const noteId = useId();
  const recipientErrorId = useId();
  const amountErrorId = useId();

  return (
    <form
      data-ocid="send.form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={recipientId}>XBT recipient address (demo)</Label>
        <Input
          id={recipientId}
          data-ocid="send.recipient_input"
          value={values.recipient}
          onChange={(event) => onChange({ recipient: event.target.value })}
          placeholder="xbt-demo-address-not-valid"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          aria-invalid={errors.recipient ? true : undefined}
          aria-describedby={errors.recipient ? recipientErrorId : undefined}
          className="h-11 rounded-xl font-mono text-sm"
        />
        {errors.recipient ? (
          <p
            id={recipientErrorId}
            data-ocid="send.recipient_error"
            className="text-xs font-medium text-destructive"
          >
            {errors.recipient}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Paste an XBT demo recipient. Demo only — nothing is sent.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={amountId}>Amount</Label>
          <span className="text-xs text-muted-foreground">
            Available{" "}
            <span className="font-mono tabular-nums text-foreground">
              {formatAmount(availableXbt, displayUnit)}
            </span>
          </span>
        </div>
        <div className="relative">
          <Input
            id={amountId}
            data-ocid="send.amount_input"
            value={values.amount}
            onChange={(event) => onChange({ amount: event.target.value })}
            placeholder="0.00000000"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={errors.amount ? amountErrorId : undefined}
            className="h-12 rounded-xl pr-20 font-mono text-base tabular-nums"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-display text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {displayUnit}
          </span>
        </div>
        {errors.amount ? (
          <p
            id={amountErrorId}
            data-ocid="send.amount_error"
            className="text-xs font-medium text-destructive"
          >
            {errors.amount}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            ≈ {formatFiat(availableFiatUsd)} available in this demo wallet
          </p>
        )}
        <button
          type="button"
          data-ocid="send.max_button"
          onClick={() => onChange({ amount: String(availableXbt) })}
          className="flex w-fit items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-smooth outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wallet className="size-3.5" aria-hidden="true" />
          Use max
        </button>
      </div>

      <FeeEstimate
        estimate={feeEstimate}
        isLoading={isFeeLoading}
        error={feeError}
        displayUnit={displayUnit}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor={noteId}>
          Note{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={noteId}
          data-ocid="send.note_input"
          value={values.note}
          onChange={(event) => onChange({ note: event.target.value })}
          placeholder="What is this payment for?"
          rows={3}
          maxLength={140}
          className="rounded-xl"
        />
      </div>

      <Button
        type="submit"
        data-ocid="send.review_button"
        className="h-12 w-full rounded-full text-sm font-semibold"
      >
        Review payment
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </form>
  );
}

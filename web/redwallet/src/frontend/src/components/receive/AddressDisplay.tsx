/**
 * AddressDisplay — monospace demo receive address with copy-to-clipboard.
 *
 * The address is rendered in a readable, breakable monospace block so it can
 * be verified character by character, with a single primary copy action that
 * confirms success inline. Copy failures surface a visible, recoverable
 * message instead of failing silently.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface AddressDisplayProps {
  /** The demo receive address to display and copy. */
  address: string;
  className?: string;
  isDemo?: boolean;
}

/** How long the copied confirmation stays visible, in milliseconds. */
const COPIED_FEEDBACK_MS = 2400;

export function AddressDisplay({
  address,
  className,
  isDemo = true,
}: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function handleCopy() {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
      resetTimer.current = window.setTimeout(() => {
        setCopied(false);
        resetTimer.current = null;
      }, COPIED_FEEDBACK_MS);
    } catch {
      setCopied(false);
      setCopyError(
        "Couldn't copy automatically. Select the address above and copy it manually.",
      );
    }
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {isDemo ? "Demo receive address" : "Your watched XBT address"}
        </span>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
          {isDemo ? "Not real" : "Watch only"}
        </span>
      </div>

      <p
        data-ocid="receive.address_text"
        className="break-all rounded-xl border border-border bg-secondary/50 px-4 py-3.5 font-mono text-[13px] leading-relaxed text-foreground sm:text-sm"
      >
        {address}
      </p>

      <Button
        type="button"
        onClick={handleCopy}
        data-ocid="receive.copy_button"
        aria-label={
          copied
            ? "Address copied"
            : isDemo
              ? "Copy demo address"
              : "Copy XBT address"
        }
        className="h-11 w-full rounded-full bg-primary text-primary-foreground shadow-card-red transition-smooth hover:bg-primary/90 sm:w-auto sm:px-6"
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy address"}
      </Button>

      <output
        data-ocid="receive.copy_feedback"
        aria-live="polite"
        className={cn(
          "min-h-5 text-sm font-medium",
          copied ? "text-success" : "text-muted-foreground",
        )}
      >
        {copied
          ? "Copied to clipboard."
          : copyError
            ? copyError
            : isDemo
              ? "Copy this address to share the demo wallet."
              : "Share this public address to receive XBT in your original wallet."}
      </output>
    </div>
  );
}

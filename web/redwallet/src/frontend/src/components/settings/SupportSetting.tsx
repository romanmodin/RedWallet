/**
 * SupportSetting — discreet, collapsed voluntary-donation disclosure.
 *
 * RedWallet is free to use. This section lets someone who wants to support
 * development and testing see the project's public XBT (BLAKE2b) donation
 * address, scan it as a raw-address QR, or copy it. It is collapsed by
 * default so it never competes with the security-focused settings above it.
 *
 * The address is a plain public receive address: no payment URI, no amount,
 * no redirect, and no keys or secrets are involved anywhere on this surface.
 */

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Copy, Heart } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";

/** The project's public XBT (BLAKE2b) donation address. */
const SUPPORT_ADDRESS = "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4";

/** How long the copied confirmation stays visible, in milliseconds. */
const COPIED_FEEDBACK_MS = 2400;

interface SupportSettingProps {
  className?: string;
}

export function SupportSetting({ className }: SupportSettingProps) {
  const [open, setOpen] = useState(false);
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
      await navigator.clipboard.writeText(SUPPORT_ADDRESS);
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
    <section
      data-ocid="settings.section.support"
      className={cn(
        "rounded-2xl border border-border bg-card shadow-subtle",
        className,
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          data-ocid="settings.support.toggle"
          className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left transition-smooth hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Heart className="size-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-display text-sm font-semibold tracking-tight text-foreground">
              Support RedWallet
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Optional — RedWallet is free to use.
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-300",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden">
          <div className="flex flex-col gap-4 border-t border-border px-5 pb-5 pt-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              RedWallet is free. Voluntary XBT donations help cover development
              and testing. Sending is entirely optional and never required to
              use the app.
            </p>

            <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
              <div className="rounded-xl bg-white p-3 shadow-elevated">
                <QRCodeSVG
                  value={SUPPORT_ADDRESS}
                  size={168}
                  level="M"
                  marginSize={0}
                  bgColor="#ffffff"
                  fgColor="#0d0a0a"
                  title="QR code for the RedWallet XBT donation address"
                  className="h-auto w-full max-w-[168px]"
                />
              </div>
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                Scan with any XBT wallet to send a voluntary donation.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                XBT (BLAKE2b) donation address
              </span>
              <p
                data-ocid="settings.support.address_text"
                className="break-all rounded-xl border border-border bg-secondary/50 px-4 py-3.5 font-mono text-[13px] leading-relaxed text-foreground sm:text-sm"
              >
                {SUPPORT_ADDRESS}
              </p>
            </div>

            <Button
              type="button"
              onClick={handleCopy}
              data-ocid="settings.support.copy_button"
              aria-label={
                copied ? "Donation address copied" : "Copy donation address"
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
              data-ocid="settings.support.copy_feedback"
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
                  : "Verify the address in your own wallet before sending."}
            </output>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

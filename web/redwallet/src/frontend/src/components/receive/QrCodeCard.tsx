/**
 * QrCodeCard — scannable QR code for the demo receive address.
 *
 * Renders the address as a high-contrast QR code on a light plate so it stays
 * scannable against the dark theme, with a prominent demo-only warning that
 * no funds can be received. The QR encodes the demo address string only.
 */

import { cn } from "@/lib/utils";
import { QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface QrCodeCardProps {
  /** The demo receive address encoded into the QR code. */
  address: string;
  className?: string;
  isDemo?: boolean;
}

export function QrCodeCard({
  address,
  className,
  isDemo = true,
}: QrCodeCardProps) {
  return (
    <div
      data-ocid="receive.qr_card"
      className={cn(
        "flex flex-col items-center gap-5 rounded-2xl border border-border bg-card p-5 shadow-subtle sm:p-6",
        className,
      )}
    >
      <div className="flex w-full items-center gap-2">
        <QrCode className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-display text-sm font-semibold tracking-tight text-foreground">
          Scan to receive
        </h2>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-elevated">
        <QRCodeSVG
          value={address}
          size={232}
          level="M"
          marginSize={0}
          bgColor="#ffffff"
          fgColor="#0d0a0a"
          title={
            isDemo
              ? "QR code for the demo receive address"
              : "QR code for your watched XBT address"
          }
          className="h-auto w-full max-w-[232px]"
        />
      </div>

      <div
        data-ocid="receive.demo_warning"
        role="note"
        className="flex w-full items-start gap-2.5 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-3 text-left"
      >
        <span
          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed text-accent">
          <span className="font-display font-semibold uppercase tracking-[0.12em]">
            {isDemo ? "Demo only." : "Verify your address."}
          </span>{" "}
          {isDemo
            ? "This is not a real wallet address and no funds can be received. Never send real funds here."
            : "This is the public address you added. Verify it against your original XBT wallet before sharing. RedWallet cannot spend from this address."}
        </p>
      </div>
    </div>
  );
}

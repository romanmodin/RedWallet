/**
 * BalanceCard — the dashboard's signature surface.
 *
 * A crimson gradient slab with a soft red ambient glow, monospace digits,
 * and a persistent demo chip. Amounts can be masked with the visibility
 * toggle, which is announced politely to assistive technology.
 */

import { ManualFiatEstimate } from "@/components/settings/ManualFiatEstimate";
import { Button } from "@/components/ui/button";
import { formatAmount, formatFiat } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DisplayUnit } from "@/services/types";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Eye, EyeOff, Wallet } from "lucide-react";

interface BalanceCardProps {
  walletName: string;
  /** Neutral demo label shown in place of any address-like identifier. */
  walletShortId: string;
  balanceXbt: number;
  fiatUsd: number;
  displayUnit: DisplayUnit;
  visible: boolean;
  onToggleVisibility: () => void;
  className?: string;
  isDemo?: boolean;
  balanceError?: string;
}

export function BalanceCard({
  walletName,
  walletShortId,
  balanceXbt,
  fiatUsd,
  displayUnit,
  visible,
  onToggleVisibility,
  className,
  isDemo = true,
  balanceError,
}: BalanceCardProps) {
  const masked = "••••••••";

  return (
    <section
      data-ocid="dashboard.balance_card"
      aria-label="Wallet balance"
      className={cn(
        "relative overflow-hidden rounded-[20px] bg-gradient-primary p-5 text-primary-foreground shadow-card-red animate-fade-up md:p-6",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-primary-foreground/10 blur-2xl"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15">
            <Wallet className="size-4.5" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-display text-sm font-semibold tracking-tight">
              {walletName}
            </span>
            <span className="truncate text-[11px] text-primary-foreground/70">
              {walletShortId}
            </span>
          </div>
        </div>

        <span
          data-ocid="dashboard.balance_card.demo_pill"
          className="shrink-0 rounded-full border border-accent/50 bg-accent/20 px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-accent"
        >
          {isDemo ? "Demo" : "Watch only"}
        </span>
      </div>

      <div className="relative mt-6 flex flex-col gap-1">
        <span className="font-display text-[11px] font-semibold uppercase tracking-widest text-primary-foreground/70">
          {isDemo ? "Available balance" : "Address balance (includes pending)"}
        </span>
        <div className="flex items-end gap-3">
          <output
            data-ocid="dashboard.balance_card.amount"
            aria-live="polite"
            className="font-mono text-3xl font-bold tracking-tight tabular-nums md:text-4xl"
          >
            {visible ? formatAmount(balanceXbt, displayUnit) : masked}
          </output>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={visible ? "Hide balance" : "Show balance"}
            aria-pressed={!visible}
            data-ocid="dashboard.balance_card.visibility_toggle"
            onClick={onToggleVisibility}
            className="mb-0.5 size-9 shrink-0 rounded-full text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          >
            {visible ? (
              <EyeOff className="size-4.5" aria-hidden="true" />
            ) : (
              <Eye className="size-4.5" aria-hidden="true" />
            )}
          </Button>
        </div>
        <span className="font-mono text-sm text-primary-foreground/80 tabular-nums">
          {visible ? (
            !isDemo &&
            Number.isFinite(balanceXbt) &&
            Number.isSafeInteger(Math.round(balanceXbt * 1e8)) ? (
              <ManualFiatEstimate
                satoshis={BigInt(Math.round(balanceXbt * 1e8))}
                compact
              />
            ) : Number.isFinite(fiatUsd) ? (
              `≈ ${formatFiat(fiatUsd)}`
            ) : (
              "Fiat price unavailable"
            )
          ) : (
            "≈ ••••"
          )}
        </span>
      </div>

      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-primary-foreground/15 pt-4">
        <p className="text-[11px] leading-relaxed text-primary-foreground/70">
          {isDemo
            ? "Simulated demo balance — no real funds are held."
            : (balanceError ??
              "Live address balance. Spending keys stay in your original wallet.")}
        </p>
        <Link
          to="/wallets"
          data-ocid="dashboard.balance_card.wallets_link"
          className="inline-flex items-center gap-1 rounded-full bg-primary-foreground/15 px-3 py-1.5 text-xs font-medium text-primary-foreground transition-smooth outline-none hover:bg-primary-foreground/25 focus-visible:ring-2 focus-visible:ring-primary-foreground/60"
        >
          Switch wallet
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

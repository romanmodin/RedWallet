import { XbtAmountEstimate } from "@/components/settings/XbtAmountEstimate";
/**
 * WalletRow — a single selectable demo wallet card.
 *
 * Shows the wallet name, a truncated demo identifier, the balance in the
 * selected display unit, and its fiat equivalent. The active wallet is marked
 * with a crimson selection treatment and a check affordance. The whole row is
 * a real button so it is keyboard reachable and announced as a control.
 */

import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DisplayUnit, Wallet } from "@/services/types";
import { Check, Wallet as WalletIcon } from "lucide-react";

interface WalletRowProps {
  wallet: Wallet;
  isActive: boolean;
  displayUnit: DisplayUnit;
  /** Disable interaction while a selection is in flight. */
  disabled?: boolean;
  onSelect: (walletId: string) => void;
  /** 1-based position, used for deterministic test markers. */
  index: number;
}

export function WalletRow({
  wallet,
  isActive,
  displayUnit,
  disabled = false,
  onSelect,
  index,
}: WalletRowProps) {
  return (
    <button
      type="button"
      data-ocid={`wallets.item.${index}`}
      aria-pressed={isActive}
      disabled={disabled}
      onClick={() => onSelect(wallet.id)}
      className={cn(
        "group flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-smooth outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        isActive
          ? "border-primary/60 bg-primary/[0.07] shadow-card-red"
          : "border-border hover:-translate-y-0.5 hover:border-border/80 hover:bg-muted/40 hover:shadow-subtle",
      )}
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full transition-smooth",
          isActive
            ? "bg-gradient-primary text-primary-foreground"
            : "bg-secondary text-muted-foreground group-hover:text-foreground",
        )}
        aria-hidden="true"
      >
        <WalletIcon className="size-5" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-display text-sm font-semibold tracking-tight text-foreground">
            {wallet.name}
          </span>
          {isActive ? (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 rounded-full border-primary/50 bg-primary/15 px-2 py-0 text-[10px] font-semibold uppercase tracking-wider text-primary"
            >
              <Check className="size-3" aria-hidden="true" />
              Active
            </Badge>
          ) : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {wallet.shortId}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span className="font-mono text-sm font-medium tabular-nums text-foreground">
          {formatAmount(wallet.balanceXbt, wallet.isDemo ? displayUnit : "XBT")}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          <XbtAmountEstimate amountXbt={wallet.balanceXbt} />
        </span>
      </span>
    </button>
  );
}

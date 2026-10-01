/**
 * WalletList — responsive list of demo wallets.
 *
 * Mobile-first single column that becomes a comfortable two-column grid at
 * `lg`. Rows are staggered on entrance to match the dashboard motion story.
 */

import { WalletRow } from "@/components/wallets/WalletRow";
import type { DisplayUnit, Wallet } from "@/services/types";

interface WalletListProps {
  wallets: Wallet[];
  activeWalletId: string | null;
  displayUnit: DisplayUnit;
  /** Disable interaction while a selection is in flight. */
  disabled?: boolean;
  onSelect: (walletId: string) => void;
  onRemove?: (walletId: string) => void;
}

export function WalletList({
  wallets,
  activeWalletId,
  displayUnit,
  disabled = false,
  onSelect,
  onRemove,
}: WalletListProps) {
  return (
    <ul
      data-ocid="wallets.list"
      className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4"
    >
      {wallets.map((wallet, index) => (
        <li
          key={wallet.id}
          className="animate-fade-up"
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <WalletRow
            wallet={wallet}
            index={index + 1}
            isActive={wallet.id === activeWalletId}
            displayUnit={displayUnit}
            disabled={disabled}
            onSelect={onSelect}
          />
          {onRemove && (
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${wallet.name}`}
              onClick={() => onRemove(wallet.id)}
              className="mt-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

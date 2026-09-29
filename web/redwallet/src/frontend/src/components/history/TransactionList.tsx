/**
 * TransactionList — responsive list of demo transactions.
 *
 * Mobile-first single column that becomes a comfortable two-column grid at
 * `lg`. Rows are staggered on entrance to match the dashboard motion story.
 */

import { TransactionRow } from "@/components/history/TransactionRow";
import type { DisplayUnit, Transaction } from "@/services/types";

interface TransactionListProps {
  transactions: Transaction[];
  displayUnit: DisplayUnit;
}

export function TransactionList({
  transactions,
  displayUnit,
}: TransactionListProps) {
  return (
    <ul
      data-ocid="history.list"
      className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4"
    >
      {transactions.map((transaction, index) => (
        <li
          key={transaction.id}
          className="animate-fade-up"
          style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
        >
          <TransactionRow
            transaction={transaction}
            displayUnit={displayUnit}
            index={index + 1}
          />
        </li>
      ))}
    </ul>
  );
}

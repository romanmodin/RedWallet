import { Link } from "@tanstack/react-router";
import { Wallet } from "lucide-react";

const descriptions = {
  home: "Create or recover an encrypted XBT wallet, check its balance, receive, and prepare a payment.",
  receive:
    "Open your encrypted wallet to reserve its next receiving address. The address below belongs to the selected watched or demo account.",
  history:
    "Open your encrypted wallet and scan its public account to view its history. The list below is for the selected watched or demo account.",
};

/** Navigation only. Key material remains inside the existing protected workspace. */
export function LocalWalletEntry({
  purpose = "home",
}: { purpose?: keyof typeof descriptions }) {
  return (
    <aside
      aria-label="Local encrypted wallets"
      className="mb-5 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-5"
    >
      <div className="flex items-center gap-2 font-semibold">
        <Wallet className="size-5 text-primary" aria-hidden="true" />
        <h2>Local XBT wallets</h2>
      </div>
      <p className="text-sm text-muted-foreground">{descriptions[purpose]}</p>
      <Link
        to="/wallets"
        className="self-start rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Open encrypted wallets
      </Link>
    </aside>
  );
}

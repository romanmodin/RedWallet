/**
 * AppShell — responsive application shell.
 *
 * Phone: a compact top header with the RedWallet wordmark, demo pill, and
 * network indicator, plus a fixed bottom tab bar that respects iOS safe-area
 * insets.
 *
 * Desktop (lg+): a persistent sidebar with the wordmark, full navigation,
 * demo banner, and network status, alongside a top header bar.
 */

import { DemoBanner } from "@/components/layout/DemoBanner";
import { NetworkIndicator } from "@/components/layout/NetworkIndicator";
import { useWallet } from "@/hooks/useWallet";
import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar. */
  primary: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboard, primary: true },
  { to: "/history", label: "Activity", icon: History, primary: true },
  { to: "/send", label: "Send", icon: ArrowUpFromLine, primary: true },
  { to: "/settings", label: "Settings", icon: Settings, primary: true },
  { to: "/wallets", label: "Wallets", icon: Wallet, primary: false },
  { to: "/receive", label: "Receive", icon: ArrowDownToLine, primary: false },
  { to: "/status", label: "Network", icon: ShieldCheck, primary: false },
];

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      data-ocid="app_shell.home_link"
      className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="RedWallet home"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-primary shadow-card-red">
        <Wallet className="size-5 text-primary-foreground" aria-hidden="true" />
      </span>
      <span
        className={cn(
          "font-display font-semibold tracking-tight text-foreground",
          compact ? "text-base" : "text-lg",
        )}
      >
        RedWallet
      </span>
    </Link>
  );
}

function isActive(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { activeWallet } = useWallet();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const primaryItems = NAV_ITEMS.filter((item) => item.primary);

  return (
    <div className="min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center px-5">
          <Wordmark />
        </div>
        <div className="px-4 pb-4">
          <DemoBanner
            className="w-full justify-center"
            walletManagement={pathname === "/wallets"}
          />
        </div>
        <nav
          aria-label="Primary"
          className="flex flex-1 flex-col gap-1 px-3 py-2"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                data-ocid={`app_shell.nav.${item.label.toLowerCase()}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-smooth outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <NetworkIndicator />
        </div>
      </aside>

      {/* Main column */}
      <div className="lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 backdrop-blur-md safe-top lg:hidden">
          <Wordmark compact />
          <div className="flex items-center gap-2">
            <DemoBanner compact walletManagement={pathname === "/wallets"} />
            <NetworkIndicator compact />
          </div>
        </header>

        {/* Desktop top bar */}
        <header className="sticky top-0 z-20 hidden h-16 items-center justify-between gap-4 border-b border-border bg-card/90 px-6 backdrop-blur-md lg:flex">
          <p className="text-sm text-muted-foreground">
            {pathname === "/wallets"
              ? "Manage watched addresses and encrypted local XBT wallets."
              : activeWallet?.isDemo
                ? "Demo wallet — balances, addresses, and transactions are simulated."
                : activeWallet
                  ? "Watch-only address — live reads from the XBT network; sending is unavailable."
                  : "Select an XBT wallet to view its status."}
          </p>
          <NetworkIndicator />
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 sm:px-6 lg:pb-12">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur-md safe-bottom lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2">
          {primaryItems.map((item) => {
            const active = isActive(pathname, item.to);
            const Icon = item.icon;
            return (
              <li key={item.to} className="flex-1">
                <Link
                  to={item.to}
                  data-ocid={`app_shell.tab.${item.label.toLowerCase()}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition-smooth outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5",
                      active &&
                        "drop-shadow-[0_0_8px_oklch(var(--primary)/0.5)]",
                    )}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

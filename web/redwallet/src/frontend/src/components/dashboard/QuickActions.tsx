/**
 * QuickActions — the dashboard's primary action row.
 *
 * Send is the single primary action; Receive and History are secondary.
 * Each action is a real link to its route. RedWallet is watch-only by design,
 * so the hints are fixed: Send states that sending is unavailable, and Receive
 * asks the user to share their public address.
 */

import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowUpFromLine, History } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface QuickAction {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  primary: boolean;
  ocid: string;
}

const ACTIONS: QuickAction[] = [
  {
    to: "/send",
    label: "Send",
    hint: "Sending unavailable — watch-only",
    icon: ArrowUpFromLine,
    primary: true,
    ocid: "dashboard.quick_actions.send",
  },
  {
    to: "/receive",
    label: "Receive",
    hint: "Share your public address",
    icon: ArrowDownToLine,
    primary: false,
    ocid: "dashboard.quick_actions.receive",
  },
  {
    to: "/history",
    label: "History",
    hint: "Browse all activity",
    icon: History,
    primary: false,
    ocid: "dashboard.quick_actions.history",
  },
];

export function QuickActions({ className }: { className?: string }) {
  return (
    <section
      data-ocid="dashboard.quick_actions"
      aria-label="Quick actions"
      className={cn("grid grid-cols-3 gap-3", className)}
    >
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.to}
            to={action.to}
            data-ocid={action.ocid}
            className={cn(
              "group flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-center transition-smooth outline-none focus-visible:ring-2 focus-visible:ring-ring",
              action.primary
                ? "border-transparent bg-gradient-primary text-primary-foreground shadow-card-red hover:-translate-y-0.5"
                : "border-border bg-card text-foreground shadow-subtle hover:-translate-y-0.5 hover:bg-muted/60",
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full",
                action.primary
                  ? "bg-primary-foreground/15"
                  : "bg-secondary text-muted-foreground group-hover:text-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-display text-sm font-semibold tracking-tight">
                {action.label}
              </span>
              <span
                className={cn(
                  "text-[10px] leading-tight",
                  action.primary
                    ? "text-primary-foreground/75"
                    : "text-muted-foreground",
                )}
              >
                {action.hint}
              </span>
            </span>
          </Link>
        );
      })}
    </section>
  );
}

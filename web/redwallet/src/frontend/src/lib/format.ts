/**
 * Pure formatting and unit-conversion helpers.
 *
 * No React, no UI imports, no side effects. Safe to use from services,
 * hooks, and components alike.
 */

import type { DisplayUnit } from "@/services/types";

/** 1 XBT (ISO-style code) === 1 BTC. The unit is a display convention only. */
export const SATOSHIS_PER_XBT = 100_000_000;

/** Convert an XBT amount to BTC. The numeric value is identical. */
export function xbtToBtc(amountXbt: number): number {
  return amountXbt;
}

/** Convert a BTC amount to XBT. The numeric value is identical. */
export function btcToXbt(amountBtc: number): number {
  return amountBtc;
}

/** Convert an XBT amount to satoshis. */
export function xbtToSats(amountXbt: number): number {
  return Math.round(amountXbt * SATOSHIS_PER_XBT);
}

/** Convert satoshis to an XBT amount. */
export function satsToXbt(sats: number): number {
  return sats / SATOSHIS_PER_XBT;
}

/**
 * Format an XBT amount with a fixed 8-decimal precision and thousands
 * separators, e.g. `1,204.50000000`.
 */
export function formatXbt(amountXbt: number, decimals = 8): string {
  if (!Number.isFinite(amountXbt)) return "—";
  return amountXbt.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a BTC amount. Numerically identical to `formatXbt`. */
export function formatBtc(amountBtc: number, decimals = 8): string {
  return formatXbt(amountBtc, decimals);
}

/**
 * Format an amount in the requested display unit, appending the unit code.
 * e.g. `formatAmount(0.5, "XBT")` -> `"0.50000000 XBT"`.
 */
export function formatAmount(amount: number, unit: DisplayUnit): string {
  const formatted = unit === "XBT" ? formatXbt(amount) : formatBtc(amount);
  return `${formatted} ${unit}`;
}

/**
 * Format a USD value as currency, e.g. `$48,120.55`.
 * Falls back to an em dash for non-finite input.
 */
export function formatFiat(
  amountUsd: number,
  currency = "USD",
  locale = "en-US",
): string {
  if (!Number.isFinite(amountUsd)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountUsd);
}

/**
 * Format a timestamp as a short relative date, e.g. `"3h ago"`, `"2d ago"`,
 * or an absolute date once it is older than a week.
 */
export function formatRelativeDate(
  timestamp: number,
  now = Date.now(),
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = now - timestamp;
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  if (diffSec < 45) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date(now).getFullYear()
        ? undefined
        : "numeric",
  });
}

/**
 * Truncate a long address or hash for display, keeping a head and tail
 * segment, e.g. `xbt-demo-address-not-valid`.
 */
export function truncateAddress(value: string, head = 8, tail = 4): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Format a block height with thousands separators. */
export function formatBlockHeight(height: number): string {
  if (!Number.isFinite(height)) return "—";
  return height.toLocaleString("en-US");
}

/** Format a duration in milliseconds as a compact latency string. */
export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  return `${Math.round(ms)} ms`;
}

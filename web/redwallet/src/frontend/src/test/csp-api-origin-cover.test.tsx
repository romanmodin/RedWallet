/**
 * Current-change regression coverage for the production API-origin CSP
 * revision.
 *
 * The production change rewrites `connect-src` so it allows exactly `'self'`
 * and the exact cross-origin production backend API origin
 * `https://icp-api.io` (the previous `https://id.ai` entry is removed), and
 * corrects `CSP-VERIFICATION.md` to state that the real production backend host
 * is that cross-origin origin rather than same-origin `'self'`. The AppShell
 * desktop header also drops its stale "Demo wallet — …" copy for a real watched
 * address.
 *
 * The exact `connect-src` value and the CSP meta ordering are already pinned by
 * the sibling `csp-hardening-cover.test.tsx`; this file deliberately does not
 * duplicate them. It covers the two accepted behaviors those tests do not
 * assert directly:
 *
 *  - the AppShell desktop top-bar copy for a real watched address is the
 *    watch-only line, not the stale demo line, while the mobile header and the
 *    watch-only send posture are unchanged;
 *  - `CSP-VERIFICATION.md` names the cross-origin `https://icp-api.io` origin as
 *    the production backend host (not same-origin `'self'`) and separates mock
 *    route tests from real network reads.
 *
 * The journey tests mount the real `App` against the in-memory bridge service
 * with a typed local mock. No network is touched.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import App from "@/App";
import { bridgeWalletService } from "@/services/bridgeService";
import type { Wallet } from "@/services/types";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/** Vitest runs with cwd = `app/src/frontend`. */
const FRONTEND_ROOT = resolve(process.cwd());
const CSP_DOC = join(FRONTEND_ROOT, "src", "lib", "xbt", "CSP-VERIFICATION.md");

/** The exact cross-origin production backend API origin. */
const API_ORIGIN = "https://icp-api.io";

/** A real watched (non-demo) active wallet, as the bridge service reports it. */
const WATCH_WALLET: Wallet = {
  id: "watch-api-origin",
  name: "My XBT",
  address: "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4",
  shortId: "bc1q86…ktfd4",
  isDemo: false,
  balanceXbt: 0.75,
  fiatValueUsd: Number.NaN,
};

/** A demo wallet, as the in-memory service reports it by default. */
const DEMO_WALLET: Wallet = {
  id: "demo-api-origin",
  name: "Demo wallet",
  address: "xbt-demo-address-not-valid",
  shortId: "xbt-demo…valid",
  isDemo: true,
  balanceXbt: 1.25,
  fiatValueUsd: 100_000,
};

function mockActiveWallet(wallet: Wallet): void {
  vi.spyOn(bridgeWalletService, "getActiveWallet").mockResolvedValue({
    ok: true,
    value: wallet,
  });
  vi.spyOn(bridgeWalletService, "listWallets").mockResolvedValue({
    ok: true,
    value: [wallet],
  });
}

describe("AppShell desktop header for a real watched address", () => {
  it("shows the watch-only line and no stale demo copy", async () => {
    mockActiveWallet(WATCH_WALLET);
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    // The desktop top bar is present in the DOM (CSS hides it on small
    // viewports); its copy must describe a live watched address.
    expect(
      screen.getByText(
        "Watch-only address — live reads from the XBT network; sending is unavailable.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Demo wallet — balances, addresses, and transactions are simulated.",
      ),
    ).toBeNull();
  });

  it("keeps the mobile header watch-only and the send posture unchanged", async () => {
    mockActiveWallet(WATCH_WALLET);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    const banners = screen.getAllByTestId("demo_banner");
    const compact = banners.find((banner) =>
      within(banner).queryByText("Watch only"),
    );
    expect(
      compact,
      "no watch-only banner for a real watched address",
    ).toBeDefined();
    expect(within(compact as HTMLElement).queryByText("Demo mode")).toBeNull();

    await user.click(screen.getByTestId("app_shell.nav.send"));
    expect(await screen.findByText("Sending is unavailable")).toBeVisible();
    expect(screen.queryByTestId("send.recipient_input")).toBeNull();
  });

  it("still shows the demo line for a demo wallet", async () => {
    mockActiveWallet(DEMO_WALLET);
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    expect(
      screen.getByText(
        "Demo wallet — balances, addresses, and transactions are simulated.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Watch-only address — live reads from the XBT network; sending is unavailable.",
      ),
    ).toBeNull();
  });
});

describe("CSP-VERIFICATION.md backend-host claim", () => {
  const doc = readFileSync(CSP_DOC, "utf8");

  it("names the cross-origin production API origin as the backend host", () => {
    expect(doc).toContain(API_ORIGIN);
    // The corrected claim: the production backend host is the cross-origin
    // API origin, not same-origin 'self'.
    expect(doc).toMatch(/cross-origin/i);
    expect(doc).toMatch(/not\b[^.\n]*same-origin/i);
  });

  it("no longer claims the backend host is same-origin 'self'", () => {
    // A stale claim would read as the backend host being same-origin.
    expect(doc).not.toMatch(/backend host is (?:the )?same-origin/i);
    expect(doc).not.toMatch(/backend_host[^\n]*same-origin/i);
  });

  it("separates mock route tests from real network reads", () => {
    expect(doc).toMatch(/mock route/i);
    expect(doc).toMatch(/network read/i);
    // The doc must state plainly that the mock suites do not prove live
    // connectivity (markdown emphasis may sit between the words).
    expect(doc).toMatch(/do(?:es)?\s+\*{0,2}not\*{0,2}\s+prove live/i);
  });
});

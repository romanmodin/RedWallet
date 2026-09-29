/**
 * Characterization tests for behavior adjacent to the production API-origin
 * CSP change.
 *
 * The upcoming change intentionally rewrites `connect-src` so it allows exactly
 * `'self'` and the exact cross-origin production backend API origin
 * `https://icp-api.io`, and corrects `CSP-VERIFICATION.md` to state that the
 * real production backend host is that cross-origin origin rather than
 * same-origin `'self'`. The AppShell desktop header also drops its stale
 * "Demo wallet — …" copy for a real watched address.
 *
 * None of those intentionally-changing values are frozen here. Instead these
 * tests pin the surrounding invariants that must survive the change:
 *
 *  - the CSP meta is still the first element inside `<head>`, before any
 *    script tag, and there is exactly one of them;
 *  - `script-src` is still exactly `'self'`, with no remote, `eval`, inline,
 *    `blob:` or `data:` source;
 *  - `object-src`/`base-uri`/`form-action` are still `'none'`;
 *  - no analytics or CDN origin appears anywhere in the policy;
 *  - the mobile header still labels a real watched address as watch-only, and
 *    the watch-only send posture is unchanged.
 *
 * The source scans read the files that ship in the app; the journey tests mount
 * the real `App` against the in-memory demo service. No network is touched.
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
const INDEX_HTML = join(FRONTEND_ROOT, "index.html");

/** Parse the `<head>` inner HTML from a full document. */
function headOf(html: string): string {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!match) throw new Error("no <head> element found");
  return match[1];
}

/** The first element tag inside `<head>`, or null when the head is empty. */
function firstHeadElement(head: string): string | null {
  const match = head.match(/<[a-zA-Z][^>]*>/);
  return match ? match[0] : null;
}

/** The `content` attribute of the CSP meta, or null when absent. */
function cspContent(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/http-equiv\s*=\s*["']?Content-Security-Policy["']?/i.test(tag)) {
      continue;
    }
    const doubleQuoted = tag.match(/content\s*=\s*"([^"]*)"/i);
    if (doubleQuoted) return doubleQuoted[1];
    const singleQuoted = tag.match(/content\s*=\s*'([^']*)'/i);
    return singleQuoted ? singleQuoted[1] : null;
  }
  return null;
}

/** Parse a CSP string into a directive -> source-list map. */
function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/** The source list for a directive, or null when the directive is absent. */
function directive(policy: string, name: string): string[] | null {
  return parsePolicy(policy).get(name.toLowerCase()) ?? null;
}

/** Absolute `http(s)://` origins in a source list. */
function remoteOrigins(sources: string[]): string[] {
  return sources.filter((source) => /^https?:\/\//i.test(source));
}

/** A real watched (non-demo) active wallet, as the bridge service reports it. */
const WATCH_WALLET: Wallet = {
  id: "watch-characterization",
  name: "My XBT",
  address: "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4",
  shortId: "bc1q86…ktfd4",
  isDemo: false,
  balanceXbt: 0.75,
  fiatValueUsd: Number.NaN,
};

describe("CSP head ordering and script policy (unchanged by the API-origin change)", () => {
  const html = readFileSync(INDEX_HTML, "utf8");
  const policy = cspContent(html) ?? "";

  it("keeps the CSP meta as the first head element, before any script", () => {
    const first = firstHeadElement(headOf(html));
    expect(first, "no first head element").not.toBeNull();
    expect(first ?? "").toMatch(/^<meta\b/i);
    expect(first ?? "").toMatch(
      /http-equiv\s*=\s*["']?Content-Security-Policy["']?/i,
    );

    const cspIndex = html.search(
      /http-equiv\s*=\s*["']?Content-Security-Policy["']?/i,
    );
    const firstScriptIndex = html.search(/<script\b/i);
    expect(cspIndex).toBeGreaterThanOrEqual(0);
    expect(firstScriptIndex).toBeGreaterThanOrEqual(0);
    expect(cspIndex).toBeLessThan(firstScriptIndex);
  });

  it("ships exactly one CSP meta", () => {
    const cspTags = (html.match(/<meta\b[^>]*>/gi) ?? []).filter((tag) =>
      /http-equiv\s*=\s*["']?Content-Security-Policy["']?/i.test(tag),
    );
    expect(cspTags).toHaveLength(1);
  });

  it("keeps script-src exactly 'self' with no remote, eval, inline, blob or data source", () => {
    expect(directive(policy, "script-src")).toEqual(["'self'"]);
    const scriptSources = directive(policy, "script-src") ?? [];
    for (const forbidden of [
      "'unsafe-inline'",
      "'unsafe-eval'",
      "blob:",
      "data:",
    ]) {
      expect(scriptSources, `script-src contains ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    expect(remoteOrigins(scriptSources), "remote script origin").toEqual([]);
  });

  it("keeps object-src, base-uri and form-action at 'none'", () => {
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'none'"]);
    expect(directive(policy, "form-action")).toEqual(["'none'"]);
  });

  it("adds no analytics or CDN origin anywhere in the policy", () => {
    expect(policy).not.toMatch(/cdn\.caffeine\.ai/i);
    expect(policy).not.toMatch(/analytics|umami|google-analytics|gtag/i);
  });
});

describe("AppShell watch-only behavior for a real watched address (unchanged)", () => {
  function watchState() {
    vi.spyOn(bridgeWalletService, "getActiveWallet").mockResolvedValue({
      ok: true,
      value: WATCH_WALLET,
    });
    vi.spyOn(bridgeWalletService, "listWallets").mockResolvedValue({
      ok: true,
      value: [WATCH_WALLET],
    });
  }

  it("labels the mobile header as watch-only, not demo", async () => {
    watchState();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    const banners = screen.getAllByTestId("demo_banner");
    expect(banners.length).toBeGreaterThan(0);
    // The compact mobile header banner must read "Watch only" for a real
    // watched address; the demo label must not survive.
    const compact = banners.find((banner) =>
      within(banner).queryByText("Watch only"),
    );
    expect(
      compact,
      "no watch-only banner for a real watched address",
    ).toBeDefined();
    expect(
      within(compact as HTMLElement).getByText("Watch only"),
    ).toBeInTheDocument();
    expect(within(compact as HTMLElement).queryByText("Demo mode")).toBeNull();
  });

  it("keeps sending unavailable for a real watched address", async () => {
    watchState();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    await user.click(screen.getByTestId("app_shell.nav.send"));
    expect(await screen.findByText("Sending is unavailable")).toBeVisible();
    expect(screen.queryByTestId("send.recipient_input")).toBeNull();
  });
});

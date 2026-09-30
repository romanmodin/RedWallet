/**
 * Current-change regression coverage for the browser Content-Security-Policy
 * hardening revision.
 *
 * The production change is a static document-head policy: a restrictive CSP
 * `<meta http-equiv="Content-Security-Policy">` authored as the first element
 * inside `<head>` of `src/frontend/index.html`, a build-time
 * `transformIndexHtml` guard in `src/frontend/vite.config.js` that asserts the
 * policy is present and first in the emitted `dist/index.html`, and a corrected
 * public metadata description.
 *
 * These tests pin the accepted shape of that change:
 *
 *  - the CSP meta is the first head element, before any script tag;
 *  - `script-src` is same-origin only, with no `'unsafe-inline'`,
 *    `'unsafe-eval'`, remote, `blob:` or `data:` source;
 *  - `object-src`/`base-uri`/`form-action` are `'none'`;
 *  - `connect-src` is limited to `'self'` plus the exact cross-origin
 *    production API origin `https://icp-api.io`, with no wildcard and no other
 *    origin;
 *  - `style-src` permits `'unsafe-inline'`; `img-src` is `'self' data:`;
 *    `font-src` is `'self'`;
 *  - no analytics/CDN origin appears anywhere in the policy;
 *  - the metadata description is watch-only/read-only and carries no
 *    demo-only wording;
 *  - the default route and every route still render, and the watch-only
 *    posture is unchanged.
 *
 * The build-time guard itself is exercised in the sibling
 * `csp-guard-cover.test.ts` (Node environment).
 *
 * The source scans read the files that ship in the app; the journey tests mount
 * the real `App` against the in-memory demo service. No network is touched.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import App from "@/App";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

/** Vitest runs with cwd = `app/src/frontend`. */
const FRONTEND_ROOT = resolve(process.cwd());
const INDEX_HTML = join(FRONTEND_ROOT, "index.html");

/**
 * The exact cross-origin production backend API origin the wallet contacts at
 * runtime. The accepted requirement is that `connect-src` allows exactly
 * `'self'` and this origin — no wildcard and no other remote origin.
 */
const API_ORIGIN = "https://icp-api.io";

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

/** The CSP meta tag from a document, or null when absent. */
function cspMetaTag(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (/http-equiv\s*=\s*["']?Content-Security-Policy["']?/i.test(tag)) {
      return tag;
    }
  }
  return null;
}

/**
 * The `content` attribute of the CSP meta, or null when absent. The policy
 * itself contains single quotes (`'self'`), so the attribute is matched with
 * double quotes and may contain single quotes.
 */
function cspContent(html: string): string | null {
  const tag = cspMetaTag(html);
  if (!tag) return null;
  const doubleQuoted = tag.match(/content\s*=\s*"([^"]*)"/i);
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = tag.match(/content\s*=\s*'([^']*)'/i);
  return singleQuoted ? singleQuoted[1] : null;
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

describe("CSP meta is the first head policy element", () => {
  it("places the Content-Security-Policy meta first in <head>, before any script", () => {
    const html = readFileSync(INDEX_HTML, "utf8");
    const head = headOf(html);
    const first = firstHeadElement(head);

    expect(first, "no first head element").not.toBeNull();
    expect(first ?? "", "first head element is not the CSP meta").toMatch(
      /^<meta\b/i,
    );
    expect(first ?? "").toMatch(
      /http-equiv\s*=\s*["']?Content-Security-Policy["']?/i,
    );

    // The policy must precede every script tag in the document.
    const cspIndex = html.search(
      /http-equiv\s*=\s*["']?Content-Security-Policy["']?/i,
    );
    const firstScriptIndex = html.search(/<script\b/i);
    expect(cspIndex).toBeGreaterThanOrEqual(0);
    expect(firstScriptIndex).toBeGreaterThanOrEqual(0);
    expect(cspIndex).toBeLessThan(firstScriptIndex);
  });

  it("ships exactly one CSP meta and no inline script body", () => {
    const html = readFileSync(INDEX_HTML, "utf8");
    const cspTags = (html.match(/<meta\b[^>]*>/gi) ?? []).filter((tag) =>
      /http-equiv\s*=\s*["']?Content-Security-Policy["']?/i.test(tag),
    );
    expect(cspTags).toHaveLength(1);

    const scriptTags = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) {
      const body = tag
        .replace(/<script\b[^>]*>/i, "")
        .replace(/<\/script>/i, "");
      expect(body.trim(), `inline script body: ${tag}`).toBe("");
    }
  });
});

describe("CSP policy shape", () => {
  const policy = cspContent(readFileSync(INDEX_HTML, "utf8")) ?? "";

  it("has a parseable policy with a default-src deny-by-default", () => {
    expect(policy.length).toBeGreaterThan(0);
    expect(directive(policy, "default-src")).toEqual(["'self'"]);
  });

  it("restricts script-src to same-origin only", () => {
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

  it("disables object embedding, base URI changes, and form submissions", () => {
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'none'"]);
    expect(directive(policy, "form-action")).toEqual(["'none'"]);
  });

  it("limits connect-src to self plus the exact production API origin", () => {
    const connect = directive(policy, "connect-src");
    expect(connect).not.toBeNull();
    expect(connect).toContain("'self'");
    expect(connect).toContain(API_ORIGIN);
    // No origin other than the app's own and the exact API origin.
    expect(remoteOrigins(connect ?? [])).toEqual([API_ORIGIN]);
  });

  it("pins the exact production API origin in connect-src and rejects a wildcard", () => {
    const connect = directive(policy, "connect-src") ?? [];
    // The exact origin must be present, not a wildcard or a lookalike.
    expect(connect).toContain(API_ORIGIN);
    expect(connect).not.toContain("*");
    expect(connect.join(" ")).not.toMatch(/\*/);
    // A wildcarded or removed origin would change this exact remote set.
    expect(remoteOrigins(connect)).toEqual([API_ORIGIN]);
  });

  it("permits inline CSS but keeps fonts and images same-origin", () => {
    expect(directive(policy, "style-src")).toContain("'unsafe-inline'");
    expect(directive(policy, "font-src")).toEqual(["'self'"]);
    expect(directive(policy, "img-src")).toEqual(["'self'", "data:"]);
  });

  it("adds no analytics or CDN origin anywhere in the policy", () => {
    expect(policy).not.toMatch(/cdn\.caffeine\.ai/i);
    expect(policy).not.toMatch(/analytics|umami|google-analytics|gtag/i);
    // Every remote origin in the whole policy is the exact API origin.
    const allSources = [...parsePolicy(policy).values()].flat();
    expect(remoteOrigins(allSources)).toEqual([API_ORIGIN]);
  });
});

describe("Public metadata description", () => {
  const html = readFileSync(INDEX_HTML, "utf8");

  it("describes the preview and local encrypted wallet posture", () => {
    const description = html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i,
    )?.[1];
    expect(description, "no meta description").toBeTruthy();
    expect(description ?? "").toMatch(/watch-only/i);
    expect(description ?? "").toMatch(/0\.28 preview/i);
    expect(description ?? "").toMatch(/local encrypted native SegWit wallets/i);
  });

  it("contains no demo-only wording", () => {
    const description = html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i,
    )?.[1];
    expect(description ?? "").not.toMatch(/demo[- ]only/i);
    expect(description ?? "").not.toMatch(/\bdemo\b/i);
  });
});

describe("Watch-only posture and route rendering (unchanged)", () => {
  it("renders the default route without a blank screen", async () => {
    render(<App />);
    expect(await screen.findByTestId("dashboard.page")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });

  it("renders every route without a blank screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.page");

    const routes: Array<{ nav: string; page: string }> = [
      { nav: "app_shell.nav.home", page: "dashboard.page" },
      { nav: "app_shell.nav.activity", page: "history.page" },
      { nav: "app_shell.nav.send", page: "send.page" },
      { nav: "app_shell.nav.wallets", page: "wallets.page" },
      { nav: "app_shell.nav.receive", page: "receive.page" },
      { nav: "app_shell.nav.network", page: "status.page" },
      { nav: "app_shell.nav.settings", page: "settings.page" },
    ];
    for (const route of routes) {
      await user.click(screen.getByTestId(route.nav));
      expect(await screen.findByTestId(route.page)).toBeInTheDocument();
    }
  });

  it("keeps the send confirm disabled and never broadcasts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");
    await user.click(screen.getByTestId("dashboard.quick_actions.send"));
    await screen.findByTestId("send.form");

    await user.type(
      screen.getByTestId("send.recipient_input"),
      "xbt-demo-address-not-valid",
    );
    await user.type(screen.getByTestId("send.amount_input"), "0.1");
    await user.click(screen.getByTestId("send.review_button"));

    await screen.findByTestId("send.review");
    expect(screen.getByTestId("send.confirm_button")).toBeDisabled();
    expect(screen.getByTestId("send.demo_notice")).toHaveTextContent(
      /No real transaction is created, signed, or broadcast/,
    );
  });

  it("exposes no seed, mnemonic, or recovery input on any route", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.page");

    const routes: Array<{ nav: string; page: string }> = [
      { nav: "app_shell.nav.home", page: "dashboard.page" },
      { nav: "app_shell.nav.activity", page: "history.page" },
      { nav: "app_shell.nav.send", page: "send.page" },
      { nav: "app_shell.nav.wallets", page: "wallets.page" },
      { nav: "app_shell.nav.receive", page: "receive.page" },
      { nav: "app_shell.nav.network", page: "status.page" },
      { nav: "app_shell.nav.settings", page: "settings.page" },
    ];
    for (const route of routes) {
      await user.click(screen.getByTestId(route.nav));
      await screen.findByTestId(route.page);
      expect(
        screen.queryByLabelText(/seed|mnemonic|recovery phrase/i),
      ).not.toBeInTheDocument();
    }
  });
});

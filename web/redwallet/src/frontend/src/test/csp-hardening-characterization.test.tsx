/**
 * Characterization tests for behavior adjacent to the browser content-policy
 * hardening.
 *
 * The upcoming change intentionally adds a restrictive Content-Security-Policy
 * as the first head policy element in `index.html` and corrects the public
 * metadata description. Neither the new CSP element nor the new description is
 * frozen here — those are the values the change deliberately rewrites.
 *
 * Instead these tests pin the surrounding invariants the restrictive policy
 * depends on and that must survive the change:
 *
 *  - the app shell ships no inline script body, no `eval`/`new Function`, no
 *    remote script origin, and no `blob:`/`data:` script source, so a
 *    `script-src 'self'` policy does not break the app;
 *  - the app's own source never reaches a remote executable origin;
 *  - the watch-only posture (no seed/sign/recovery surface, send confirm
 *    disabled, no broadcast) is unchanged;
 *  - the default route and every route still render without a blank screen.
 *
 * The source scans read the files that ship in the app; the journey tests mount
 * the real `App` against the in-memory demo service. No network is touched.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import App from "@/App";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

/** Vitest runs with cwd = `app/src/frontend`. */
const FRONTEND_ROOT = resolve(process.cwd());
const FRONTEND_SRC = join(FRONTEND_ROOT, "src");
const INDEX_HTML = join(FRONTEND_ROOT, "index.html");

/** This scan file itself contains sample strings and is not production. */
const SELF = fileURLToPath(import.meta.url);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Production source files, excluding this scan and any test file. */
function productionSources(): string[] {
  return walk(FRONTEND_SRC).filter((file) => {
    if (file === SELF) return false;
    const rel = relative(FRONTEND_SRC, file).split("\\").join("/");
    return !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(rel);
  });
}

/**
 * A remote executable origin: an absolute `http(s)://` URL that is not the
 * app's own origin. The app's own origin is relative (`/...`) or a bare
 * `https://caffeine.ai` share image, which is an image, not executable code.
 */
function remoteScriptOrigins(source: string): string[] {
  const hits: string[] = [];
  const re = /https?:\/\/[^\s"'`)]+/g;
  for (const match of source.matchAll(re)) {
    const url = match[0];
    // Share/OG images and documentation links are not executable code.
    if (/\.(png|jpe?g|svg|webp|ico|woff2?|md|json)(\?|#|$)/i.test(url))
      continue;
    if (/caffeine\.ai\/imgs\//.test(url)) continue;
    hits.push(url);
  }
  return hits;
}

describe("CSP-adjacent source invariants (not the policy itself)", () => {
  it("ships no inline script body in the app shell HTML", () => {
    const html = readFileSync(INDEX_HTML, "utf8");

    // Every <script> tag must be an external module reference, never an inline
    // body. A `script-src 'self'` policy blocks inline scripts, so an inline
    // body here would blank the app after the change.
    const scriptTags = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) {
      const body = tag
        .replace(/<script\b[^>]*>/i, "")
        .replace(/<\/script>/i, "");
      expect(body.trim(), `inline script body: ${tag}`).toBe("");
      expect(tag, `script tag without src: ${tag}`).toMatch(/\bsrc=/i);
    }
  });

  it("references no remote script origin and no blob:/data: script source", () => {
    const html = readFileSync(INDEX_HTML, "utf8");
    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];

    for (const tag of scriptTags) {
      const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
      expect(src, `remote script src: ${tag}`).not.toMatch(/^https?:\/\//i);
      expect(src, `blob:/data: script src: ${tag}`).not.toMatch(
        /^(blob|data):/i,
      );
    }
  });

  it("never uses eval or new Function in production source", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        if (/\beval\s*\(/.test(line) || /\bnew\s+Function\s*\(/.test(line)) {
          offenders.push(`${relative(FRONTEND_ROOT, file)}: ${trimmed}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reaches no remote executable origin from production source", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const source = readFileSync(file, "utf8");
      for (const url of remoteScriptOrigins(source)) {
        offenders.push(`${relative(FRONTEND_ROOT, file)}: ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the self-hosted font assets the policy must allow", () => {
    const css = readFileSync(join(FRONTEND_SRC, "index.css"), "utf8");
    const fontUrls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(
      (m) => m[1],
    );
    expect(fontUrls.length).toBeGreaterThan(0);
    for (const url of fontUrls) {
      expect(url, `remote font: ${url}`).not.toMatch(/^https?:\/\//i);
      expect(url, `non-self font: ${url}`).toMatch(/^\//);
    }
  });
});

describe("Watch-only posture (unchanged by the policy change)", () => {
  it("renders the dashboard on the default route without a blank screen", async () => {
    render(<App />);
    expect(await screen.findByTestId("dashboard.page")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });

  it("keeps the demo-only send confirm disabled and never broadcasts", async () => {
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

    const review = await screen.findByTestId("send.review");
    expect(screen.getByTestId("send.confirm_button")).toBeDisabled();
    expect(screen.getByTestId("send.demo_notice")).toHaveTextContent(
      /No real transaction is created, signed, or broadcast/,
    );
    expect(review).toBeInTheDocument();
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

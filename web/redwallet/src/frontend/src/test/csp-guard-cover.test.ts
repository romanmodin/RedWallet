// @vitest-environment node
/**
 * Current-change regression coverage for the build-time CSP guard added in
 * `src/frontend/vite.config.js`.
 *
 * The guard (`assert-csp-first-in-head`, `enforce: "post"`, `transformIndexHtml`
 * with `order: "post"`) asserts that the emitted `dist/index.html` carries the
 * restrictive Content-Security-Policy meta as the first element inside `<head>`,
 * before any script, stylesheet, or other resource reference. It asserts only;
 * it never rewrites or reorders the policy.
 *
 * This file runs under the Node environment (the docblock overrides the
 * frontend script's `--environment jsdom`) because loading the real Vite config
 * pulls in esbuild, which requires Node's `TextEncoder`/`Uint8Array` invariant.
 * It exercises the guard's real handler against the real app shell and two
 * negative fixtures.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Vitest runs with cwd = `app/src/frontend`. */
const FRONTEND_ROOT = resolve(process.cwd());
const INDEX_HTML = join(FRONTEND_ROOT, "index.html");

interface GuardPlugin {
  name?: string;
  transformIndexHtml?: {
    order?: string;
    handler?: (html: string) => string;
  };
}

/**
 * Load the real Vite config and return its `assert-csp-first-in-head`
 * transform handler. The config is a `.js` file outside the TS project, so it
 * is imported through a runtime path to avoid static module resolution.
 */
async function loadGuardHandler(): Promise<(html: string) => string> {
  const configPath = join(FRONTEND_ROOT, "vite.config.js");
  const mod = (await import(/* @vite-ignore */ configPath)) as {
    default: { plugins?: GuardPlugin[] };
  };
  const plugin = (mod.default.plugins ?? []).find(
    (candidate) => candidate.name === "assert-csp-first-in-head",
  );
  expect(plugin, "guard plugin missing from vite.config.js").toBeDefined();
  const handler = plugin?.transformIndexHtml?.handler;
  expect(typeof handler, "guard handler missing").toBe("function");
  return handler as (html: string) => string;
}

describe("Build-time CSP guard", () => {
  it("accepts the real app shell", async () => {
    const handler = await loadGuardHandler();
    const html = readFileSync(INDEX_HTML, "utf8");
    expect(() => handler(html)).not.toThrow();
  });

  it("rejects a shell whose CSP meta is missing", async () => {
    const handler = await loadGuardHandler();
    const html = readFileSync(INDEX_HTML, "utf8").replace(
      /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i,
      "",
    );
    expect(() => handler(html)).toThrow(/csp-guard/i);
  });

  it("rejects a shell whose CSP meta is not first in <head>", async () => {
    const handler = await loadGuardHandler();
    // Move the charset meta ahead of the CSP meta so the policy is no longer
    // the first head element.
    const html = readFileSync(INDEX_HTML, "utf8").replace(
      /(<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>)(\s*<meta\s+charset="UTF-8"\s*\/>)/i,
      "$2$1",
    );
    expect(() => handler(html)).toThrow(/csp-guard/i);
  });
});

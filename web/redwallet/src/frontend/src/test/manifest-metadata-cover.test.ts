// @vitest-environment node
/**
 * Current-change regression coverage for the corrected public PWA manifest
 * metadata.
 *
 * The CSP hardening revision corrected `public/manifest.webmanifest` so its
 * `description` accurately describes the watch-only, read-only posture instead
 * of the earlier demo-only wording. The manifest is a static asset copied
 * verbatim into `dist/`, so this file reads the shipped source rather than
 * mounting a component.
 *
 * These tests pin the accepted shape of that correction:
 *
 *  - the manifest description is watch-only/read-only and carries no demo-only
 *    wording;
 *  - the structural fields (name, start_url, scope, display, colors, icons)
 *    are unchanged, so the correction did not disturb installability;
 *  - the app shell still references the manifest, so the corrected metadata is
 *    actually reachable.
 *
 * The CSP element, the build-time guard, and the watch-only journeys are
 * covered by the sibling `csp-hardening-cover.test.tsx` and
 * `csp-guard-cover.test.ts`; this file deliberately does not duplicate them.
 *
 * The Node environment is used because this is a pure static-file scan with no
 * DOM interaction; the docblock overrides the frontend script's jsdom default.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Vitest runs with cwd = `app/src/frontend`. */
const FRONTEND_ROOT = resolve(process.cwd());
const MANIFEST = join(FRONTEND_ROOT, "public", "manifest.webmanifest");
const INDEX_HTML = join(FRONTEND_ROOT, "index.html");

interface WebManifest {
  name?: string;
  short_name?: string;
  description?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  icons?: Array<{
    src?: string;
    sizes?: string;
    type?: string;
    purpose?: string;
  }>;
}

function readManifest(): WebManifest {
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as WebManifest;
}

describe("Public manifest metadata description", () => {
  it("describes the preview and local encrypted wallet posture", () => {
    const description = readManifest().description;
    expect(description, "no manifest description").toBeTruthy();
    expect(description ?? "").toMatch(/watch-only/i);
    expect(description ?? "").toMatch(/0\.36 preview/i);
    expect(description ?? "").toMatch(/local encrypted native SegWit wallets/i);
  });

  it("contains no demo-only wording", () => {
    const description = readManifest().description ?? "";
    expect(description).not.toMatch(/demo[- ]only/i);
    expect(description).not.toMatch(/\bdemo\b/i);
  });

  it("keeps the structural installability fields unchanged", () => {
    const manifest = readManifest();
    expect(manifest.name).toBe("RedWallet");
    expect(manifest.short_name).toBe("RedWallet");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#141013");
    expect(manifest.theme_color).toBe("#141013");
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
    for (const icon of manifest.icons ?? []) {
      expect(icon.src, "icon without src").toBeTruthy();
      expect(icon.src ?? "", `remote icon: ${icon.src}`).not.toMatch(
        /^https?:\/\//i,
      );
    }
  });

  it("is referenced from the app shell so the corrected metadata is reachable", () => {
    const html = readFileSync(INDEX_HTML, "utf8");
    expect(html).toMatch(
      /<link\b[^>]*rel\s*=\s*["']manifest["'][^>]*href\s*=\s*["']\/manifest\.webmanifest["']/i,
    );
  });
});

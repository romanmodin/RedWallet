/** Exact client-surface allowlist for local wallet integration.
 * Key ownership stays in LocalVaultPanel/LocalWalletWorkspace. The navigation
 * context holds authenticated public data only; overview reads validated public
 * caches/receipts. Send and Receive mount the existing CSP-gated workspace.
 * Backend, bridge and service imports remain prohibited.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Vitest runs with cwd = `app/src/frontend`. */
const FRONTEND_SRC = resolve(process.cwd(), "src");
const APP_ROOT = resolve(process.cwd(), "..", "..");
const XBT_DIR = join(FRONTEND_SRC, "lib", "xbt");

/** The reviewed foundation modules and their public entry points. */
const XBT_MODULES = [
  "key-material",
  "vault",
  "vault-controller",
  "spend-plan",
  "discovery",
  "discovery-session",
  "vault-catalog",
  "spend-review",
  "issued-addresses",
  "account-reader",
] as const;

/** This scan file itself contains sample import strings and is not production. */
const SELF = fileURLToPath(import.meta.url);

/** Files allowed to import the xbt modules: their own tests and harness. */
function isPermittedImporter(file: string): boolean {
  if (file === SELF) return true;
  const rel = relative(FRONTEND_SRC, file).split("\\").join("/");
  if (rel.startsWith("lib/xbt/")) return true;
  // Authorized full-wallet preparation: this client-only form is deliberately
  // not mounted. The next invariant prevents it entering any production route
  // before the deployed CSP and subsequent integration review are complete.
  if (
    [
      "components/vault/LocalVaultPanel.tsx",
      "components/vault/LocalWalletWorkspace.tsx",
      "components/vault/LocalAccountContext.tsx",
      "components/vault/LocalAccountOverview.tsx",
      "components/vault/AccountReadPanel.tsx",
      "components/vault/SendPaymentPanel.tsx",
      "components/vault/WalletCompatibilityCheck.tsx",
    ].includes(rel)
  )
    return true;
  return false;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|mo)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * True when a source line imports one of the xbt modules, whether by relative
 * path (`./key-material`, `../lib/xbt/vault`) or by the `@/lib/xbt/...` alias.
 *
 * Handles both single-line imports and the continuation line of a multi-line
 * import (`} from "./spend-plan";`), which is why the check does not require
 * the line to begin with `import`/`export`.
 */
function importsXbtModule(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
  if (/@\/lib\/xbt\//.test(line)) return true;
  if (/lib\/xbt\//.test(line)) return true;
  return XBT_MODULES.some((name) =>
    new RegExp(`["'][^"']*(?:^|/|\\.)${name}(?:\\.js)?["']`).test(line),
  );
}

describe("XBT foundation isolation", () => {
  it("exposes local vault components only through the explicitly gated workspace", () => {
    const offenders: string[] = [];
    for (const file of walk(FRONTEND_SRC)) {
      const rel = relative(FRONTEND_SRC, file).split("\\").join("/");
      if (rel.startsWith("lib/xbt/") || file === SELF) continue;
      const source = readFileSync(file, "utf8");
      if (
        /(?:from\s*|import\s*\()["'][^"']*(?:LocalVaultPanel|AccountReadPanel|SendPaymentPanel|WalletCompatibilityCheck)/.test(
          source,
        ) &&
        rel !== "components/vault/LocalWalletWorkspace.tsx"
      )
        offenders.push(rel);
      if (
        /(?:from\s*|import\s*\()["'][^"']*LocalWalletWorkspace/.test(source) &&
        ![
          "pages/WalletsPage.tsx",
          "pages/SendPage.tsx",
          "pages/ReceivePage.tsx",
        ].includes(rel)
      )
        offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
  it("keeps key imports in the exact approved client workspace, never backend or services", () => {
    const offenders: string[] = [];
    const scanned = new Set<string>();

    for (const file of walk(FRONTEND_SRC)) {
      if (isPermittedImporter(file)) continue;
      scanned.add(relative(APP_ROOT, file).split("\\").join("/"));
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (importsXbtModule(line)) {
          offenders.push(`${relative(APP_ROOT, file)}: ${line.trim()}`);
        }
      }
    }

    // The backend and bridge are separate packages; scan them too so a future
    // cross-package import cannot slip past the frontend-only walk.
    for (const pkg of ["src/backend", "src/bridge"]) {
      const dir = join(APP_ROOT, pkg);
      let files: string[] = [];
      try {
        files = walk(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        scanned.add(relative(APP_ROOT, file).split("\\").join("/"));
        const source = readFileSync(file, "utf8");
        for (const line of source.split("\n")) {
          if (importsXbtModule(line)) {
            offenders.push(`${relative(APP_ROOT, file)}: ${line.trim()}`);
          }
        }
      }
    }

    // Non-vacuity: the walk must actually have reached the production surfaces
    // the requirement names, or a broken walk would pass this test silently.
    for (const required of [
      "src/frontend/src/App.tsx",
      "src/frontend/src/pages/DashboardPage.tsx",
      "src/frontend/src/services/walletService.ts",
      "src/frontend/src/components/layout/AppShell.tsx",
    ]) {
      expect(scanned.has(required), `scan missed ${required}`).toBe(true);
    }
    expect(
      [...scanned].some((f) => f.startsWith("src/backend/")),
      "scan missed the backend package",
    ).toBe(true);
    expect(
      [...scanned].some((f) => f.startsWith("src/bridge/")),
      "scan missed the bridge package",
    ).toBe(true);

    expect(offenders).toEqual([]);
  });

  it("keeps the four foundation modules present under src/lib/xbt", () => {
    for (const name of XBT_MODULES) {
      const file = join(XBT_DIR, `${name}.ts`);
      expect(statSync(file).isFile()).toBe(true);
    }
  });

  it("detects the import forms the scan must catch", () => {
    // Non-vacuous detector: every real import form is flagged, and unrelated
    // identifiers or lookalike module names are not.
    for (const line of [
      'import { XbtKeySession } from "./key-material";',
      'import { VaultController } from "./vault-controller";',
      'import { openVault } from "./vault";',
      '} from "./spend-plan";',
      'import { X } from "@/lib/xbt/vault";',
      'import { X } from "../lib/xbt/key-material";',
      'import { X } from "./vault.js";',
    ]) {
      expect(importsXbtModule(line), line).toBe(true);
    }
    for (const line of [
      'import { X } from "./vaulty";',
      'import { X } from "./key-material-extra";',
      'import { X } from "@/services/walletService";',
      "const vault = 1;",
    ]) {
      expect(importsXbtModule(line), line).toBe(false);
    }
  });
});

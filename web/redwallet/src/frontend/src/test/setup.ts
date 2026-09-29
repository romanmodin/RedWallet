/**
 * Shared Vitest setup for the RedWallet frontend suite.
 *
 * - Registers jest-dom matchers for semantic assertions.
 * - Points Testing Library's `getByTestId` at the app's `data-ocid`
 *   convention so generated components can be queried by their stable marker
 *   when no semantic selector exists.
 * - Provides a deterministic `matchMedia` and `navigator.onLine` baseline so
 *   theme and offline logic behave predictably in jsdom.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/** Minimal `matchMedia` stub; jsdom does not implement it. */
function installMatchMedia(matches = false): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * The DOM baseline only applies under jsdom. A test file that opts into the
 * Node environment (for example to load the Vite config, which pulls in
 * esbuild) shares this setup module but has no `window`; those hooks must be
 * skipped rather than crash the file at collection time.
 */
const hasDom = typeof window !== "undefined";

beforeEach(() => {
  if (!hasDom) return;
  installMatchMedia(false);
  // jsdom does not implement scrollTo; the router's scroll restoration calls it.
  Object.defineProperty(window, "scrollTo", {
    writable: true,
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
  // The app's router is a module-level singleton, so its location survives
  // between tests. Reset the URL and notify the router before each test.
  window.history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.localStorage.clear();
  // Route tests start after onboarding; the splash has its own first-launch tests.
  if (expect.getState().testPath?.includes("/src/test/")) {
    window.localStorage.setItem("redwallet.intro.seen", "1");
  }
});

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  window.localStorage.clear();
});

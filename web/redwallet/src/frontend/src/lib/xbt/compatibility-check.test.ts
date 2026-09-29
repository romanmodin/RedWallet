import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { checkWalletCompatibility } from "./compatibility-check";
afterEach(() => vi.unstubAllGlobals());
it("runs the node-accepted public signature fixture plus encrypted recovery without storage or network", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const fetch = vi.fn(() => {
    throw Error("Network prohibited");
  });
  vi.stubGlobal("fetch", fetch);
  const saved = localStorage.length;
  expect(await checkWalletCompatibility()).toContain("self-test passed");
  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(saved);
});

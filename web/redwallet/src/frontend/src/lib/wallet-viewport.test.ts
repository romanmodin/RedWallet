import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreWalletViewport } from "./wallet-viewport";

const safari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const original = "width=device-width, initial-scale=1.0, viewport-fit=cover";

function setup(ua = safari, scale = 1.2) {
  vi.useFakeTimers();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  vi.stubGlobal("visualViewport", { scale });
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = original;
  document.head.append(viewport);
  return viewport;
}

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const el of document.querySelectorAll('meta[name="viewport"]')) {
    el.remove();
  }
});

describe("wallet password viewport recovery", () => {
  it("temporarily requests normal scale on zoomed iPhone Safari and restores pinch settings", () => {
    const viewport = setup();
    restoreWalletViewport();
    expect(viewport.content).toContain("maximum-scale=1");
    expect(viewport.content).toContain("viewport-fit=cover");
    expect(viewport.content).not.toContain("user-scalable=no");
    vi.advanceTimersByTime(350);
    expect(viewport.content).toBe(original);
  });

  it.each([
    [safari, 1],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36", 1.2],
    ["Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148", 1.2],
  ])("leaves unzoomed Safari and other browsers unchanged: %s", (ua, scale) => {
    const viewport = setup(ua, scale);
    restoreWalletViewport();
    expect(viewport.content).toBe(original);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overwrite a viewport setting changed during recovery", () => {
    const viewport = setup();
    restoreWalletViewport();
    viewport.content = "width=device-width, initial-scale=2";
    vi.advanceTimersByTime(350);
    expect(viewport.content).toBe("width=device-width, initial-scale=2");
  });
});

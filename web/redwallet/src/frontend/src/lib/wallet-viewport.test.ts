import { afterEach, describe, expect, it, vi } from "vitest";
import { preventWalletFocusZoom } from "./wallet-viewport";

const safari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1";
const original = "width=device-width, initial-scale=1.0, viewport-fit=cover";

function setup(ua = safari) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = original;
  document.head.append(viewport);
  return viewport;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const el of document.querySelectorAll('meta[name="viewport"]')) {
    el.remove();
  }
});

describe("wallet password focus zoom prevention", () => {
  it("guards Safari before focus without needing an already zoomed visual viewport", () => {
    const viewport = setup();
    const release = preventWalletFocusZoom();
    expect(viewport.content).toContain("maximum-scale=1");
    expect(viewport.content).toContain("viewport-fit=cover");
    expect(viewport.content).toContain("initial-scale=1.0");
    expect(viewport.content).not.toContain("minimum-scale");
    expect(viewport.content).not.toContain("user-scalable=no");
    release?.();
    expect(viewport.content).toBe(original);
  });

  it.each([
    "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148",
    "Mozilla/5.0 (Macintosh) Version/26.0 Safari/605.1.15",
  ])("leaves other browsers unchanged: %s", (ua) => {
    const viewport = setup(ua);
    expect(preventWalletFocusZoom()).toBeUndefined();
    expect(viewport.content).toBe(original);
  });

  it("does not overwrite a viewport setting changed during unlock", () => {
    const viewport = setup();
    const release = preventWalletFocusZoom();
    viewport.content = "width=device-width, initial-scale=2";
    release?.();
    expect(viewport.content).toBe("width=device-width, initial-scale=2");
  });

  it("replaces a previous maximum only during unlock and restores it exactly", () => {
    const viewport = setup();
    viewport.content = `${original}, maximum-scale=5`;
    const release = preventWalletFocusZoom();
    expect(viewport.content).not.toContain("maximum-scale=5");
    release?.();
    expect(viewport.content).toBe(`${original}, maximum-scale=5`);
  });
});

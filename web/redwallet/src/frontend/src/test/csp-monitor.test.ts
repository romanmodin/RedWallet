// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("browser CSP observation", () => {
  it("records only the native enforced analytics script block", () => {
    const root = { dataset: {} as Record<string, string> };
    let callback: (event: Record<string, unknown>) => void = () => {
      throw Error("missing listener");
    };
    runInNewContext(readFileSync(resolve("public/csp-monitor.js"), "utf8"), {
      document: {
        documentElement: root,
        addEventListener: (name: string, handler: typeof callback) => {
          expect(name).toBe("securitypolicyviolation");
          callback = handler;
        },
      },
    });
    const event = {
      isTrusted: true,
      disposition: "enforce",
      effectiveDirective: "script-src-elem",
      blockedURI: "https://cdn.caffeine.ai/scripts/umami-script.js",
    };
    expect(root.dataset.remoteScriptProtection).toBe("waiting");
    for (const change of [
      { isTrusted: false },
      { disposition: "report" },
      { effectiveDirective: "img-src" },
      { blockedURI: "https://example.org/other.js" },
    ]) {
      callback({ ...event, ...change });
      expect(root.dataset.remoteScriptProtection).toBe("waiting");
    }
    callback(event);
    expect(root.dataset.remoteScriptProtection).toBe("blocked");
  });
  it("loads the monitor after policy and before the app entry", () => {
    const html = readFileSync(resolve("index.html"), "utf8");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(
      html.indexOf('src="/csp-monitor.js"'),
    );
    expect(html.indexOf('src="/csp-monitor.js"')).toBeLessThan(
      html.indexOf('src="./src/main.tsx"'),
    );
  });
});

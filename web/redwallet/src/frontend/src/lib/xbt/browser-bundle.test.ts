import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

describe("XBT core browser bundle", () => {
  it("runs vectors, accepted transaction and synthetic signing without Node globals", () => {
    // esbuild's native Uint8Array invariant requires its own Node realm, not jsdom.
    const check = spawnSync(process.execPath, [resolve(process.cwd(), "src/lib/xbt/browser-bundle-check.mjs")], {
      encoding: "utf8", timeout: 25_000, maxBuffer: 1024 * 1024,
    });
    expect(check.error, check.stderr).toBeUndefined();
    expect(check.status, check.stderr).toBe(0);
    expect(JSON.parse(check.stdout)).toEqual({ vectors: 8, acceptedTxid: "6fef0e2039d1a0fb78981c845d30b4b90560514bb892ebd6b1f86292ee8769c7", signedSighash: 0x21 });
  }, 30_000);
});

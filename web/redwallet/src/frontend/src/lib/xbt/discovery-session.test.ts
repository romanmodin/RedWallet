import { describe, expect, it, vi } from "vitest";
import { DiscoverySession } from "./discovery-session";
import { XbtKeySession } from "./key-material";

const keys = new XbtKeySession(
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
);
const xpub = keys.account.accountXpub;
keys.destroy();
function time() {
  let now = 0;
  return {
    clock: () => now,
    wait: vi.fn(async (ms: number) => {
      now += ms;
    }),
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe("paced recovery session", () => {
  it("resumes successful observations after an error without calling the failure unused", async () => {
    const t = time();
    let fail = true;
    const probe = vi.fn(async () => {
      if (probe.mock.calls.length === 4 && fail)
        throw Error("network unavailable");
      return false;
    });
    const session = new DiscoverySession(xpub, probe, {}, t.clock, t.wait);
    await expect(session.run()).rejects.toThrow("network unavailable");
    expect(session.checked).toBe(3);
    fail = false;
    const progress = vi.fn();
    const result = await session.run(undefined, progress);
    expect(result.map((b) => b.scanned)).toEqual([20, 20]);
    expect(probe).toHaveBeenCalledTimes(41);
    expect(progress.mock.calls.at(-1)?.[0]).toEqual({ checked: 40, reused: 3 });
    expect(t.wait.mock.calls.every(([ms]) => ms === 3500)).toBe(true);
    await expect(session.run()).rejects.toThrow("new session");
  });
  it("holds one active run until an aborted in-flight probe settles and discards late results", async () => {
    const t = time();
    const controller = new AbortController();
    let release!: (value: boolean) => void;
    const probe = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const session = new DiscoverySession(xpub, probe, {}, t.clock, t.wait);
    const pending = session.run(controller.signal);
    controller.abort();
    await expect(session.run()).rejects.toThrow("already running");
    release(false);
    await expect(pending).rejects.toThrow("cancelled");
    expect(session.checked).toBe(0);
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it("does not start another probe when cancellation happens during pacing", async () => {
    const t = time();
    const controller = new AbortController();
    const probe = vi.fn(async () => false);
    const wait = async () => {
      controller.abort();
    };
    const session = new DiscoverySession(xpub, probe, {}, t.clock, wait);
    await expect(session.run(controller.signal)).rejects.toThrow("cancelled");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(session.checked).toBe(1);
  });
  it("expires cached observations after a long pause and rejects malformed history results", async () => {
    const t = time();
    let valid = false;
    const probe = vi.fn(async () =>
      probe.mock.calls.length === 2 && !valid
        ? (undefined as unknown as boolean)
        : false,
    );
    const session = new DiscoverySession(xpub, probe, {}, t.clock, t.wait);
    await expect(session.run()).rejects.toThrow("Invalid history");
    expect(session.checked).toBe(1);
    t.advance(300001);
    valid = true;
    await session.run();
    expect(probe).toHaveBeenCalledTimes(42);
  });
});

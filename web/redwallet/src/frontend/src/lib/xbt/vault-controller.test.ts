import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultController } from "./vault-controller";
const phrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const password = "public fixture vault password";
const cryptoApi = webcrypto as unknown as Crypto;
const key = "redwallet.vault.v1.test";
const WINDOW_MS = 5 * 60_000;
afterEach(() => vi.useRealTimers());
describe("encrypted vault persistence and lock lifecycle", () => {
  it("persists only ciphertext, refuses overwrite, and leaves failed writes locked", async () => {
    const c = new VaultController(key, localStorage, cryptoApi);
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    expect(localStorage.getItem(key)).not.toContain(phrase);
    expect(c.locked).toBe(true);
    await expect(
      c.create({ mnemonic: phrase, passphrase: "" }, password),
    ).rejects.toThrow("exists");
    const full = new VaultController(
      "redwallet.vault.v1.full",
      {
        getItem: () => null,
        setItem: () => {
          throw Error("Quota exceeded");
        },
      },
      cryptoApi,
    );
    await expect(
      full.create({ mnemonic: phrase, passphrase: "" }, password),
    ).rejects.toThrow("Quota");
    expect(full.locked).toBe(true);
  });
  it("does not reopen after lock while password derivation is pending", async () => {
    const c = new VaultController(key, localStorage, cryptoApi);
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    const pending = c.unlock(password);
    c.lock();
    await expect(pending).rejects.toThrow("cancelled");
    expect(c.locked).toBe(true);
  });
  it("locks on page hide and refuses signing through retained session references", async () => {
    const c = new VaultController(key, localStorage, cryptoApi);
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    await c.unlock(password);
    const session = c.withUnlocked((keys) => keys);
    const detach = c.attachLifecycle(window, document);
    window.dispatchEvent(new Event("pagehide"));
    expect(c.locked).toBe(true);
    expect(session.locked).toBe(true);
    expect(() => c.withUnlocked(() => true)).toThrow("locked");
    detach();
  });
  it("locks after five minutes and on cross-tab vault replacement", async () => {
    const c = new VaultController(key, localStorage, cryptoApi);
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    vi.useFakeTimers();
    await c.unlock(password);
    vi.advanceTimersByTime(300000);
    expect(c.locked).toBe(true);
    await c.unlock(password);
    const detach = c.attachLifecycle(window, document);
    window.dispatchEvent(new StorageEvent("storage", { key }));
    expect(c.locked).toBe(true);
    detach();
  });
  it("locks at the deadline even when the timer fires late", async () => {
    let wall = 1_000_000;
    let mono = 500;
    const c = new VaultController(
      key,
      localStorage,
      cryptoApi,
      () => wall,
      () => mono,
    );
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    vi.useFakeTimers();
    await c.unlock(password);
    // The wall clock and monotonic clock advance past the deadline, but the
    // scheduled timer never runs (a throttled or delayed timer).
    wall += WINDOW_MS + 1;
    mono += WINDOW_MS + 1;
    expect(c.locked).toBe(true);
    expect(() => c.withUnlocked(() => true)).toThrow("locked");
  });
  it("does not extend the session when the wall clock moves backwards", async () => {
    let wall = 1_000_000;
    let mono = 500;
    const c = new VaultController(
      key,
      localStorage,
      cryptoApi,
      () => wall,
      () => mono,
    );
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    vi.useFakeTimers();
    await c.unlock(password);
    // A backwards wall-clock adjustment would push the wall deadline far into
    // the future, but the monotonic deadline still governs.
    wall -= WINDOW_MS * 10;
    mono += WINDOW_MS + 1;
    expect(c.locked).toBe(true);
    expect(() => c.withUnlocked(() => true)).toThrow("locked");
  });
  it("expires on the monotonic deadline even if the wall clock is moved backwards", async () => {
    let wall = 1_000_000;
    let mono = 500;
    const c = new VaultController(
      key,
      localStorage,
      cryptoApi,
      () => wall,
      () => mono,
    );
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    vi.useFakeTimers();
    await c.unlock(password);
    expect(c.withUnlocked(() => "ok")).toBe("ok");
    // Wall clock jumps backwards before the deadline; monotonic time crosses it.
    wall -= WINDOW_MS * 10;
    mono += WINDOW_MS;
    expect(c.locked).toBe(true);
    expect(() => c.withUnlocked(() => true)).toThrow("locked");
  });
  it("preserves normal unlock and lock behavior within the window", async () => {
    let wall = 1_000_000;
    let mono = 500;
    const c = new VaultController(
      key,
      localStorage,
      cryptoApi,
      () => wall,
      () => mono,
    );
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    vi.useFakeTimers();
    await c.unlock(password);
    expect(c.locked).toBe(false);
    expect(c.withUnlocked(() => "ok")).toBe("ok");
    wall += WINDOW_MS - 1;
    mono += WINDOW_MS - 1;
    expect(c.locked).toBe(false);
    expect(c.withUnlocked(() => "still ok")).toBe("still ok");
    c.lock();
    expect(c.locked).toBe(true);
    expect(() => c.withUnlocked(() => true)).toThrow("locked");
  });
});

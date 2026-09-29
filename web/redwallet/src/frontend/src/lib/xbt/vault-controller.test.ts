import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultController } from "./vault-controller";
const phrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const password = "public fixture vault password";
const cryptoApi = webcrypto as unknown as Crypto;
const key = "redwallet.vault.v1.test";
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
  it("expires at access time even if the browser has not delivered its timer", async () => {
    const c = new VaultController(key, localStorage, cryptoApi);
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    await c.unlock(password);
    const retained = c.withUnlocked((keys) => keys);
    // Fake Date only: the real timeout callback has not run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 300001);
    expect(() => c.withUnlocked(() => true)).toThrow("locked");
    expect(retained.locked).toBe(true);
  });
  it("does not extend the unlock lease when the wall clock moves backwards", async () => {
    const c = new VaultController(key, localStorage, cryptoApi);
    await c.create({ mnemonic: phrase, passphrase: "" }, password);
    await c.unlock(password);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 3600000);
    const clock = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 300001);
    try {
      expect(c.locked).toBe(true);
      expect(() => c.withUnlocked(() => true)).toThrow("locked");
    } finally {
      clock.mockRestore();
      c.lock();
    }
  });
});

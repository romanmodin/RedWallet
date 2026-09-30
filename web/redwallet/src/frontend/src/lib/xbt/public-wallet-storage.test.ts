import type { BridgeActor } from "@/services/bridgeService";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountSnapshot } from "./account-reader";
import { accountViewSession } from "./account-view-session";
import { XbtKeySession, publicAddress } from "./key-material";
import {
  loadPaymentDraft,
  loadPublicSnapshot,
  publicStorageKey,
  savePaymentDraft,
  savePublicSnapshot,
} from "./public-wallet-storage";
afterEach(() => localStorage.clear());
function fixture() {
  const keys = new XbtKeySession(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  const xpub = keys.account.accountXpub;
  keys.destroy();
  const snapshot: AccountSnapshot = {
    branches: [0, 1].map((b) => ({
      used: [],
      next: {
        branch: b,
        index: b === 0 ? 1 : 0,
        address: publicAddress(xpub, b as 0 | 1, b === 0 ? 1 : 0),
      },
      scanned: b === 0 ? 21 : 20,
    })) as unknown as AccountSnapshot["branches"],
    confirmed: 0n,
    unconfirmed: 0n,
    history: [],
    height: 974789,
    observedAt: 1790740800000,
  };
  return { xpub, snapshot };
}
describe("durable public account observations", () => {
  it("restores after new actor/session with original time and bigint values", () => {
    const f = fixture();
    savePublicSnapshot(f.xpub, f.snapshot);
    const restored = accountViewSession({} as BridgeActor, f.xpub);
    expect(restored.snapshot).toEqual(f.snapshot);
    expect(restored.checked).toBe(41);
    expect(loadPublicSnapshot("another-account")).toBeNull();
  });
  it("rejects corrupted JSON, substituted address, out-of-bounds and oversized caches", () => {
    const f = fixture();
    const key = publicStorageKey(f.xpub, "scan");
    localStorage.setItem(key, "invalid");
    expect(loadPublicSnapshot(f.xpub)).toBeNull();
    savePublicSnapshot(f.xpub, f.snapshot);
    const raw = JSON.parse(localStorage.getItem(key)!);
    raw.branches[0].next.address = publicAddress(f.xpub, 0, 8);
    localStorage.setItem(key, JSON.stringify(raw));
    expect(loadPublicSnapshot(f.xpub)).toBeNull();
    raw.branches[0].next.index = 2147483648;
    localStorage.setItem(key, JSON.stringify(raw));
    expect(loadPublicSnapshot(f.xpub)).toBeNull();
    localStorage.setItem(key, "x".repeat(2000001));
    expect(loadPublicSnapshot(f.xpub)).toBeNull();
  });
  it("restores only unsigned draft fields, never acknowledgments or review", () => {
    const f = fixture();
    savePaymentDraft(f.xpub, {
      destination: "bc1qexample",
      amount: "0.005",
      rate: "1",
    });
    expect(loadPaymentDraft(f.xpub)).toEqual({
      destination: "bc1qexample",
      amount: "0.005",
      rate: "1",
    });
    expect(loadPaymentDraft("other").destination).toBe("");
  });
});

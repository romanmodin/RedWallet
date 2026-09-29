import { describe, expect, it } from "vitest";
import { type AddressMutex, IssuedAddresses } from "./issued-addresses";
import { XbtKeySession, publicAddress } from "./key-material";

const phrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
function fixture() {
  const keys = new XbtKeySession(phrase);
  const xpub = keys.account.accountXpub;
  keys.destroy();
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  let tail: Promise<unknown> = Promise.resolve();
  const mutex: AddressMutex = (_name, action) => {
    const next = tail.then(action);
    tail = next.catch(() => {});
    return next;
  };
  return { xpub, map, storage, mutex };
}
describe("durable public address reservations", () => {
  it("serializes two tabs and reserves before exposing derived addresses", async () => {
    const f = fixture();
    const a = new IssuedAddresses(f.xpub, f.storage, f.mutex);
    const b = new IssuedAddresses(f.xpub, f.storage, f.mutex);
    const result = await Promise.all([a.reserve(0, 0), b.reserve(0, 0)]);
    expect(result.map((r) => r.index)).toEqual([1, 2]);
    expect(a.read()).toEqual([2, -1]);
    expect(result[1].address).toBe(publicAddress(f.xpub, 0, 2));
    expect([...f.map.values()]).toEqual(["[2,-1]"]);
  });
  it("fails closed on write/readback damage and cancellation", async () => {
    const f = fixture();
    const broken = new IssuedAddresses(
      f.xpub,
      { ...f.storage, setItem: () => {} },
      f.mutex,
    );
    await expect(broken.reserve(1, 0)).rejects.toThrow(/verify/);
    const a = new IssuedAddresses(f.xpub, f.storage, f.mutex);
    const signal = AbortSignal.abort();
    await expect(a.reserve(0, 0, signal)).rejects.toThrow(/cancelled/);
    expect(f.map.size).toBe(0);
    await a.reserve(1, 4);
    const key = [...f.map.keys()][0];
    f.map.set(key, "[0,2000]");
    expect(() => a.read()).toThrow(/bounds/);
    await expect(a.reserve(1, 5)).rejects.toThrow(/bounds/);
  });
  it("never takes an address from storage and rejects malformed account scopes", async () => {
    const f = fixture();
    const a = new IssuedAddresses(f.xpub, f.storage, f.mutex);
    await expect(a.reserve(1, 8)).resolves.toMatchObject({
      index: 8,
      address: publicAddress(f.xpub, 1, 8),
    });
    expect(
      () => new IssuedAddresses("xpub-invalid", f.storage, f.mutex),
    ).toThrow();
  });
});

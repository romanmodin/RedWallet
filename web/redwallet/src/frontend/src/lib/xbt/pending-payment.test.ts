import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { XbtKeySession } from "./key-material";
import { PendingPayments, validatePendingPayment } from "./pending-payment";
import { SpendReview } from "./spend-review";
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../test/regtest/xbt-web-signed-20260929.json"),
    "utf8",
  ),
);
function setup() {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (k: string) => {
      data.delete(k);
    },
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const mutex = async <T>(_name: string, fn: () => Promise<T>) => await fn();
  return {
    data,
    storage,
    store: new PendingPayments(fixture.plan.accountXpub, storage, mutex),
  };
}
async function save(store: PendingPayments) {
  const keys = new XbtKeySession(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  const review = new SpendReview(fixture.plan);
  try {
    return await store.signAndSave(review.plan, () => review.sign(keys));
  } finally {
    keys.destroy();
  }
}
describe("durable signed payment", () => {
  it("round-trips the node-accepted exact XBT transaction without secret material", async () => {
    const f = setup();
    const p = await save(f.store);
    expect(p.hex).toBe(fixture.hex);
    expect(f.store.read()).toEqual(p);
    expect([...f.data.values()].join("")).not.toContain("abandon");
    expect((await f.store.mark(p.txid, "unknown")).hex).toBe(p.hex);
    const signer = vi.fn();
    await expect(f.store.signAndSave(fixture.plan, signer)).rejects.toThrow(
      /existing/,
    );
    expect(signer).not.toHaveBeenCalled();
  });
  it("rejects altered values, destination, account and stripped replay protection", async () => {
    const f = setup();
    const p = await save(f.store);
    const parse = (q: unknown) => () =>
      validatePendingPayment(JSON.stringify(q), p.accountXpub);
    expect(parse({ ...p, fee: "1" })).toThrow();
    expect(parse({ ...p, amount: "1" })).toThrow();
    expect(
      parse({ ...p, inputs: p.inputs.map((c) => ({ ...c, value: "1" })) }),
    ).toThrow(/signature/);
    expect(parse({ ...p, hex: fixture.bitcoinControlHex })).toThrow();
    expect(() => validatePendingPayment(JSON.stringify(p), "wrong")).toThrow();
  });
  it("fails closed on storage-write failure or corrupt existing record", async () => {
    const f = setup();
    f.storage.setItem = () => {
      throw Error("quota");
    };
    await expect(save(f.store)).rejects.toThrow("quota");
    f.data.set(f.store.key, "broken");
    const signer = vi.fn();
    await expect(f.store.signAndSave(fixture.plan, signer)).rejects.toThrow();
    expect(signer).not.toHaveBeenCalled();
  });
});

it("persists uncertainty before dispatch and never retries automatically", async () => {
  const f = setup();
  const p = await save(f.store);
  const send = vi.fn(async (hex: string, id: string) => {
    expect(f.store.read()?.state).toBe("unknown");
    expect(hex).toBe(p.hex);
    expect(id).toBe(p.txid);
    throw Error("lost reply");
  });
  expect((await f.store.submit(send)).state).toBe("unknown");
  expect(send).toHaveBeenCalledTimes(1);
  const ack = vi.fn(async () => ({ txid: p.txid, outcome: "acknowledged" }));
  expect((await f.store.submit(ack)).state).toBe("acknowledged");
  expect(ack).toHaveBeenCalledWith(p.hex, p.txid);
});
it("requires fresh confirmation and preserves an archive before allowing another payment", async () => {
  const f = setup();
  const p = await save(f.store);
  await f.store.mark(p.txid, "confirmed");
  const signer = vi.fn();
  await expect(f.store.signAndSave(fixture.plan, signer)).rejects.toThrow(
    /existing/,
  );
  await expect(f.store.archiveConfirmed(async () => false)).rejects.toThrow(
    /not confirmed/,
  );
  expect(f.store.read()?.txid).toBe(p.txid);
  await f.store.archiveConfirmed(async (current) => current.hex === p.hex);
  expect(f.store.read()).toBeNull();
  expect([...f.data.keys()]).toContain(`${f.store.key}.confirmed.${p.txid}`);
});

it("restores old confirmed archives, isolates accounts, and reports damaged receipts without hiding good ones", async () => {
  const f = setup();
  const p = await save(f.store);
  await f.store.archiveConfirmed(async () => true);
  const key = `${f.store.key}.confirmed.${p.txid}`;
  const original = f.data.get(key)!;
  expect(f.store.readConfirmed()).toEqual({
    payments: [{ ...p, state: "confirmed" }],
    incomplete: false,
  });
  f.data.set(`${f.store.key}.confirmed.${"a".repeat(64)}`, original);
  f.data.set(`${f.store.key}.confirmed.${"b".repeat(64)}`, "corrupt");
  f.data.set("redwallet.payment.v1.other.confirmed.unrelated", "unrelated");
  const reopened = new PendingPayments(p.accountXpub, f.storage);
  expect(reopened.readConfirmed().payments).toHaveLength(1);
  expect(reopened.readConfirmed().incomplete).toBe(true);
  expect(f.data.get(key)).toBe(original);
  expect(reopened.read()).toBeNull();
});

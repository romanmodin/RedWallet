import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type CatalogStorage, VaultCatalog } from "./vault-catalog";

const cryptoApi = webcrypto as unknown as Crypto;
const phrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const password = "public fixture catalog password";
function storage(
  failLabels = false,
): CatalogStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      if (failLabels && key.startsWith("redwallet.vault-label."))
        throw Error("quota");
      values.set(key, value);
    },
  };
}
describe("encrypted wallet inventory", () => {
  it("keeps a wallet discoverable if its second cosmetic write fails", async () => {
    const store = storage(true);
    const catalog = new VaultCatalog(store, cryptoApi);
    const created = await catalog.create(
      "Recovered wallet",
      { mnemonic: phrase, passphrase: "" },
      password,
    );
    expect(created.labelSaved).toBe(false);
    expect(catalog.list()).toEqual([
      {
        id: created.id,
        name: `Encrypted wallet ${created.id.slice(0, 8)}`,
        damaged: false,
      },
    ]);
    expect(catalog.controller(created.id).locked).toBe(true);
    const account = await catalog.controller(created.id).unlock(password);
    expect(account.firstAddress).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
    catalog.lockAll();
    expect(catalog.controller(created.id).locked).toBe(true);
    expect([...store.values.values()].join()).not.toContain(phrase);
    expect([...store.values.values()].join()).not.toContain(password);
  });
  it("lists damaged or tampered records without exposing unverified receiving metadata", async () => {
    const store = storage();
    const catalog = new VaultCatalog(store, cryptoApi);
    const { id } = await catalog.create(
      "Vault",
      { mnemonic: phrase, passphrase: "" },
      password,
    );
    const key = `redwallet.vault.v1.${id}`;
    const record = JSON.parse(store.getItem(key)!);
    record.firstAddress = `bc1q${"a".repeat(38)}`;
    store.setItem(key, JSON.stringify(record));
    expect(Object.keys(catalog.list()[0]!)).toEqual(["id", "name", "damaged"]);
    await expect(catalog.controller(id).unlock(password)).rejects.toThrow(
      "Could not unlock",
    );
    store.setItem(key, "damaged");
    expect(catalog.list()[0]!.damaged).toBe(true);
  });
  it("does not confuse unavailable storage with an empty wallet inventory", async () => {
    const store = storage();
    store.values.set("redwallet.vault.v1.test", "bad");
    store.getItem = () => {
      throw Error("Storage denied");
    };
    const catalog = new VaultCatalog(store, cryptoApi);
    expect(() => catalog.list()).toThrow("Storage denied");
    await expect(
      catalog.create("New", { mnemonic: phrase, passphrase: "" }, password),
    ).rejects.toThrow("Storage denied");
    expect(store.values.size).toBe(1);
  });
});

describe("individual vault removal", () => {
  it("locks the removed vault, preserves another encrypted copy and public indexes, and cancels pending unlock", async () => {
    const store = storage();
    const catalog = new VaultCatalog(store, cryptoApi);
    const a = await catalog.create(
      "A",
      { mnemonic: phrase, passphrase: "" },
      password,
    );
    const b = await catalog.create(
      "B",
      { mnemonic: phrase, passphrase: "" },
      password,
    );
    const other = store.getItem(`redwallet.vault.v1.${b.id}`);
    store.setItem("redwallet.issued.v1.public-test", "retained");
    const controller = catalog.controller(a.id);
    await controller.unlock(password);
    const pending = controller.unlock(password);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    catalog.remove(a.id);
    await rejected;
    expect(controller.locked).toBe(true);
    expect(catalog.list().map((v) => v.id)).toEqual([b.id]);
    expect(store.getItem(`redwallet.vault.v1.${b.id}`)).toBe(other);
    expect(store.getItem(`redwallet.vault-label.v1.${a.id}`)).toBeNull();
    expect(store.getItem("redwallet.issued.v1.public-test")).toBe("retained");
  });
  it("reports a refused deletion and keeps its encrypted copy discoverable", async () => {
    const store = storage();
    const catalog = new VaultCatalog(store, cryptoApi);
    const { id } = await catalog.create(
      "A",
      { mnemonic: phrase, passphrase: "" },
      password,
    );
    store.removeItem = () => {};
    expect(() => catalog.remove(id)).toThrow("could not be removed");
    expect(catalog.list()).toHaveLength(1);
    expect(() => catalog.remove("../other")).toThrow(
      "Invalid wallet identifier",
    );
  });
});

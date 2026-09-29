import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  XbtKeySession,
  generateRecoveryPhrase,
  mnemonicEntropy,
  normalizeMnemonic,
  publicAddress,
  xbtEcc,
} from "./key-material";
import { openVault, parseVault, sealVault } from "./vault";

// Published BIP84 vector, NEVER use for real funds.
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const PASSWORD = "public test password, never for funds";
const cryptoApi = webcrypto as unknown as Crypto;

describe("native-compatible browser key material", () => {
  it("matches published BIP84 receive/change vectors and derives from public-only account", () => {
    const keys = new XbtKeySession(MNEMONIC);
    expect(keys.account.firstAddress).toBe(ADDRESS);
    expect(publicAddress(keys.account.accountXpub, 0, 1)).toBe(
      "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
    );
    expect(publicAddress(keys.account.accountXpub, 1, 0)).toBe(
      "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
    );
    expect(() =>
      publicAddress(keys.account.accountXpub, 0, 0x80000000),
    ).toThrow();
    expect(() => publicAddress(keys.account.accountXpub, 2 as 0, 0)).toThrow();
    keys.destroy();
  });
  it("rejects checksum failures and normalizes spacing/case", () => {
    expect(
      normalizeMnemonic(`  ${MNEMONIC.toUpperCase().replaceAll(" ", "\n")}  `),
    ).toBe(MNEMONIC);
    expect(() =>
      normalizeMnemonic(MNEMONIC.replace("about", "abandon")),
    ).toThrow();
    expect(() => normalizeMnemonic("too short")).toThrow();
  });
  it("uses exactly 256 cryptographic entropy bits and never falls back after RNG failure", () => {
    let requested = 0;
    const mock = {
      getRandomValues: (a: Uint8Array) => {
        requested = a.length;
        a.fill(0);
        return a;
      },
    } as unknown as Crypto;
    const phrase = generateRecoveryPhrase(mock);
    expect(requested).toBe(32);
    expect(phrase.split(" ")).toHaveLength(24);
    expect(mnemonicEntropy(phrase)).toEqual(new Uint8Array(32));
    expect(() =>
      generateRecoveryPhrase({
        getRandomValues: () => {
          throw Error("Unavailable");
        },
      } as unknown as Crypto),
    ).toThrow("Unavailable");
  });
  it("normalizes BIP39 passphrase with NFKD and changes the account when present", () => {
    const a = new XbtKeySession(MNEMONIC, "\u00e9");
    const b = new XbtKeySession(MNEMONIC, "e\u0301");
    expect(a.account).toEqual(b.account);
    expect(a.account.firstAddress).not.toBe(ADDRESS);
    a.destroy();
    b.destroy();
  });
  it("signs without double hashing and refuses signing after lock", () => {
    const keys = new XbtKeySession(MNEMONIC);
    const digest = new Uint8Array(32).fill(7);
    const signed = keys.signDigest(0, 0, digest);
    expect(xbtEcc.verify(digest, signed.publicKey, signed.signature)).toBe(
      true,
    );
    expect(
      xbtEcc.verify(
        new Uint8Array(32).fill(8),
        signed.publicKey,
        signed.signature,
      ),
    ).toBe(false);
    keys.destroy();
    keys.destroy();
    expect(keys.locked).toBe(true);
    expect(() => keys.signDigest(0, 0, digest)).toThrow("locked");
  });
});

describe("authenticated encrypted vault", () => {
  it("round trips secrets, randomizes every envelope, and persists no plaintext", async () => {
    const secret = {
      mnemonic: MNEMONIC,
      passphrase: "public fixture passphrase",
    };
    const a = await sealVault(secret, PASSWORD, cryptoApi);
    const b = await sealVault(secret, PASSWORD, cryptoApi);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    const raw = JSON.stringify(a);
    expect(raw).not.toContain(MNEMONIC);
    expect(raw).not.toContain(secret.passphrase);
    expect(raw).not.toContain(PASSWORD);
    expect(await openVault(raw, PASSWORD, cryptoApi)).toEqual(secret);
  });
  it("rejects wrong passwords and modified ciphertext or authenticated public identity", async () => {
    const sealed = await sealVault(
      { mnemonic: MNEMONIC, passphrase: "" },
      PASSWORD,
      cryptoApi,
    );
    await expect(
      openVault(JSON.stringify(sealed), `${PASSWORD}!`, cryptoApi),
    ).rejects.toThrow("Could not unlock");
    for (const changed of [
      {
        ...sealed,
        ciphertext:
          (sealed.ciphertext.startsWith("00") ? "01" : "00") +
          sealed.ciphertext.slice(2),
      },
      { ...sealed, firstAddress: "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g" },
      { ...sealed, iv: "00".repeat(12) },
    ])
      await expect(
        openVault(JSON.stringify(changed), PASSWORD, cryptoApi),
      ).rejects.toThrow("Could not unlock");
  });
  it("rejects unsupported or excessive envelopes before expensive KDF work", async () => {
    const sealed = await sealVault(
      { mnemonic: MNEMONIC, passphrase: "" },
      PASSWORD,
      cryptoApi,
    );
    for (const changed of [
      { ...sealed, version: 2 },
      { ...sealed, iterations: 2_147_483_647 },
      { ...sealed, profile: "bitcoin" },
      { ...sealed, salt: "ff" },
      { ...sealed, unexpected: true },
      { ...sealed, ciphertext: "00".repeat(8193) },
    ])
      expect(() => parseVault(JSON.stringify(changed))).toThrow();
    expect(() => parseVault(" ".repeat(20001))).toThrow();
    await expect(
      sealVault({ mnemonic: MNEMONIC, passphrase: "" }, "short", cryptoApi),
    ).rejects.toThrow("12");
  });
});

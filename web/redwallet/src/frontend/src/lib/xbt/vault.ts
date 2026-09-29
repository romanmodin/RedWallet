/** Versioned encrypted browser vault primitive; intentionally not connected to UI. */
import { Buffer } from "buffer";
import {
  type PublicXbtAccount,
  XBT_KEY_PROFILE,
  XbtKeySession,
  normalizeMnemonic,
} from "./key-material";

const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export interface VaultEnvelope {
  version: 1;
  profile: typeof XBT_KEY_PROFILE;
  kdf: "PBKDF2-SHA256";
  iterations: typeof ITERATIONS;
  cipher: "AES-256-GCM";
  salt: string;
  iv: string;
  ciphertext: string;
  accountXpub: string;
  firstAddress: string;
}
export interface VaultSecrets {
  mnemonic: string;
  passphrase: string;
}
function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  )
    throw new Error("Use a password of 12–1024 characters");
  return encoder.encode(password);
}
function decodeHex(text: unknown, size?: number): Uint8Array<ArrayBuffer> {
  if (
    typeof text !== "string" ||
    !/^[0-9a-f]+$/.test(text) ||
    text.length % 2 ||
    text.length > 16_384 ||
    (size !== undefined && text.length !== size * 2)
  )
    throw new Error("Invalid vault encoding");
  return Uint8Array.from(Buffer.from(text, "hex"));
}
function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(
    bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
  ).toString("hex");
}
function aad(
  envelope: Omit<VaultEnvelope, "ciphertext">,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify([
      envelope.version,
      envelope.profile,
      envelope.kdf,
      envelope.iterations,
      envelope.cipher,
      envelope.salt,
      envelope.iv,
      envelope.accountXpub,
      envelope.firstAddress,
    ]),
  );
}
async function keyFor(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  cryptoApi: Crypto,
): Promise<CryptoKey> {
  const bytes = passwordBytes(password);
  try {
    const material = await cryptoApi.subtle.importKey(
      "raw",
      bytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await cryptoApi.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    bytes.fill(0);
  }
}
export function parseVault(raw: string): VaultEnvelope {
  if (typeof raw !== "string" || raw.length > 20_000)
    throw new Error("Invalid vault size");
  const value = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "accountXpub,cipher,ciphertext,firstAddress,iterations,iv,kdf,profile,salt,version"
  )
    throw new Error("Invalid vault schema");
  if (
    value.version !== 1 ||
    value.profile !== XBT_KEY_PROFILE ||
    value.kdf !== "PBKDF2-SHA256" ||
    value.iterations !== ITERATIONS ||
    value.cipher !== "AES-256-GCM"
  )
    throw new Error("Unsupported vault");
  decodeHex(value.salt, 16);
  decodeHex(value.iv, 12);
  const ciphertext = decodeHex(value.ciphertext);
  if (
    ciphertext.length < 17 ||
    ciphertext.length > 8192 ||
    typeof value.accountXpub !== "string" ||
    value.accountXpub.length !== 111 ||
    !value.accountXpub.startsWith("xpub") ||
    typeof value.firstAddress !== "string" ||
    value.firstAddress.length !== 42 ||
    !value.firstAddress.startsWith("bc1q")
  )
    throw new Error("Invalid vault fields");
  return value as VaultEnvelope;
}
export async function sealVault(
  secrets: VaultSecrets,
  password: string,
  cryptoApi: Crypto = globalThis.crypto,
): Promise<VaultEnvelope> {
  const mnemonic = normalizeMnemonic(secrets.mnemonic);
  if (
    typeof secrets.passphrase !== "string" ||
    secrets.passphrase.length > 1024
  )
    throw new Error("Invalid BIP39 passphrase");
  const passphrase = secrets.passphrase.normalize("NFKD");
  const session = new XbtKeySession(mnemonic, passphrase);
  const account: PublicXbtAccount = session.account;
  session.destroy();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const envelope: Omit<VaultEnvelope, "ciphertext"> = {
    version: 1,
    profile: XBT_KEY_PROFILE,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    cipher: "AES-256-GCM",
    salt: hex(salt),
    iv: hex(iv),
    accountXpub: account.accountXpub,
    firstAddress: account.firstAddress,
  };
  const plaintext = encoder.encode(JSON.stringify({ mnemonic, passphrase }));
  try {
    const key = await keyFor(password, salt, cryptoApi);
    const ciphertext = await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(envelope), tagLength: 128 },
      key,
      plaintext,
    );
    return { ...envelope, ciphertext: hex(ciphertext) };
  } finally {
    plaintext.fill(0);
  }
}
/** Authenticate before trusting any public metadata or returning secret material. */
export async function openVault(
  raw: string,
  password: string,
  cryptoApi: Crypto = globalThis.crypto,
): Promise<VaultSecrets> {
  const envelope = parseVault(raw);
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  let session: XbtKeySession | undefined;
  try {
    const key = await keyFor(password, decodeHex(envelope.salt, 16), cryptoApi);
    plaintext = new Uint8Array(
      await cryptoApi.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decodeHex(envelope.iv, 12),
          additionalData: aad(envelope),
          tagLength: 128,
        },
        key,
        decodeHex(envelope.ciphertext),
      ),
    );
    const secrets = JSON.parse(decoder.decode(plaintext));
    if (
      !secrets ||
      Object.keys(secrets).sort().join(",") !== "mnemonic,passphrase" ||
      typeof secrets.mnemonic !== "string" ||
      typeof secrets.passphrase !== "string"
    )
      throw new Error("Invalid payload");
    session = new XbtKeySession(secrets.mnemonic, secrets.passphrase);
    if (
      session.account.accountXpub !== envelope.accountXpub ||
      session.account.firstAddress !== envelope.firstAddress
    )
      throw new Error("Vault identity mismatch");
    return {
      mnemonic: normalizeMnemonic(secrets.mnemonic),
      passphrase: secrets.passphrase,
    };
  } catch {
    throw new Error("Could not unlock: incorrect password or damaged vault");
  } finally {
    plaintext?.fill(0);
    session?.destroy();
  }
}

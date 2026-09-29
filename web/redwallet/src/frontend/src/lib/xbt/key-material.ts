/** Browser BIP39/BIP84 key material. No network, storage, or UI access. */
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import * as secp from "@noble/secp256k1";
import { BIP32Factory, type TinySecp256k1Interface } from "bip32";
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { networks, payments } from "bitcoinjs-lib";

export const XBT_ACCOUNT_PATH = "m/84'/0'/0'";
export const XBT_KEY_PROFILE = "xbt-blake2b-bip84-account0-v1";
secp.hashes.sha256 = (message) => Uint8Array.from(sha256(message));
secp.hashes.hmacSha256 = (key, message) =>
  Uint8Array.from(hmac(sha256, key, message));
const n = secp.Point.CURVE().n;
function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
function tweakScalar(tweak: Uint8Array): bigint {
  if (tweak.length !== 32) throw new Error("Invalid tweak");
  const value = secp.etc.bytesToNumberBE(tweak);
  if (value >= n) throw new Error("Invalid tweak");
  return value;
}
/** Same noble versions/prehash policy as native RedWallet; zero tweaks are valid. */
export const xbtEcc: TinySecp256k1Interface = {
  isPoint: (p) =>
    (p.length === 33 || p.length === 65) &&
    attempt(() => secp.Point.fromBytes(p)) !== null,
  isPrivate: (d) => secp.utils.isValidSecretKey(d),
  pointFromScalar: (d, compressed = true) =>
    attempt(() => secp.getPublicKey(d, compressed)),
  pointAddScalar: (p, tweak, compressed = true) =>
    attempt(() => {
      const scalar = tweakScalar(tweak);
      const point = secp.Point.fromBytes(p);
      const result =
        scalar === 0n ? point : point.add(secp.Point.BASE.multiply(scalar));
      if (result.is0()) throw new Error("Point at infinity");
      return result.toBytes(compressed);
    }),
  privateAdd: (d, tweak) =>
    attempt(() => {
      const result = (secp.etc.secretKeyToScalar(d) + tweakScalar(tweak)) % n;
      if (result === 0n) throw new Error("Zero key");
      return secp.etc.numberToBytesBE(result);
    }),
  sign: (hash, key) => secp.sign(hash, key, { prehash: false }),
  verify: (hash, publicKey, signature) =>
    secp.verify(signature, hash, publicKey, { prehash: false, lowS: true }),
};
const bip32 = BIP32Factory(xbtEcc);

export function normalizeMnemonic(text: string): string {
  if (typeof text !== "string" || text.length > 1024)
    throw new Error("Invalid recovery phrase");
  const phrase = text
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .join(" ");
  if (
    ![12, 15, 18, 21, 24].includes(phrase.split(" ").length) ||
    !validateMnemonic(phrase, wordlist)
  ) {
    throw new Error("Invalid English BIP39 recovery phrase");
  }
  return phrase;
}
export function generateRecoveryPhrase(
  cryptoApi: Crypto = globalThis.crypto,
): string {
  const entropy = cryptoApi.getRandomValues(new Uint8Array(32));
  try {
    return entropyToMnemonic(entropy, wordlist);
  } finally {
    entropy.fill(0);
  }
}

export interface PublicXbtAccount {
  profile: typeof XBT_KEY_PROFILE;
  accountXpub: string;
  firstAddress: string;
}
function addressFromNode(publicKey: Uint8Array): string {
  const address = payments.p2wpkh({
    pubkey: publicKey,
    network: networks.bitcoin,
  }).address;
  if (!address) throw new Error("Address derivation failed");
  return address;
}
function checkedIndex(index: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000)
    throw new Error("Invalid address index");
}
function checkedBranch(branch: number): void {
  if (branch !== 0 && branch !== 1) throw new Error("Invalid address branch");
}
export function publicAddress(
  accountXpub: string,
  branch: 0 | 1,
  index: number,
): string {
  return addressFromNode(publicKeyAt(accountXpub, branch, index));
}
export function publicKeyAt(
  accountXpub: string,
  branch: 0 | 1,
  index: number,
): Uint8Array {
  checkedBranch(branch);
  checkedIndex(index);
  const account = bip32.fromBase58(accountXpub, networks.bitcoin);
  if (
    !account.isNeutered() ||
    account.depth !== 3 ||
    account.index !== 0x80000000
  )
    throw new Error("Expected account-0 public key");
  return Uint8Array.from(account.derive(branch).derive(index).publicKey);
}

/** Holds seed bytes only until destroy(); JavaScript cannot guarantee erasing GC copies. */
export class XbtKeySession {
  #seed: Uint8Array | null;
  readonly account: PublicXbtAccount;
  constructor(mnemonic: string, passphrase = "") {
    const phrase = normalizeMnemonic(mnemonic);
    if (typeof passphrase !== "string" || passphrase.length > 1024)
      throw new Error("Invalid BIP39 passphrase");
    this.#seed = Uint8Array.from(
      mnemonicToSeedSync(phrase, passphrase.normalize("NFKD")),
    );
    const root = bip32.fromSeed(this.#seed, networks.bitcoin);
    const node = root.derivePath(XBT_ACCOUNT_PATH);
    this.account = Object.freeze({
      profile: XBT_KEY_PROFILE,
      accountXpub: node.neutered().toBase58(),
      firstAddress: addressFromNode(node.derive(0).derive(0).publicKey),
    });
  }
  get locked(): boolean {
    return this.#seed === null;
  }
  destroy(): void {
    this.#seed?.fill(0);
    this.#seed = null;
  }
  signDigest(
    branch: 0 | 1,
    index: number,
    digest: Uint8Array,
  ): { publicKey: Uint8Array; signature: Uint8Array } {
    if (!this.#seed) throw new Error("Wallet is locked");
    checkedBranch(branch);
    checkedIndex(index);
    if (digest.length !== 32) throw new Error("Expected a 32-byte XBT digest");
    const node = bip32
      .fromSeed(this.#seed, networks.bitcoin)
      .derivePath(`${XBT_ACCOUNT_PATH}/${branch}/${index}`);
    const privateKey = node.privateKey;
    if (!privateKey) throw new Error("Private key unavailable");
    try {
      return {
        publicKey: Uint8Array.from(node.publicKey),
        signature: secp.sign(digest, privateKey, { prehash: false }),
      };
    } finally {
      privateKey.fill(0);
    }
  }
}

export function mnemonicEntropy(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(normalizeMnemonic(mnemonic), wordlist);
}

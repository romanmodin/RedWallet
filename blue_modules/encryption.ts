import { cbc, gcm } from '@noble/ciphers/aes';
import { scryptAsync } from '@noble/hashes/scrypt';
import { md5 } from '@noble/hashes/legacy';
import { randomBytes } from '@noble/hashes/utils';

import { areUint8ArraysEqual, base64ToUint8Array, concatUint8Arrays, stringToUint8Array, uint8ArrayToBase64 } from './uint8array-extras';

/**
 * OpenSSL EVP_BytesToKey using MD5 with 1 iteration.
 *
 * Reproduces the default key+IV derivation used by CryptoJS@4.x's
 * `AES.encrypt(string, password)` so the on-disk wire format stays
 * bit-identical after we swap the underlying library.
 *
 *   D1 = MD5( password || salt )
 *   Di = MD5( D(i-1) || password || salt )   for i ≥ 2
 *   key||iv = D1 || D2 || ...                (take first `byteLength` bytes)
 *
 * Legacy read compatibility only. This fast derivation is unsuitable for
 * new password-protected storage; all new writes use scrypt and AES-GCM.
 */
export function evpBytesToKeyMd5(password: Uint8Array, salt: Uint8Array, byteLength: number): Uint8Array {
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new Error('evpBytesToKeyMd5: byteLength must be a non-negative integer');
  }
  const out = new Uint8Array(byteLength);
  let written = 0;
  let prev: Uint8Array = new Uint8Array(0);
  while (written < byteLength) {
    prev = md5(concatUint8Arrays([prev, password, salt]));
    const take = Math.min(prev.length, byteLength - written);
    out.set(prev.subarray(0, take), written);
    written += take;
  }
  return out;
}

// "Salted__" — OpenSSL envelope magic. Hardcoded as bytes so the wire
// format cannot drift through any encoder.
const SALT_MAGIC = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]);
const SALT_LEN = 8;
const KEY_LEN = 32;
const IV_LEN = 16;
const BLOCK_LEN = 16;

/** Versioned format with fixed KDF costs: attacker-controlled data cannot increase allocation. */
const V2_PREFIX = 'RWV2:';
const V2_SALT_LEN = 16;
const V2_NONCE_LEN = 12;
const V2_TAG_LEN = 16;
const V2_AAD = stringToUint8Array('RedWallet vault v2: scrypt N32768 r8 p3 AES256GCM');

async function deriveVaultKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const bytes = stringToUint8Array(password);
  try {
    return await scryptAsync(bytes, salt, {
      N: 32768,
      r: 8,
      p: 3,
      dkLen: KEY_LEN,
      maxmem: 40 * 1024 * 1024,
      asyncTick: 10,
    });
  } finally {
    bytes.fill(0);
  }
}

/** New writes are authenticated. Legacy OpenSSL envelopes remain readable. */
export async function encrypt(data: string, password: string): Promise<string> {
  if (data.length < 10) throw new Error('data length cant be < 10');
  const salt = randomBytes(V2_SALT_LEN);
  const nonce = randomBytes(V2_NONCE_LEN);
  const key = await deriveVaultKey(password, salt);
  const plain = stringToUint8Array(data);
  try {
    const ciphertext = gcm(key, nonce, concatUint8Arrays([V2_AAD, salt, nonce])).encrypt(plain);
    return V2_PREFIX + uint8ArrayToBase64(concatUint8Arrays([salt, nonce, ciphertext]));
  } finally {
    key.fill(0);
    plain.fill(0);
  }
}

/**
 * Inverse of `encrypt`. Accepts the legacy CryptoJS wire format and returns
 * the original UTF-8 plaintext. Any error (bad base64, missing magic, wrong
 * password, bad padding) collapses to `false`.
 */
export async function decrypt(data: string, password: string): Promise<string | false> {
  try {
    if (data.startsWith(V2_PREFIX)) {
      const envelope = base64ToUint8Array(data.slice(V2_PREFIX.length));
      if (envelope.length < V2_SALT_LEN + V2_NONCE_LEN + V2_TAG_LEN + 10) return false;
      const salt = envelope.subarray(0, V2_SALT_LEN);
      const nonce = envelope.subarray(V2_SALT_LEN, V2_SALT_LEN + V2_NONCE_LEN);
      const ciphertext = envelope.subarray(V2_SALT_LEN + V2_NONCE_LEN);
      const key = await deriveVaultKey(password, salt);
      let plain: Uint8Array | undefined;
      try {
        plain = gcm(key, nonce, concatUint8Arrays([V2_AAD, salt, nonce])).decrypt(ciphertext);
        return new TextDecoder('utf-8', { fatal: true }).decode(plain);
      } finally {
        key.fill(0);
        plain?.fill(0);
      }
    }
    // crypto-js's base64 decoder ignored whitespace. Some old encrypted-backup
    // export/import flows (manual file paste, clipboard transit, email-based
    // wallet transfer) introduced stray newlines or padding spaces. Strip them
    // before strict base64 decode so legacy backups still open. `\s` does not
    // include `=`, so base64 padding survives.
    const envelope = base64ToUint8Array(data.replace(/\s+/g, ''));
    if (envelope.length < SALT_MAGIC.length + SALT_LEN + BLOCK_LEN) return false;
    if (!areUint8ArraysEqual(envelope.subarray(0, SALT_MAGIC.length), SALT_MAGIC)) return false;
    const salt = envelope.subarray(SALT_MAGIC.length, SALT_MAGIC.length + SALT_LEN);
    const ciphertext = envelope.subarray(SALT_MAGIC.length + SALT_LEN);
    const kdf = evpBytesToKeyMd5(stringToUint8Array(password), salt, KEY_LEN + IV_LEN);
    const key = kdf.subarray(0, KEY_LEN);
    const iv = kdf.subarray(KEY_LEN);
    const plain = cbc(key, iv).decrypt(ciphertext);
    // Strict UTF-8 decode — wrong-password decrypts that happen to survive
    // PKCS7 unpadding overwhelmingly fail here (crypto-js's `enc.Utf8` was
    // strict too; we preserve that gate by using `fatal: true`).
    const str = new TextDecoder('utf-8', { fatal: true }).decode(plain);
    // Belt-and-suspenders: legitimate plaintext is always ≥ 10 chars
    // (enforced by encrypt()), so anything shorter is rejected.
    if (str.length < 10) return false;
    return str;
  } catch (e) {
    return false;
  }
}

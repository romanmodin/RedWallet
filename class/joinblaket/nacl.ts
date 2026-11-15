// Adapted from Kilowallet rc6 core/joinblaket/Nacl.kt (Apache-2.0), upstream commit 6a07be1835dc650a6274a90eb0ffeb214b5310ef.
// NaCl `crypto_box` exactly as PyNaCl's `nacl.public.Box` does it (JoinMarket `jmcore/encryption.py`):
//   shared key = HSalsa20(X25519(sk, their_pk), 0^16), all-zero DH refused;
//   secretbox  = XSalsa20-Poly1305, output `MAC16 || ciphertext`;
//   wire       = base64(nonce24 || MAC16 || ciphertext).
// X25519 comes from @noble/curves and HSalsa20/XSalsa20-Poly1305 from @noble/ciphers: nothing is hand-rolled here.
// Keys handled are per-round ephemerals, never wallet keys. Secrets are never serialized or logged; [Box.destroy] wipes them.
import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa';
import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '../rng';
import { decodeBase64 } from './message-signatures';

export const NACL_KEY_BYTES = 32;
export const NACL_NONCE_BYTES = 24;
export const NACL_MAC_BYTES = 16;
/** Upper bound for a secretbox plaintext. Wire text is separately bounded at 4096 base64 characters by `decodeBase64`. */
const MAX_PLAINTEXT_BYTES = 65_536;

// "expand 32-byte k" as little-endian words.
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function wipe(...buffers: Array<Uint8Array | Uint32Array | undefined>): void {
  for (const b of buffers) if (b) b.fill(0);
}

function requireBytes(value: unknown, length: number, what: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) throw new Error(`${what} must be ${length} bytes`);
  return value;
}

/** Little-endian 32-bit words over a copy of [bytes] (never aliases the caller's buffer, so alignment is irrelevant). */
function toWords(bytes: Uint8Array): Uint32Array {
  const words = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < words.length; i++) {
    words[i] = (bytes[4 * i] | (bytes[4 * i + 1] << 8) | (bytes[4 * i + 2] << 16) | (bytes[4 * i + 3] << 24)) >>> 0;
  }
  return words;
}

function fromWords(words: Uint32Array): Buffer {
  const out = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    out[4 * i] = words[i] & 0xff;
    out[4 * i + 1] = (words[i] >>> 8) & 0xff;
    out[4 * i + 2] = (words[i] >>> 16) & 0xff;
    out[4 * i + 3] = (words[i] >>> 24) & 0xff;
  }
  return out;
}

/** HSalsa20 subkey of a 32-byte [key] and 16-byte [nonce16]. Caller owns (and should wipe) the result. */
export function hsalsa20(key: Uint8Array, nonce16: Uint8Array): Buffer {
  requireBytes(key, 32, 'HSalsa20 key');
  requireBytes(nonce16, 16, 'HSalsa20 nonce');
  const k = toWords(key);
  const i = toWords(nonce16);
  const o = new Uint32Array(8);
  try {
    hsalsa(SIGMA, k, i, o);
    return fromWords(o);
  } finally {
    wipe(k, i, o);
  }
}

/** A fresh random secret key (any 32 bytes are valid; X25519 clamps on use). */
export async function generateSecret(): Promise<Buffer> {
  return Buffer.from(await randomBytes(NACL_KEY_BYTES));
}

/** `crypto_scalarmult_base`: the public key of [secret]. */
export function publicKey(secret: Uint8Array): Buffer {
  requireBytes(secret, NACL_KEY_BYTES, 'NaCl secret key');
  return Buffer.from(x25519.getPublicKey(secret));
}

/** `crypto_secretbox_easy` with PyNaCl's layout `MAC16 || ciphertext`. */
export function secretboxSeal(key: Uint8Array, nonce24: Uint8Array, plain: Uint8Array): Buffer {
  requireBytes(key, NACL_KEY_BYTES, 'secretbox key');
  requireBytes(nonce24, NACL_NONCE_BYTES, 'secretbox nonce');
  if (!(plain instanceof Uint8Array) || plain.length > MAX_PLAINTEXT_BYTES) throw new Error('Invalid or oversized plaintext');
  // Copies: noble must never alias or retain the caller's key/nonce buffers (Hermes Buffer views share memory).
  const k = Uint8Array.from(key);
  try {
    return Buffer.from(xsalsa20poly1305(k, Uint8Array.from(nonce24)).encrypt(Uint8Array.from(plain)));
  } finally {
    wipe(k);
  }
}

/** Inverse of [secretboxSeal]; null if the MAC does not verify or the input is malformed. Never throws. */
export function secretboxOpen(key: Uint8Array, nonce24: Uint8Array, boxed: Uint8Array): Buffer | null {
  if (
    !(key instanceof Uint8Array) ||
    key.length !== NACL_KEY_BYTES ||
    !(nonce24 instanceof Uint8Array) ||
    nonce24.length !== NACL_NONCE_BYTES ||
    !(boxed instanceof Uint8Array) ||
    boxed.length < NACL_MAC_BYTES ||
    boxed.length > MAX_PLAINTEXT_BYTES + NACL_MAC_BYTES
  ) {
    return null;
  }
  const k = Uint8Array.from(key);
  try {
    return Buffer.from(xsalsa20poly1305(k, Uint8Array.from(nonce24)).decrypt(Uint8Array.from(boxed)));
  } catch {
    return null;
  } finally {
    wipe(k);
  }
}

/** Strict (fatal) UTF-8 decode; throws on any invalid sequence instead of substituting U+FFFD. */
function decodeUtf8Strict(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('utf8');
  // Round-trip check: invalid sequences become U+FFFD and cannot re-encode to the same bytes. This also rejects
  // non-shortest forms and surrogates, and works on Hermes where TextDecoder({ fatal }) may be unavailable.
  if (!Buffer.from(text, 'utf8').equals(Buffer.from(bytes))) throw new Error('Invalid UTF-8');
  return text;
}

function encodeUtf8Strict(text: string): Buffer {
  if (typeof text !== 'string') throw new Error('String expected');
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) throw new Error('Lone surrogate');
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('Lone surrogate');
  }
  return Buffer.from(text, 'utf8');
}

/**
 * `nacl.public.Box(our_secret, their_public)`. Both directions of a taker/maker pair derive the same shared key.
 * The Box owns private copies of the secret and the derived shared key; call [destroy] when the round ends, after which
 * every use throws. The shared key is deliberately not exposed (and `toJSON`/inspection reveal nothing).
 */
export class Box {
  private sharedKey: Buffer | null = null;

  constructor(ourSecret: Uint8Array, theirPublic: Uint8Array) {
    requireBytes(ourSecret, NACL_KEY_BYTES, 'NaCl secret key');
    requireBytes(theirPublic, NACL_KEY_BYTES, 'NaCl public key');
    const secret = Uint8Array.from(ourSecret);
    let dh: Uint8Array | undefined;
    try {
      // noble's x25519 throws on an all-zero shared secret (low-order point); keep the explicit check regardless.
      dh = x25519.getSharedSecret(secret, Uint8Array.from(theirPublic));
      let acc = 0;
      for (const b of dh) acc |= b;
      if (acc === 0) throw new Error('Weak NaCl public key');
      this.sharedKey = hsalsa20(dh, new Uint8Array(16));
    } catch (e) {
      if (e instanceof Error && e.message === 'Weak NaCl public key') throw e;
      throw new Error('Invalid NaCl key exchange');
    } finally {
      wipe(secret, dh);
    }
  }

  private key(): Buffer {
    if (!this.sharedKey) throw new Error('Box destroyed');
    return this.sharedKey;
  }

  /** Test-only comparison helper: a fresh copy of the shared key. Caller must wipe it. */
  exportSharedKeyForTest(): Buffer {
    return Buffer.from(this.key());
  }

  /** Wipe the shared key. Idempotent. */
  destroy(): void {
    if (this.sharedKey) wipe(this.sharedKey);
    this.sharedKey = null;
  }

  toJSON(): Record<string, never> {
    return {};
  }

  /** `nonce24 || MAC16 || ciphertext`, raw bytes. */
  seal(plain: Uint8Array, nonce24: Uint8Array): Buffer {
    requireBytes(nonce24, NACL_NONCE_BYTES, 'NaCl nonce');
    return Buffer.concat([Buffer.from(nonce24), secretboxSeal(this.key(), nonce24, plain)]);
  }

  /** `encrypt_encode`: base64 of [seal]; the nonce is fresh CSPRNG output unless a test pins it. */
  async encrypt(plain: Uint8Array | string, nonce24?: Uint8Array): Promise<string> {
    const bytes = typeof plain === 'string' ? encodeUtf8Strict(plain) : plain;
    const nonce = nonce24 ?? (await randomBytes(NACL_NONCE_BYTES));
    return this.seal(bytes, nonce).toString('base64');
  }

  /** `decode_decrypt`: strict canonical base64 `nonce || box` to plaintext; throws on a bad MAC or encoding. */
  decrypt(b64: string): Buffer {
    const raw = decodeBase64(b64);
    if (!raw) throw new Error('Invalid NaCl base64');
    if (raw.length < NACL_NONCE_BYTES + NACL_MAC_BYTES) throw new Error('NaCl message too short');
    // Hermes Buffer.subarray may return a plain Uint8Array; Buffer.from restores a real Buffer and copies.
    const nonce = Buffer.from(raw.subarray(0, NACL_NONCE_BYTES));
    const boxed = Buffer.from(raw.subarray(NACL_NONCE_BYTES));
    const plain = secretboxOpen(this.key(), nonce, boxed);
    if (!plain) throw new Error('NaCl authentication failed');
    return plain;
  }

  decryptString(b64: string): string {
    return decodeUtf8Strict(this.decrypt(b64));
  }
}

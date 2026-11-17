// NaCl crypto_box, adapted with Gitar from pinned rc6 Nacl.kt (Apache-2.0).
// Wire: base64(nonce24 || MAC16 || ciphertext). Per-round keys only.
import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa';
import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '../rng';

export const NACL_KEY_BYTES = 32;
export const NACL_NONCE_BYTES = 24;
export const NACL_MAC_BYTES = 16;
// Leave room for command/nick/signature within the 64 KiB directory frame.
export const MAX_PLAINTEXT_BYTES = 48_000;
const MAX_WIRE_CHARS = 4 * Math.ceil((MAX_PLAINTEXT_BYTES + 40) / 3);
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
const boxKeys = new WeakMap<Box, Buffer>();
function wipe(...buffers: Array<Uint8Array | Uint32Array | undefined>): void {
  for (const b of buffers) if (b) b.fill(0);
}
function boxKey(box: Box): Buffer {
  const key = boxKeys.get(box);
  if (!key) throw new Error('Box destroyed');
  return key;
}
function requireBytes(value: unknown, length: number, what: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) throw new Error(what + ' must be ' + length + ' bytes');
  return value;
}
function toWords(bytes: Uint8Array): Uint32Array {
  const words = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < words.length; i++)
    words[i] = bytes[4 * i] + bytes[4 * i + 1] * 256 + bytes[4 * i + 2] * 65536 + bytes[4 * i + 3] * 16777216;
  return words;
}
function fromWords(words: Uint32Array): Buffer {
  const out = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) out.writeUInt32LE(words[i], 4 * i);
  return out;
}
export function hsalsa20(key: Uint8Array, nonce16: Uint8Array): Buffer {
  requireBytes(key, 32, 'HSalsa20 key');
  requireBytes(nonce16, 16, 'HSalsa20 nonce');
  const k = toWords(key),
    i = toWords(nonce16),
    o = new Uint32Array(8);
  try {
    hsalsa(SIGMA, k, i, o);
    return fromWords(o);
  } finally {
    wipe(k, i, o);
  }
}
export async function generateSecret(): Promise<Buffer> {
  const secret = await randomBytes(32);
  try {
    return Buffer.from(secret);
  } finally {
    wipe(secret);
  }
}
export function publicKey(secret: Uint8Array): Buffer {
  requireBytes(secret, 32, 'NaCl secret key');
  return Buffer.from(x25519.getPublicKey(secret));
}
export function secretboxSeal(key: Uint8Array, nonce24: Uint8Array, plain: Uint8Array): Buffer {
  requireBytes(key, 32, 'secretbox key');
  requireBytes(nonce24, 24, 'secretbox nonce');
  if (!(plain instanceof Uint8Array) || plain.length > MAX_PLAINTEXT_BYTES) throw new Error('Invalid or oversized plaintext');
  const k = Uint8Array.from(key),
    p = Uint8Array.from(plain);
  try {
    return Buffer.from(xsalsa20poly1305(k, Uint8Array.from(nonce24)).encrypt(p));
  } finally {
    wipe(k, p);
  }
}
export function secretboxOpen(key: Uint8Array, nonce24: Uint8Array, boxed: Uint8Array): Buffer | null {
  if (
    !(key instanceof Uint8Array) ||
    key.length !== 32 ||
    !(nonce24 instanceof Uint8Array) ||
    nonce24.length !== 24 ||
    !(boxed instanceof Uint8Array) ||
    boxed.length < 16 ||
    boxed.length > MAX_PLAINTEXT_BYTES + 16
  )
    return null;
  const k = Uint8Array.from(key);
  let plain: Uint8Array | undefined;
  try {
    plain = xsalsa20poly1305(k, Uint8Array.from(nonce24)).decrypt(Uint8Array.from(boxed));
    return Buffer.from(plain);
  } catch {
    return null;
  } finally {
    wipe(k, plain);
  }
}
function decodeUtf8Strict(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(Buffer.from(bytes))) throw new Error('Invalid UTF-8');
  return text;
}
function encodeUtf8Strict(text: string): Buffer {
  if (text.length > MAX_PLAINTEXT_BYTES || Buffer.byteLength(text, 'utf8') > MAX_PLAINTEXT_BYTES) throw new Error('Plaintext too large');
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
function decodeWire(text: string): Buffer | null {
  if (
    typeof text !== 'string' ||
    !text.length ||
    text.length > MAX_WIRE_CHARS ||
    text.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(text)
  )
    return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64') === text ? bytes : null;
}
// Owns the derived shared key; temporary DH/secret copies are wiped. JavaScript
// cannot promise erasure of copies made internally by the VM or crypto library.
export class Box {
  constructor(ourSecret: Uint8Array, theirPublic: Uint8Array) {
    requireBytes(ourSecret, 32, 'NaCl secret key');
    requireBytes(theirPublic, 32, 'NaCl public key');
    const secret = Uint8Array.from(ourSecret);
    let dh: Uint8Array | undefined;
    try {
      dh = x25519.getSharedSecret(secret, Uint8Array.from(theirPublic));
      if (dh.every(b => b === 0)) throw new Error('Weak NaCl public key');
      boxKeys.set(this, hsalsa20(dh, new Uint8Array(16)));
      Object.freeze(this);
    } catch {
      throw new Error('Invalid NaCl key exchange');
    } finally {
      wipe(secret, dh);
    }
  }

  destroy(): void {
    wipe(boxKeys.get(this));
    boxKeys.delete(this);
  }

  toJSON(): never {
    throw new Error('NaCl sessions cannot be serialized');
  }

  // Low-level known-answer interface. Production callers use encrypt for fresh nonces.
  seal(plain: Uint8Array, nonce24: Uint8Array): Buffer {
    requireBytes(nonce24, 24, 'NaCl nonce');
    return Buffer.concat([Buffer.from(nonce24), secretboxSeal(boxKey(this), nonce24, plain)]);
  }

  async encrypt(plain: Uint8Array | string): Promise<string> {
    boxKey(this);
    if (typeof plain !== 'string' && (!(plain instanceof Uint8Array) || plain.length > MAX_PLAINTEXT_BYTES))
      throw new Error('Invalid or oversized plaintext');
    const bytes = typeof plain === 'string' ? encodeUtf8Strict(plain) : Buffer.from(plain);
    try {
      const nonce = await randomBytes(24);
      return this.seal(bytes, nonce).toString('base64');
    } finally {
      wipe(bytes);
    }
  }

  decrypt(b64: string): Buffer {
    boxKey(this);
    const raw = decodeWire(b64);
    if (!raw) throw new Error('Invalid NaCl base64');
    if (raw.length < 40) throw new Error('NaCl message too short');
    const nonce = Buffer.from(raw.subarray(0, 24)),
      boxed = Buffer.from(raw.subarray(24));
    const plain = secretboxOpen(boxKey(this), nonce, boxed);
    if (!plain) throw new Error('NaCl authentication failed');
    return plain;
  }

  decryptString(b64: string): string {
    const bytes = this.decrypt(b64);
    try {
      return decodeUtf8Strict(bytes);
    } finally {
      wipe(bytes);
    }
  }
}

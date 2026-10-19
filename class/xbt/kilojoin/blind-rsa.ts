/** Kilojoin v3 client-side RSABSSA-SHA384-PSS-Randomized.
 * Adapted from Kilombino/kilowallet BlindRsa.kt, Apache-2.0.
 * Experimental offline implementation; no private RSA signing keys or key generation.
 */
import { sha384 } from '@noble/hashes/sha512';
import { equal } from './crypto';
export type PublicKey = { n: bigint; e: bigint; bits: number; length: number };
export type RandomBytes = (length: number) => Uint8Array;
function number(bytes: Uint8Array): bigint {
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}
function bytes(n: bigint, length: number): Buffer {
  if (n < 0n || n >= 1n << BigInt(length * 8)) throw new Error('RSA integer overflow');
  return Buffer.from(n.toString(16).padStart(length * 2, '0'), 'hex');
}
export function publicKey(encoded: string): PublicKey {
  if (typeof encoded !== 'string' || encoded.length > 1032 || !/^[1-9a-f][0-9a-f]*:10001$/.test(encoded))
    throw new Error('Invalid RSA key');
  const n = BigInt('0x' + encoded.split(':')[0]);
  const bits = n.toString(2).length;
  if (bits < 2048 || bits > 4096 || n % 2n !== 1n) throw new Error('Unsupported RSA modulus');
  return Object.freeze({ n, e: 65537n, bits, length: Math.ceil(bits / 8) });
}
export function modPow(b: bigint, e: bigint, n: bigint): bigint {
  if (n <= 1n || e < 0n) throw new Error('Invalid modular exponent');
  let result = 1n;
  b = ((b % n) + n) % n;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % n;
    b = (b * b) % n;
    e >>= 1n;
  }
  return result;
}
export function inverse(a: bigint, n: bigint): bigint {
  let t = 0n,
    newT = 1n,
    r = n,
    newR = ((a % n) + n) % n;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r !== 1n) throw new Error('RSA blinding factor not invertible');
  return ((t % n) + n) % n;
}
const digest = (...parts: Uint8Array[]): Buffer => Buffer.from(sha384(Buffer.concat(parts)));
function mgf(seed: Uint8Array, length: number): Buffer {
  const chunks: Buffer[] = [];
  for (let i = 0; i * 48 < length; i++) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(i);
    chunks.push(digest(seed, counter));
  }
  return Buffer.concat(chunks).subarray(0, length);
}
export function pssEncode(prepared: Uint8Array, bits: number, salt: Uint8Array): Buffer {
  if (salt.length !== 48 || prepared.length < 32 || prepared.length > 65567 || bits < 2047 || bits > 4095)
    throw new Error('Invalid PSS parameters');
  const length = Math.ceil(bits / 8),
    h = digest(Buffer.alloc(8), digest(prepared), salt);
  const db = Buffer.alloc(length - 49);
  db[db.length - 49] = 1;
  db.set(salt, db.length - 48);
  const mask = mgf(h, db.length);
  for (let i = 0; i < db.length; i++) db[i] ^= mask[i];
  db[0] &= 0xff >>> (8 * length - bits);
  return Buffer.concat([db, h, Buffer.from([0xbc])]);
}
function random(rng: RandomBytes, length: number): Buffer {
  const result = Buffer.from(rng(length));
  if (result.length !== length) throw new Error('Invalid entropy length');
  return result;
}
export function prepare(message: Uint8Array, rng: RandomBytes): Buffer {
  if (message.length < 1 || message.length > 65535) throw new Error('Invalid blind message length');
  return Buffer.concat([random(rng, 32), message]);
}
export function blind(
  pk: PublicKey,
  prepared: Uint8Array,
  rng: RandomBytes,
  vector?: { salt: Uint8Array; r: bigint },
): { blinded: Buffer; inv: bigint } {
  const em = pssEncode(prepared, pk.bits - 1, vector?.salt ?? random(rng, 48)),
    m = number(em);
  inverse(m, pk.n);
  for (let attempts = 0; attempts < 128; attempts++) {
    const r = vector?.r ?? number(random(rng, pk.length));
    if (r <= 0n || r >= pk.n) {
      if (vector) throw new Error('Invalid blinding factor');
      continue;
    }
    let inv: bigint;
    try {
      inv = inverse(r, pk.n);
    } catch {
      if (vector) throw new Error('Invalid blinding factor');
      continue;
    }
    return {
      blinded: bytes((m * modPow(r, pk.e, pk.n)) % pk.n, pk.length),
      inv,
    };
  }
  throw new Error('Unable to generate blinding factor');
}
export function verify(pk: PublicKey, prepared: Uint8Array, sig: Uint8Array): boolean {
  try {
    if (sig.length !== pk.length || prepared.length < 32 || prepared.length > 65567) return false;
    const s = number(sig);
    if (s >= pk.n) return false;
    const bits = pk.bits - 1,
      length = Math.ceil(bits / 8),
      em = bytes(modPow(s, pk.e, pk.n), length);
    if (em[length - 1] !== 0xbc) return false;
    const masked = em.subarray(0, length - 49),
      h = em.subarray(length - 49, length - 1),
      top = 8 * length - bits;
    if ((masked[0] & (0xff << (8 - top)) & 0xff) !== 0) return false;
    const mask = mgf(h, masked.length),
      db = Buffer.from(masked);
    for (let i = 0; i < db.length; i++) db[i] ^= mask[i];
    db[0] &= 0xff >>> top;
    const ps = length - 98;
    if (db.subarray(0, ps).some(b => b !== 0) || db[ps] !== 1) return false;
    return equal(h, digest(Buffer.alloc(8), digest(prepared), db.subarray(-48)));
  } catch {
    return false;
  }
}
export function finalize(pk: PublicKey, prepared: Uint8Array, blindSig: Uint8Array, inv: bigint): Buffer {
  if (blindSig.length !== pk.length || number(blindSig) >= pk.n || inv <= 0n || inv >= pk.n) throw new Error('Invalid blind signature');
  const sig = bytes((number(blindSig) * inv) % pk.n, pk.length);
  if (!verify(pk, prepared, sig)) throw new Error('Blind signature verification failed');
  return sig;
}

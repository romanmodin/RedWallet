// Adapted from Kilowallet rc6 core/joinblaket/JmSig.kt (Apache-2.0), upstream commit 6a07be1835dc650a6274a90eb0ffeb214b5310ef.
// JoinMarket (non-transaction) ECDSA conventions: Bitcoin signed-message hash, RFC 6979 without low-R grinding, low-S,
// strict DER, base64 on the wire. Pure functions: no key storage, network or randomness.
import { crypto, script } from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';

const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = CURVE_N / 2n;
const MAX_MESSAGE_BYTES = 65_536;
const MESSAGE_PREFIX = Buffer.from('\x18Bitcoin Signed Message:\n', 'latin1');
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  return n;
}

/** UTF-8 bytes of [text]; lone surrogates are rejected rather than replaced by U+FFFD. */
export function utf8(text: string): Buffer {
  if (typeof text !== 'string') throw new Error('String expected');
  if (text.length > MAX_MESSAGE_BYTES) throw new Error('Message too large');
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) throw new Error('Lone surrogate');
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('Lone surrogate');
  }
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > MAX_MESSAGE_BYTES) throw new Error('Message too large');
  return bytes;
}

function compactSize(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  const encoded = Buffer.alloc(n <= 0xffff ? 3 : 5);
  encoded[0] = n <= 0xffff ? 0xfd : 0xfe;
  if (n <= 0xffff) encoded.writeUInt16LE(n, 1);
  else encoded.writeUInt32LE(n, 1);
  return encoded;
}

/** `sha256d("\x18Bitcoin Signed Message:\n" || compactsize(len) || msg)`. */
export function messageHash(msg: Uint8Array | string): Buffer {
  if (typeof msg !== 'string' && (!(msg instanceof Uint8Array) || msg.length > MAX_MESSAGE_BYTES))
    throw new Error('Invalid or oversized message');
  const bytes = typeof msg === 'string' ? utf8(msg) : Buffer.from(msg);
  if (bytes.length > MAX_MESSAGE_BYTES) throw new Error('Message too large');
  return Buffer.from(crypto.hash256(Buffer.concat([MESSAGE_PREFIX, compactSize(bytes.length), bytes])));
}

/** Strict canonical base64 (standard alphabet, padding optional, no whitespace, zero trailing bits); null if invalid. */
export function decodeBase64(text: string): Buffer | null {
  if (typeof text !== 'string' || !text.length || text.length > 4096 || !BASE64.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64').replace(/[=]+$/, '') === text.replace(/[=]+$/, '') ? bytes : null;
}

export type StrictSignature = Readonly<{ r: Buffer; s: Buffer }>;

/** Strict DER with 1 <= r < n and 1 <= s <= n/2 (`_is_strict_low_s_der_signature`); null otherwise. */
export function parseStrictDer(sig: Uint8Array): StrictSignature | null {
  if (!(sig instanceof Uint8Array) || sig.length < 8 || sig.length > 72) return null;
  const u = (i: number): number => sig[i];
  if (u(0) !== 0x30 || u(1) !== sig.length - 2 || u(2) !== 0x02) return null;
  const rLen = u(3);
  if (rLen === 0 || 5 + rLen >= sig.length) return null;
  if (u(4) >= 0x80) return null;
  if (rLen > 1 && u(4) === 0 && u(5) < 0x80) return null;
  const sType = 4 + rLen;
  if (u(sType) !== 0x02) return null;
  const sLen = u(sType + 1);
  const sStart = sType + 2;
  if (sLen === 0 || sStart + sLen !== sig.length) return null;
  if (u(sStart) >= 0x80) return null;
  if (sLen > 1 && u(sStart) === 0 && u(sStart + 1) < 0x80) return null;
  const r = bytesToBigInt(sig.subarray(4, 4 + rLen));
  const s = bytesToBigInt(sig.subarray(sStart, sStart + sLen));
  if (r === 0n || r >= CURVE_N || s === 0n || s > HALF_N) return null;
  const pad = (n: bigint): Buffer => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
  return Object.freeze({ r: pad(r), s: pad(s) });
}

/** Minimal DER of 32-byte big-endian (r, s), via bitcoinjs-lib. */
export function der(r: Uint8Array, s: Uint8Array): Buffer {
  if (r.length !== 32 || s.length !== 32) throw new Error('r and s must be 32 bytes');
  // bitcoinjs-lib appends a hash-type byte; strip it again, the JoinMarket wire format has none.
  // Hermes Buffer.subarray can return a plain Uint8Array. Restore Buffer after slicing,
  // otherwise toString('base64') emits comma-separated byte values.
  return Buffer.from(script.signature.encode(Buffer.concat([r, s]), 1).subarray(0, -1));
}

/** DER signature (no hash-type byte) of a 32-byte [hash]: RFC 6979, no low-R grinding, low-S. */
export function signHash(privateKey: Uint8Array, hash: Uint8Array): Buffer {
  if (privateKey.length !== 32 || !ecc.isPrivate(privateKey) || hash.length !== 32) throw new Error('Invalid signing input');
  const compact = ecc.sign(hash, privateKey);
  const out = der(compact.subarray(0, 32), compact.subarray(32, 64));
  if (!parseStrictDer(out)) throw new Error('Produced a non-canonical signature');
  return out;
}

/** base64(DER) over the signed-message hash of [msg]: `ecdsa_sign` / `sign_bytes`. */
export function signMessage(privateKey: Uint8Array, msg: Uint8Array | string): string {
  return signHash(privateKey, messageHash(msg)).toString('base64');
}

/** A 33-byte compressed key that is a valid curve point. */
export function isCompressedPoint(pubkey: Uint8Array): boolean {
  return pubkey instanceof Uint8Array && pubkey.length === 33 && (pubkey[0] === 2 || pubkey[0] === 3) && ecc.isPoint(pubkey);
}

/** `verify_strict_ecdsa`: strict DER, low-S and a valid signature over [hash] by [pubkey]. Never throws. */
export function verifyHash(hash: Uint8Array, derSig: Uint8Array, pubkey: Uint8Array): boolean {
  try {
    const parsed = parseStrictDer(derSig);
    if (!parsed || hash.length !== 32 || !isCompressedPoint(pubkey)) return false;
    return ecc.verify(hash, pubkey, Buffer.concat([parsed.r, parsed.s]), true);
  } catch {
    return false;
  }
}

/** `ecdsa_verify`: base64 [sigB64] over the signed-message hash of [msg]. Never throws. */
export function verifyMessage(msg: Uint8Array | string, sigB64: string, pubkey: Uint8Array): boolean {
  try {
    const sig = decodeBase64(sigB64);
    return sig !== null && verifyHash(messageHash(msg), sig, pubkey);
  } catch {
    return false;
  }
}

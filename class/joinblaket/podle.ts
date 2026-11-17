// Adapted from Kilowallet rc6 core/joinblaket/Podle.kt (Apache-2.0), upstream commit 6a07be1835dc650a6274a90eb0ffeb214b5310ef.
// PoDLE, the taker's anti-snooping commitment (`jmcore/podle.py`): proof that P = xG and P2 = xJ_i share the discrete log x
// of a UTXO key, committed as sha256(P2) in `!fill` and revealed in `!auth`. Points are 33-byte compressed keys.
// `generate` takes the UTXO key as an argument and returns only the public proof; it never stores, logs or serializes keys,
// and wipes its intermediate secret scalars. No network, storage, signing or logging happens here.
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { crypto } from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';

const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const NONCE_DOMAIN = Buffer.from('JoinMarket/PoDLE/nonce/v1', 'utf8');
const G_COMPRESSED = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
const G_UNCOMPRESSED = Buffer.from(
  '0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8',
  'hex',
);

/** Makers accept indices `0 until taker_utxo_retries` (default 3). */
export const DEFAULT_INDICES: readonly number[] = Object.freeze([0, 1, 2]);
/** Hard bound on verification indices and on RFC 6979 candidate retries (a valid candidate is ~1 - 2^-128 likely per draw). */
export const MAX_INDICES = 256;
const MAX_NONCE_ATTEMPTS = 64;
const MAX_UTXO_LIST = 256;
const MAX_REVELATION_CHARS = 1_024;
const MAX_UTXO_CHARS = 320;
const HEX = /^(?:[0-9a-fA-F]{2})+$/;
const HEX_TXID = /^[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,9})$/;

const numsCache = new Map<number, Buffer>();

function sha256Buf(...parts: Uint8Array[]): Buffer {
  return Buffer.from(sha256(Buffer.concat(parts)));
}
function hmacSha256(key: Uint8Array, ...parts: Uint8Array[]): Buffer {
  const data = Buffer.concat(parts);
  try {
    return Buffer.from(hmac(sha256, key, data));
  } finally {
    data.fill(0);
  }
}
function toBigInt(bytes: Uint8Array): bigint {
  return bytes.length ? BigInt('0x' + Buffer.from(bytes).toString('hex')) : 0n;
}
function b32(v: bigint): Buffer {
  if (v < 0n || v >= 2n ** 256n) throw new Error('Scalar out of range');
  return Buffer.from(v.toString(16).padStart(64, '0'), 'hex');
}
function wipe(...buffers: Array<Uint8Array | undefined>): void {
  for (const b of buffers) if (b) b.fill(0);
}
function hexBytes(text: string, what: string): Buffer {
  if (typeof text !== 'string' || !HEX.test(text)) throw new Error(`Invalid ${what} hex`);
  return Buffer.from(text, 'hex');
}

/** [k]·[point] (compressed), or null if k is zero mod n or the point is invalid. */
function mul(point: Uint8Array, k: Uint8Array): Buffer | null {
  const r = ecc.pointMultiply(point, k, true);
  return r ? Buffer.from(r) : null;
}
/** [a] + [b] (compressed), or null at infinity / invalid input. */
function add(a: Uint8Array, b: Uint8Array): Buffer | null {
  const r = ecc.pointAdd(a, b, true);
  return r ? Buffer.from(r) : null;
}
function pubkey(secret: Uint8Array): Buffer | null {
  const r = ecc.pointFromScalar(secret, true);
  return r ? Buffer.from(r) : null;
}
function parsePoint(p: Uint8Array): Buffer | null {
  if (!(p instanceof Uint8Array) || p.length !== 33 || (p[0] !== 2 && p[0] !== 3) || !ecc.isPoint(p)) return null;
  return Buffer.from(p);
}

/**
 * NUMS point `J_i`: for G compressed then uncompressed, for ctr 0..255, the first valid point
 * `0x02 || sha256(G_ser || u8(i) || u8(ctr))`.
 */
export function numsPoint(index: number): Buffer {
  if (!Number.isInteger(index) || index < 0 || index > 255) throw new Error('NUMS index must be 0..255');
  const cached = numsCache.get(index);
  if (cached) return Buffer.from(cached);
  for (const g of [G_COMPRESSED, G_UNCOMPRESSED]) {
    for (let ctr = 0; ctr <= 255; ctr++) {
      const candidate = Buffer.concat([Buffer.from([2]), sha256Buf(g, Buffer.from([index, ctr]))]);
      const point = parsePoint(candidate);
      if (point) {
        numsCache.set(index, point);
        return Buffer.from(point);
      }
    }
  }
  throw new Error(`No NUMS point for index ${index}`); // unreachable in practice
}

/**
 * RFC 6979 (HMAC-SHA256) nonce candidates for key [x] over [hash] (`_rfc6979_nonce_candidates`);
 * [skip] drops that many valid candidates first (the retry rule). Bounded: throws rather than loops forever.
 */
export function rfc6979Nonce(x: Uint8Array, hash: Uint8Array, skip: number = 0): Buffer {
  if (
    !(x instanceof Uint8Array) ||
    !(hash instanceof Uint8Array) ||
    x.length !== 32 ||
    !ecc.isPrivate(x) ||
    hash.length !== 32 ||
    !Number.isInteger(skip) ||
    skip < 0 ||
    skip > MAX_NONCE_ATTEMPTS
  ) {
    throw new Error('Invalid nonce input');
  }
  const seed = Buffer.concat([x, b32(toBigInt(hash) % CURVE_N)]);
  let v: Buffer = Buffer.alloc(32, 1);
  let k: Buffer = Buffer.alloc(32, 0);
  const replace = (old: Buffer, next: Buffer) => {
    wipe(old);
    return next;
  };
  try {
    k = replace(k, hmacSha256(k, v, Buffer.from([0]), seed));
    v = replace(v, hmacSha256(k, v));
    k = replace(k, hmacSha256(k, v, Buffer.from([1]), seed));
    v = replace(v, hmacSha256(k, v));
    let left = skip;
    for (let draws = 0; draws < MAX_NONCE_ATTEMPTS + skip + 1; draws++) {
      v = replace(v, hmacSha256(k, v));
      const c = toBigInt(v);
      if (c !== 0n && c < CURVE_N) {
        if (left === 0) return Buffer.from(v);
        left--;
      }
      k = replace(k, hmacSha256(k, v, Buffer.from([0])));
      v = replace(v, hmacSha256(k, v));
    }
    throw new Error('No valid nonce candidate');
  } finally {
    wipe(seed, v, k);
  }
}

// ---- UTXO references -----------------------------------------------------------------------------------------------

/** `txid:vout` or extended `txid:vout:scriptpubkey_hex:blockheight`. txid is lowercase-normalised. */
export type UtxoRef = Readonly<{
  txid: string;
  vout: number;
  scriptPubKeyHex?: string;
  height?: number;
}>;

/** `UTXOMetadata.from_str` with its validation (64-hex txid, uint32 vout, 4..200 hex-char even-length spk, height >= 0). */
export function parseUtxo(text: string): UtxoRef {
  if (typeof text !== 'string' || text.length > MAX_UTXO_CHARS) throw new Error('Invalid UTXO format');
  const parts = text.split(':');
  if (parts.length !== 2 && parts.length !== 4) throw new Error('Invalid UTXO format');
  if (!HEX_TXID.test(parts[0])) throw new Error('Invalid txid');
  if (!DECIMAL.test(parts[1])) throw new Error('Invalid vout');
  const vout = Number(parts[1]);
  if (vout > 0xffffffff) throw new Error('Invalid vout');
  const txid = parts[0].toLowerCase();
  if (parts.length === 2) return Object.freeze({ txid, vout });
  const spk = parts[2];
  if (spk.length < 4 || spk.length > 200 || !HEX.test(spk)) throw new Error('Invalid scriptpubkey');
  if (!DECIMAL.test(parts[3])) throw new Error('Invalid blockheight');
  const height = Number(parts[3]);
  if (height > 0x7fffffff) throw new Error('Invalid blockheight');
  return Object.freeze({
    txid,
    vout,
    scriptPubKeyHex: spk.toLowerCase(),
    height,
  });
}

/** `txid:vout`, or the extended form when [extended] and the ref carries a script and height. */
export function formatRef(ref: UtxoRef, extended: boolean): string {
  if ((ref.scriptPubKeyHex === undefined) !== (ref.height === undefined)) throw new Error('Incomplete UTXO metadata');
  parseUtxo(`${ref.txid}:${ref.vout}` + (ref.scriptPubKeyHex === undefined ? '' : `:${ref.scriptPubKeyHex}:${ref.height}`));
  const legacy = `${ref.txid.toLowerCase()}:${ref.vout}`;
  return extended && ref.scriptPubKeyHex !== undefined && ref.height !== undefined
    ? `${legacy}:${ref.scriptPubKeyHex}:${ref.height}`
    : legacy;
}

/** `parse_utxo_list`: comma-separated refs (empty string = none), bounded to [MAX_UTXO_LIST] entries. */
export function parseUtxoList(text: string): UtxoRef[] {
  if (typeof text !== 'string' || text.length > MAX_UTXO_LIST * (MAX_UTXO_CHARS + 1)) throw new Error('Invalid UTXO list');
  if (text === '') return [];
  const items = text.split(',');
  if (items.length > MAX_UTXO_LIST) throw new Error('Too many UTXOs');
  const refs = items.map(item => parseUtxo(item.trim()));
  if (new Set(refs.map(r => r.txid + ':' + r.vout)).size !== refs.length) throw new Error('Duplicate UTXO');
  return refs;
}

/** `format_utxo_list`. */
export function formatUtxoList(refs: readonly UtxoRef[], extended: boolean): string {
  if (!Array.isArray(refs) || refs.length > MAX_UTXO_LIST) throw new Error('Too many UTXOs');
  const text = refs.map(r => formatRef(r, extended)).join(',');
  parseUtxoList(text);
  return text;
}

/** The message the deterministic nonce signs: legacy `txid:vout` [utxo], index, P, P2. */
export function nonceHash(utxo: string, index: number, p: Uint8Array, p2: Uint8Array): Buffer {
  if (typeof utxo !== 'string' || utxo.length > MAX_UTXO_CHARS) throw new Error('Invalid utxo');
  const ref = parseUtxo(utxo);
  if (ref.scriptPubKeyHex !== undefined || !Number.isInteger(index) || index < 0 || index > 255 || !parsePoint(p) || !parsePoint(p2))
    throw new Error('Invalid PoDLE nonce input');
  const u = Buffer.from(formatRef(ref, false), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(u.length, 0);
  return sha256Buf(NONCE_DOMAIN, len, u, Buffer.from([index]), p, p2);
}

/** A generated commitment and its opening (public data only). */
export type Commitment = Readonly<{
  p: Buffer;
  p2: Buffer;
  s: Buffer;
  e: Buffer;
  commitment: Buffer;
  utxo: string;
  index: number;
}>;

/** `"P" + hex(sha256(P2))`, the last field of `!fill`. */
export function commitmentWire(c: Pick<Commitment, 'commitment'>): string {
  return 'P' + c.commitment.toString('hex');
}

/**
 * The `!auth` plaintext `utxo|P|P2|s|e`. With [scriptPubKeyHex] and [height] (makers advertising `neutrino_compat`,
 * i.e. every JoinBlaket maker) the utxo is the extended `txid:vout:spk:height`.
 */
export function revelation(c: Commitment, scriptPubKeyHex?: string, height?: number): string {
  if ((scriptPubKeyHex === undefined) !== (height === undefined)) throw new Error('Incomplete revelation metadata');
  let u = c.utxo;
  if (scriptPubKeyHex !== undefined && height !== undefined) {
    u = formatRef(parseUtxo(`${c.utxo}:${scriptPubKeyHex}:${height}`), true);
  }
  return [u, c.p.toString('hex'), c.p2.toString('hex'), c.s.toString('hex'), c.e.toString('hex')].join('|');
}

/**
 * `generate_podle` for UTXO key [x] spending [utxo] (`txid:vout`, legacy form) at NUMS [index]. Deterministic: the same
 * inputs give the vectors' proof byte for byte. [x] is only read; the caller keeps ownership of it and must wipe it.
 */
export function generate(x: Uint8Array, utxo: string, index: number): Commitment {
  if (!(x instanceof Uint8Array) || x.length !== 32 || !ecc.isPrivate(x)) throw new Error('Invalid private key');
  if (!Number.isInteger(index) || index < 0 || index > 255) throw new Error('Invalid NUMS index');
  const ref = parseUtxo(utxo);
  if (ref.scriptPubKeyHex !== undefined) throw new Error('Legacy txid:vout utxo expected');
  const legacy = formatRef(ref, false);
  const j = numsPoint(index);
  const xCopy = Buffer.from(x);
  let nonceK: Buffer | undefined;
  try {
    const p = pubkey(xCopy);
    const p2 = mul(j, xCopy);
    if (!p || !p2) throw new Error('Invalid PoDLE key');
    const h = nonceHash(legacy, index, p, p2);
    const xInt = toBigInt(xCopy);
    for (let attempt = 0; attempt < MAX_NONCE_ATTEMPTS; attempt++) {
      wipe(nonceK);
      nonceK = rfc6979Nonce(xCopy, h, attempt);
      const kg = pubkey(nonceK);
      const kj = mul(j, nonceK);
      if (!kg || !kj) continue;
      const e = sha256Buf(kg, kj, p, p2);
      const eInt = toBigInt(e) % CURVE_N;
      if (eInt === 0n) continue;
      const s = (toBigInt(nonceK) + ((eInt * xInt) % CURVE_N)) % CURVE_N;
      if (s === 0n) continue;
      return Object.freeze({
        p,
        p2,
        s: b32(s),
        e,
        commitment: sha256Buf(p2),
        utxo: legacy,
        index,
      });
    }
    throw new Error('PoDLE nonce retries exhausted');
  } finally {
    wipe(xCopy, nonceK);
  }
}

/**
 * `verify_podle`: `sha256(P2) == commitment`, `0 < s < n`, and for some index in [indices]
 * `sha256((sG - eP) || (sJ - eP2) || P || P2) == e`. Never throws.
 */
export function verify(
  p: Uint8Array,
  p2: Uint8Array,
  s: Uint8Array,
  e: Uint8Array,
  commitment: Uint8Array,
  indices: readonly number[] = DEFAULT_INDICES,
): boolean {
  try {
    if (
      !(p instanceof Uint8Array) ||
      !(p2 instanceof Uint8Array) ||
      !(s instanceof Uint8Array) ||
      !(e instanceof Uint8Array) ||
      !(commitment instanceof Uint8Array) ||
      p.length !== 33 ||
      p2.length !== 33 ||
      s.length !== 32 ||
      e.length !== 32 ||
      commitment.length !== 32 ||
      !Array.isArray(indices) ||
      indices.length > MAX_INDICES ||
      indices.some(i => !Number.isInteger(i) || i < 0 || i > 255)
    ) {
      return false;
    }
    if (!sha256Buf(p2).equals(Buffer.from(commitment))) return false;
    const pp = parsePoint(p);
    const pp2 = parsePoint(p2);
    if (!pp || !pp2) return false;
    const sInt = toBigInt(s);
    if (sInt === 0n || sInt >= CURVE_N) return false;
    const eMod = toBigInt(e) % CURVE_N;
    if (eMod === 0n) return false;
    const minusE = b32(CURVE_N - eMod);
    const sG = pubkey(s);
    const eP = mul(pp, minusE);
    const eP2 = mul(pp2, minusE);
    if (!sG || !eP || !eP2) return false;
    const kg = add(sG, eP);
    if (!kg) return false;
    for (const i of indices) {
      if (!Number.isInteger(i) || i < 0 || i > 255) return false;
      const sJ = mul(numsPoint(i), s);
      const kj = sJ && add(sJ, eP2);
      if (kj && sha256Buf(kg, kj, pp, pp2).equals(Buffer.from(e))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---- Revelation ----------------------------------------------------------------------------------------------------

/** A parsed `!auth` revelation. */
export type Revelation = Readonly<{
  txid: string;
  vout: number;
  scriptPubKeyHex?: string;
  height?: number;
  p: Buffer;
  p2: Buffer;
  s: Buffer;
  e: Buffer;
}>;

/** Parse `utxo|P|P2|s|e` (field lengths 66/66/64/64 hex), legacy or extended utxo. */
export function parseRevelation(text: string): Revelation {
  if (typeof text !== 'string' || text.length > MAX_REVELATION_CHARS) throw new Error('Invalid revelation');
  const f = text.split('|');
  if (f.length !== 5) throw new Error('Revelation needs 5 fields');
  if (f[1].length !== 66 || f[2].length !== 66 || f[3].length !== 64 || f[4].length !== 64) throw new Error('Bad revelation field length');
  const u = parseUtxo(f[0]);
  return Object.freeze({
    txid: u.txid,
    vout: u.vout,
    scriptPubKeyHex: u.scriptPubKeyHex,
    height: u.height,
    p: hexBytes(f[1], 'P'),
    p2: hexBytes(f[2], 'P2'),
    s: hexBytes(f[3], 's'),
    e: hexBytes(f[4], 'e'),
  });
}

/**
 * `verify_podle_binding`: P controls [scriptPubKey] as P2WPKH, P2PKH or P2SH-P2WPKH (the taker only ever uses P2WPKH,
 * but makers check all three).
 */
export function bindsTo(p: Uint8Array, scriptPubKey: Uint8Array): boolean {
  if (!(p instanceof Uint8Array) || !(scriptPubKey instanceof Uint8Array) || !parsePoint(p)) return false;
  const h = Buffer.from(crypto.hash160(Buffer.from(p)));
  const spk = Buffer.from(scriptPubKey);
  if (spk.length === 22 && spk[0] === 0x00 && spk[1] === 0x14) return Buffer.from(spk.subarray(2, 22)).equals(h);
  if (spk.length === 25 && spk[0] === 0x76 && spk[1] === 0xa9 && spk[2] === 0x14 && spk[23] === 0x88 && spk[24] === 0xac) {
    return Buffer.from(spk.subarray(3, 23)).equals(h);
  }
  if (spk.length === 23 && spk[0] === 0xa9 && spk[1] === 0x14 && spk[22] === 0x87) {
    const redeem = Buffer.concat([Buffer.from([0x00, 0x14]), h]);
    return Buffer.from(spk.subarray(2, 22)).equals(Buffer.from(crypto.hash160(redeem)));
  }
  return false;
}

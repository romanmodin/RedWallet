// Adapted from pinned Kilowallet rc6 Offers.kt/Orderbook.kt; see docs/joinblaket-port.md.
import { crypto, script } from 'bitcoinjs-lib';
import { decimal, Offer, sats } from './fees';
import { decodeBase64, isCompressedPoint, messageHash, verifyHash } from './message-signatures';
import { isValidNick, verifyPrivmsg } from './nick';
import { Frame, PRIVMSG, PUBMSG } from './wire';

export type MakerOffer = Offer & Readonly<{ oid: number; bondProof?: string }>;
const TYPES = ['sw0absoffer', 'sw0reloffer', 'swabsoffer', 'swreloffer'];
function unsigned(text: string, maximum = 2_100_000_000_000_000): number {
  if (typeof text !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/.test(text)) throw new Error('Invalid offer integer');
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n > maximum) throw new Error('Offer integer outside range');
  return n;
}
export function normalizeRelativeFee(text: string): string {
  if (typeof text !== 'string' || text.length > 96) throw new Error('Invalid relative fee');
  const s = text.trim(),
    n = decimal(s);
  const [coefficient, exponent = '0'] = s.replace(/^\+/, '').toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const precision = (whole + fraction).replace(/^0+/, '').length || 1;
  const scale = fraction.length - Number(exponent);
  if (precision > 32 || scale < -32 || scale > 32) throw new Error('Unreasonable relative fee');
  return n.toFixed(Math.max(0, scale));
}
export function parseOffer(rest: string, from: string): MakerOffer | null {
  try {
    if (!isValidNick(from) || typeof rest !== 'string' || rest.length > 60000) return null;
    const parts = rest.split('!');
    if (parts.length > 16) return null;
    const fields = parts[0].trim().split(/\s+/);
    if (fields.length < 6 || !TYPES.includes(fields[0])) return null;
    const [type, oidText, minText, maxText, txText, feeText] = fields;
    const oid = unsigned(oidText, Number.MAX_SAFE_INTEGER),
      minsize = unsigned(minText),
      maxsize = unsigned(maxText),
      txfee = unsigned(txText);
    if (minsize > maxsize) return null;
    const cjfee = type.endsWith('absoffer') ? String(unsigned(feeText)) : normalizeRelativeFee(feeText);
    let bondProof: string | undefined;
    for (const flag of parts.slice(1)) {
      if (!flag.startsWith('tbond ')) continue;
      if (bondProof !== undefined) return null;
      const proof = flag.slice(6).trim().split(/\s+/)[0];
      if (!proof || proof.length > 340) return null;
      bondProof = proof;
    }
    return Object.freeze({ counterparty: from, oid, type, minsize, maxsize, txfee, cjfee, ...(bondProof ? { bondProof } : {}) });
  } catch {
    return null;
  }
}
function u32(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('Invalid uint32');
  return n;
}
export function pushNumber(n: number): Buffer {
  if (!Number.isSafeInteger(n) || n < -1 || n > 0xffffffff) throw new Error('Invalid script number');
  return Buffer.from(script.compile([script.number.encode(n)]));
}
export function freezeScript(publicKey: string, locktime: number): string {
  if (typeof publicKey !== 'string' || !/^0[23][0-9a-f]{64}$/.test(publicKey) || !isCompressedPoint(Buffer.from(publicKey, 'hex')))
    throw new Error('Invalid bond public key');
  return Buffer.concat([
    pushNumber(u32(locktime)),
    Buffer.from('b17521', 'hex'),
    Buffer.from(publicKey, 'hex'),
    Buffer.from('ac', 'hex'),
  ]).toString('hex');
}
function stripPadding(hex: string): Buffer | null {
  const bytes = Buffer.from(hex, 'hex');
  let i = 0;
  while (i < bytes.length && bytes[i] === 0xff) i++;
  return bytes[i] === 0x30 ? Buffer.from(bytes.subarray(i)) : null;
}
// A verified proof binds certificate/nick keys. Its outpoint and locktime are
// authenticated separately by matching the resulting P2WSH to proven chain data.
export class BondProof {
  readonly nickSignature: string;
  readonly certificateSignature: string;
  readonly certificateKey: string;
  readonly expiry: number;
  readonly utxoKey: string;
  readonly txid: string;
  readonly vout: number;
  readonly locktime: number;
  private constructor(bytes: Buffer) {
    const hex = (a: number, b: number) => Buffer.from(bytes.subarray(a, b)).toString('hex');
    this.nickSignature = hex(0, 72);
    this.certificateSignature = hex(72, 144);
    this.certificateKey = hex(144, 177);
    this.expiry = bytes.readUInt16LE(177);
    this.utxoKey = hex(179, 212);
    this.txid = hex(212, 244);
    this.vout = bytes.readUInt32LE(244);
    this.locktime = bytes.readUInt32LE(248);
    Object.freeze(this);
  }

  static decode(text: string): BondProof | null {
    if (typeof text !== 'string' || text.length > 340) return null;
    const raw = decodeBase64(text);
    return raw?.length === 252 ? new BondProof(raw) : null;
  }

  get expiryHeight(): number {
    return this.expiry * 2016;
  }

  get redeemScript(): string {
    return freezeScript(this.utxoKey, this.locktime);
  }

  get scriptPubKey(): string {
    return '0020' + Buffer.from(crypto.sha256(Buffer.from(this.redeemScript, 'hex'))).toString('hex');
  }

  expiredAt(height: number): boolean {
    return u32(height) > this.expiryHeight;
  }

  verify(maker: string, taker: string): boolean {
    try {
      if (!isValidNick(maker) || !isValidNick(taker)) return false;
      const nickSig = stripPadding(this.nickSignature),
        certSig = stripPadding(this.certificateSignature);
      if (!nickSig || !certSig) return false;
      const certKey = Buffer.from(this.certificateKey, 'hex'),
        utxoKey = Buffer.from(this.utxoKey, 'hex');
      if (!verifyHash(messageHash(taker + '|' + maker), nickSig, certKey)) return false;
      const head = Buffer.from('fidelity-bond-cert|'),
        tail = Buffer.from('|' + this.expiry);
      return [certKey, Buffer.from(this.certificateKey)].some(key =>
        verifyHash(messageHash(Buffer.concat([head, key, tail])), certSig, utxoKey),
      );
    } catch {
      return false;
    }
  }
}
export function bondValue(value: number, confirmationTime: number, locktime: number, now: number): bigint {
  sats(value);
  [confirmationTime, locktime, now].forEach(u32);
  const year = 60 * 60 * 24 * 365.2425;
  const a = Math.max(
    0,
    Math.min(1, Math.exp(0.015 * ((locktime - confirmationTime) / year)) - 1) -
      Math.min(1, Math.exp(0.015 * Math.max(0, now / year - locktime / year)) - 1),
  );
  const weight = Math.floor(Math.pow(value * a, 1.3));
  const max = 0x7fffffffffffffffn;
  return !Number.isFinite(weight) || weight >= Number(max) ? max : BigInt(weight);
}
export type BondedOffer = Readonly<{ offer: MakerOffer; bond: BondProof }>;
export function parseOrderbook(
  frames: readonly Frame[],
  ourNick: string,
): { offers: readonly BondedOffer[]; heard: number; dropped: number } {
  if (!isValidNick(ourNick) || frames.length > 10000) throw new Error('Invalid orderbook request');
  const found = new Map<string, BondedOffer>();
  let heard = 0,
    total = 0;
  for (const frame of frames) {
    if (typeof frame.line !== 'string' || frame.line.length > 65536 || (total += frame.line.length) > 32 * 1024 * 1024)
      throw new Error('Orderbook message limit');
    if (![PRIVMSG, PUBMSG].includes(frame.type)) continue;
    const first = frame.line.indexOf('!'),
      second = frame.line.indexOf('!', first + 1);
    if (first < 0 || second < 0) continue;
    const from = frame.line.slice(0, first),
      to = frame.line.slice(first + 1, second),
      rest = frame.line.slice(second + 1);
    if (!TYPES.some(t => rest.startsWith(t + ' '))) continue;
    heard++;
    let content = rest,
      proofNick = from;
    if (frame.type === PRIVMSG) {
      if (to !== ourNick) continue;
      const checked = verifyPrivmsg(from, rest);
      if (!checked.ok) continue;
      content = checked.command + ' ' + checked.data;
      proofNick = ourNick;
    } else if (to !== 'PUBLIC') continue;
    const offer = parseOffer(content, from);
    const bond = offer?.bondProof ? BondProof.decode(offer.bondProof) : null;
    if (!offer || !bond || !bond.verify(from, proofNick)) continue;
    const key = from + ':' + offer.oid,
      old = found.get(key);
    if (!old || bond.expiry > old.bond.expiry) found.set(key, Object.freeze({ offer, bond }));
  }
  return { offers: Object.freeze([...found.values()]), heard, dropped: heard - found.size };
}

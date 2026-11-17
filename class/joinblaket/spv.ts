// Adapted from pinned rc6 BlockHeader.kt. This verifies individual headers and
// merkle inclusions; it does not establish the best chain or prove unspentness.
import { crypto } from 'bitcoinjs-lib';
import { blake2b } from '@noble/hashes/blake2b';

export const SPV_FLOOR_BITS = 0x191b0540;
const MAX_TARGET = 2n ** 256n - 1n;
export function uint32(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('Invalid uint32');
  return n;
}
function u32(n: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(uint32(n));
  return out;
}
export function hashHex(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('Invalid hash');
  return value.toLowerCase();
}
export function compactTarget(bits: number): bigint {
  uint32(bits);
  const exponent = Math.floor(bits / 0x1000000);
  if (Math.floor(bits / 0x800000) % 2) throw new Error('Negative proof-of-work target');
  const mantissa = BigInt(bits % 0x800000);
  const target = exponent <= 3 ? mantissa / 256n ** BigInt(3 - exponent) : mantissa * 256n ** BigInt(exponent - 3);
  if (target <= 0n || target > MAX_TARGET) throw new Error('Invalid proof-of-work target');
  return target;
}
function tagged(tag: string, bytes: Uint8Array): Buffer {
  const t = crypto.sha256(Buffer.from(tag));
  return Buffer.from(crypto.sha256(Buffer.concat([t, t, bytes])));
}
export class BlockHeader {
  readonly hex: string;
  readonly extended: boolean;
  readonly bits: number;
  readonly time: number;
  readonly height: number | null;
  readonly previousHash: string;
  readonly merkleRoot: string;
  private constructor(bytes: Buffer) {
    this.hex = bytes.toString('hex');
    this.extended = bytes.readUInt32LE(0) >= 0x80000000;
    if (this.extended !== (bytes.length === 164)) throw new Error('Header size/version mismatch');
    this.bits = bytes.readUInt32LE(72);
    compactTarget(this.bits);
    this.time = bytes.readUInt32LE(68);
    this.height = this.extended ? bytes.readUInt32LE(128) : null;
    this.previousHash = Buffer.from(bytes.subarray(4, 36)).reverse().toString('hex');
    this.merkleRoot = Buffer.from(bytes.subarray(36, 68)).toString('hex'); // internal order
    Object.freeze(this);
  }

  static parse(hex: string): BlockHeader {
    if (typeof hex !== 'string' || !/^(?:[0-9a-fA-F]{160}|[0-9a-fA-F]{328})$/.test(hex)) throw new Error('Invalid block header');
    return new BlockHeader(Buffer.from(hex, 'hex'));
  }

  get hash(): string {
    const raw = Buffer.from(this.hex, 'hex');
    if (!this.extended) return Buffer.from(crypto.hash256(raw)).reverse().toString('hex');
    const part = (start: number, end: number) => Buffer.from(raw.subarray(start, end));
    const previous = Buffer.from(this.previousHash, 'hex');
    const flags = raw[110],
      clearBits = raw[111],
      xorKey = part(112, 128);
    const mask = Buffer.alloc(32);
    if (xorKey.some(x => x !== 0)) {
      const m = tagged('Bitcoin block hash PoW XOR mask', xorKey),
        full = Math.floor(clearBits / 8);
      m.fill(0, 0, full);
      m[full] %= 2 ** (8 - (clearBits % 8));
      m.copy(mask);
    }
    const h1 = Buffer.concat([
      part(0, 4),
      previous,
      part(128, 132),
      part(36, 68),
      part(68, 72),
      Buffer.from([0]),
      part(72, 76),
      u32(raw.readUInt16LE(108)),
      Buffer.from([flags, clearBits]),
      tagged('Bitcoin block hash PoW XOR key', xorKey),
    ]);
    const h2 = tagged('Merge-mining hook', Buffer.concat([tagged('Bitcoin block header 1', h1), Buffer.alloc(32), part(132, 164)]));
    const first = blake2b(Buffer.concat([Buffer.alloc(4), h2, part(88, 104)]), { dkLen: 32 });
    let prefix: Buffer;
    if (flags % 4 === 0) {
      prefix = tagged('Bitcoin prevblock header, hashed', previous);
      prefix.fill(0, 0, 6);
    } else if (flags % 4 === 2) prefix = Buffer.concat([Buffer.alloc(48), h2]);
    else if (flags % 4 === 3) prefix = Buffer.concat([Buffer.alloc(80), h2]);
    else prefix = Buffer.alloc(0);
    const second = Buffer.concat([
      prefix,
      part(76, 84),
      ...(flags % 4 === 1 ? [part(84, 88), part(104, 108)] : [part(104, 108), part(84, 88)]),
      first,
      ...(flags % 4 === 1 ? [h2] : []),
    ]);
    const result = Buffer.from(blake2b(second, { dkLen: 32 }));
    // XOR is specified by the XBT header hash, on bounded single bytes.
    for (let i = 0; i < 32; i++) result[i] = result[i] ^ mask[i]; // eslint-disable-line no-bitwise
    return result.toString('hex');
  }

  meetsTarget(floorBits = SPV_FLOOR_BITS): boolean {
    const target = compactTarget(this.bits);
    return target <= compactTarget(floorBits) && BigInt('0x' + this.hash) <= target;
  }

  includes(txid: string, branch: readonly string[], position: number): boolean {
    try {
      let node = Buffer.from(hashHex(txid), 'hex').reverse(),
        pos = uint32(position);
      if (!Array.isArray(branch) || branch.length > 32) return false;
      for (const sibling of branch) {
        const other = Buffer.from(hashHex(sibling), 'hex').reverse();
        node = Buffer.from(crypto.hash256(Buffer.concat(pos % 2 === 0 ? [node, other] : [other, node])));
        pos = Math.floor(pos / 2);
      }
      return pos === 0 && node.toString('hex') === this.merkleRoot;
    } catch {
      return false;
    }
  }
}

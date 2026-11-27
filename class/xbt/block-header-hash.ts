import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha256';

function taggedHash(tag: string, ...parts: Uint8Array[]): Buffer {
  const prefix = sha256(Buffer.from(tag, 'utf8'));
  return Buffer.from(sha256(Buffer.concat([prefix, prefix, ...parts])));
}

// Knots CBlockHeader::GetHash, b4c8f9f4. Return the displayed block ID.
export function xbtV2BlockHash(header: Buffer): string {
  if (header.length !== 164 || header.readInt32LE(0) >= 0) throw new Error('Invalid XBT v2 header');
  const prev = Buffer.from(header.subarray(4, 36)).reverse();
  const key = header.subarray(112, 128);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(header.readUInt16LE(108));
  const h1 = taggedHash(
    'Bitcoin block header 1',
    header.subarray(0, 4),
    prev,
    header.subarray(128, 132),
    header.subarray(36, 72),
    Buffer.alloc(1),
    header.subarray(72, 76),
    count,
    header.subarray(110, 112),
    taggedHash('Bitcoin block hash PoW XOR key', key),
  );
  const h2 = taggedHash('Merge-mining hook', h1, Buffer.alloc(32), header.subarray(132));
  const first = blake2b(Buffer.concat([Buffer.alloc(4), h2, header.subarray(88, 104)]), { dkLen: 32 });
  const nonce12 = header.subarray(76, 84);
  const nonce3 = header.subarray(84, 88);
  const offset = header.subarray(104, 108);
  const profile = header[110] & 3;
  let payload: Buffer;
  if (profile === 1) {
    payload = Buffer.concat([nonce12, nonce3, offset, first, h2]);
  } else {
    let prefix: Buffer;
    if (profile === 0) {
      prefix = taggedHash('Bitcoin prevblock header, hashed', prev);
      prefix.fill(0, 0, 6);
    } else {
      prefix = Buffer.concat([Buffer.alloc(profile === 2 ? 48 : 80), h2]);
    }
    payload = Buffer.concat([prefix, nonce12, offset, nonce3, first]);
  }
  const result = Buffer.from(blake2b(payload, { dkLen: 32 }));
  if (key.some(byte => byte !== 0)) {
    const mask = taggedHash('Bitcoin block hash PoW XOR mask', key);
    const bits = header[111];
    const bytes = Math.floor(bits / 8);
    mask.fill(0, 0, bytes);
    mask[bytes] &= 0xff >>> bits % 8;
    for (let i = 0; i < result.length; i++) result[i] ^= mask[i];
  }
  return result.toString('hex');
}

// Ordered newest first. The reward header is supplied by the caller's chain
// anchor; its previous-block commitment binds every timestamp used for MTP.
export function rewardParentMedianTime(reward: Buffer, parents: readonly string[]): number {
  if (parents.length !== 11) throw new Error('Missing XBT reward parent history');
  let child = reward;
  const times: number[] = [];
  for (let i = 0; i < parents.length; i++) {
    const height = reward.readInt32LE(128) - i - 1;
    const v2 = height >= 961640;
    const raw = parents[i];
    if (!(v2 ? /^[a-f0-9]{328}$/i : /^[a-f0-9]{160}$/i).test(raw)) throw new Error('Invalid XBT parent header length');
    const parent = Buffer.from(raw, 'hex');
    if (v2 && parent.readInt32LE(128) !== height) throw new Error('Invalid XBT parent height');
    const hash = v2
      ? xbtV2BlockHash(parent)
      : Buffer.from(sha256(sha256(parent)))
          .reverse()
          .toString('hex');
    if (Buffer.from(child.subarray(4, 36)).reverse().toString('hex') !== hash) throw new Error('XBT parent header mismatch');
    const offset = v2 && parent[110] & 4 ? parent.readUInt32LE(104) : 0;
    times.push((parent.readUInt32LE(68) + offset) % 0x100000000);
    child = parent;
  }
  return times.sort((a, b) => a - b)[5];
}

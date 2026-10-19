/** Adapted from Kilombino/kilowallet v1.1.6 (Apache-2.0). See UPSTREAM-NOTICE. */
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { chacha20 } from '@noble/ciphers/chacha';
import ecc from '../../../blue_modules/noble_ecc';

export const hash = (bytes: Uint8Array): Buffer => Buffer.from(sha256(bytes));
export const utf8Hash = (text: string): Buffer => hash(Buffer.from(text, 'utf8'));
export const mac = (key: Uint8Array, bytes: Uint8Array): Buffer => Buffer.from(hmac(sha256, key, bytes));
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export function hex(value: string, length?: number): Buffer {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value) || (length !== undefined && value.length !== length * 2)) {
    throw new Error('Invalid canonical hex');
  }
  return Buffer.from(value, 'hex');
}
export function conversationKey(secret: Uint8Array, pubkey: string): Buffer {
  if (!ecc.isPrivate(secret)) throw new Error('Invalid secret key');
  const point = ecc.pointMultiply(Buffer.concat([Buffer.from([2]), hex(pubkey, 32)]), secret, true);
  if (!point) throw new Error('Invalid conversation key');
  return mac(Buffer.from('nip44-v2'), point.slice(1));
}
function messageKeys(key: Uint8Array, nonce: Uint8Array): Buffer {
  if (key.length !== 32 || nonce.length !== 32) throw new Error('NIP44 key/nonce must be 32 bytes');
  const parts: Buffer[] = [];
  let previous: Buffer = Buffer.alloc(0);
  for (let i = 1; i <= 3; i++) {
    previous = mac(key, Buffer.concat([previous, nonce, Buffer.from([i])]));
    parts.push(previous);
  }
  return Buffer.concat(parts).subarray(0, 76);
}
function paddedLength(length: number): number {
  if (length <= 32) return 32;
  const next = 2 ** Math.ceil(Math.log2(length));
  const chunk = next <= 256 ? 32 : next / 8;
  return chunk * Math.ceil(length / chunk);
}
// Explicit nonce argument: callers must supply a fresh CSPRNG nonce, never a counter or Math.random.
export function encrypt(plaintext: string, key: Uint8Array, nonce: Uint8Array): string {
  const bytes = Buffer.from(plaintext, 'utf8');
  if (bytes.length < 1 || bytes.length > 65535) throw new Error('NIP44 plaintext length');
  const keys = messageKeys(key, nonce);
  const padded = Buffer.alloc(2 + paddedLength(bytes.length));
  padded.writeUInt16BE(bytes.length);
  bytes.copy(padded, 2);
  const encrypted = chacha20(keys.subarray(0, 32), keys.subarray(32, 44), padded);
  return Buffer.concat([Buffer.from([2]), nonce, encrypted, mac(keys.subarray(44), Buffer.concat([nonce, encrypted]))]).toString('base64');
}
export function decrypt(payload: string, key: Uint8Array): string {
  if (typeof payload !== 'string' || payload.length < 132 || payload.length > 87472 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload))
    throw new Error('Invalid NIP44 payload');
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.toString('base64') !== payload || bytes.length < 99 || bytes[0] !== 2) throw new Error('Invalid NIP44 version/encoding');
  const nonce = bytes.subarray(1, 33);
  const ciphertext = bytes.subarray(33, -32);
  const keys = messageKeys(key, nonce);
  if (!equal(bytes.subarray(-32), mac(keys.subarray(44), Buffer.concat([nonce, ciphertext])))) throw new Error('Invalid NIP44 MAC');
  const padded = Buffer.from(chacha20(keys.subarray(0, 32), keys.subarray(32, 44), ciphertext));
  const length = padded.readUInt16BE(0);
  if (!length || padded.length !== 2 + paddedLength(length) || padded.subarray(length + 2).some(b => b !== 0))
    throw new Error('Invalid NIP44 padding');
  const content = padded.subarray(2, length + 2);
  const text = content.toString('utf8');
  if (!equal(Buffer.from(text, 'utf8'), content)) throw new Error('Invalid UTF8');
  return text;
}
export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};
export function eventHash(event: Omit<NostrEvent, 'id' | 'sig'>): Buffer {
  hex(event.pubkey, 32);
  if (
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0 ||
    !Number.isSafeInteger(event.kind) ||
    event.kind < 0 ||
    event.kind > 65535
  )
    throw new Error('Invalid event integers');
  if (
    typeof event.content !== 'string' ||
    Buffer.byteLength(event.content) > 131072 ||
    !Array.isArray(event.tags) ||
    event.tags.length > 100 ||
    event.tags.some(t => !Array.isArray(t) || t.length > 10 || t.some(v => typeof v !== 'string' || v.length > 1024))
  )
    throw new Error('Invalid event body');
  return utf8Hash(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]));
}
export function verifyEvent(event: NostrEvent): boolean {
  try {
    const digest = eventHash(event);
    return equal(digest, hex(event.id, 32)) && ecc.verifySchnorr!(digest, hex(event.pubkey, 32), hex(event.sig, 64));
  } catch {
    return false;
  }
}
export function signEvent(event: Omit<NostrEvent, 'id' | 'sig' | 'pubkey'>, secret: Uint8Array, auxiliaryRandom: Uint8Array): NostrEvent {
  const publicKey = ecc.pointFromScalar(secret, true);
  if (!publicKey || auxiliaryRandom.length !== 32) throw new Error('Invalid event signing parameters');
  const unsigned = {
    ...event,
    pubkey: Buffer.from(publicKey.slice(1)).toString('hex'),
  };
  const digest = eventHash(unsigned);
  return {
    ...unsigned,
    id: digest.toString('hex'),
    sig: Buffer.from(ecc.signSchnorr!(digest, secret, auxiliaryRandom)).toString('hex'),
  };
}

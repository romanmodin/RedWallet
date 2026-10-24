import { Buffer as BrowserBuffer } from 'buffer/';
import { chacha20 } from '@noble/ciphers/chacha';
import { conversationKey, decrypt, encrypt, mac, NostrEvent } from '../../class/xbt/kilojoin/crypto';
import { MessageInbox } from '../../class/xbt/kilojoin/messages';
import { ParticipantSession } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms } from '../../class/xbt/kilojoin/protocol';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { Coin, coinScript, outpoint } from '../../class/xbt/kilojoin/transaction';
import messages from './fixtures/kilojoin-kotlin-messages.json';
import sessions from './fixtures/kilojoin-kotlin-session.json';

// Match the checked-in iOS Hermes engine's TypedArray allocation semantics:
// subarray returns Uint8Array, not the Buffer subclass. This is a focused engine
// model, not an iOS execution receipt. Never patch the production global shim.
const nodeBuffer = global.Buffer;
const descriptor = Object.getOwnPropertyDescriptor(BrowserBuffer.prototype, 'subarray');
beforeAll(() => {
  Object.defineProperty(BrowserBuffer.prototype, 'subarray', {
    configurable: true,
    value(this: Uint8Array, start?: number, end?: number) {
      return new Uint8Array(this.buffer, this.byteOffset, this.byteLength).subarray(start, end);
    },
  });
  global.Buffer = BrowserBuffer as unknown as typeof Buffer;
});
afterAll(() => {
  global.Buffer = nodeBuffer;
  if (descriptor) Object.defineProperty(BrowserBuffer.prototype, 'subarray', descriptor);
  else Reflect.deleteProperty(BrowserBuffer.prototype, 'subarray');
});

const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

test('engine model actually loses Buffer string decoding on a subarray', () => {
  const bytes = Buffer.from('welcome');
  expect(bytes.toString('utf8')).toBe('welcome');
  expect(Buffer.isBuffer(bytes.subarray(0))).toBe(false);
  expect(bytes.subarray(0).toString()).toBe('119,101,108,99,111,109,101');
  expect(Buffer.from(bytes.subarray(0)).toString('utf8')).toBe('welcome');
});

test.each(messages.encryption)('decodes actual Kotlin NIP44 at $length bytes with Hermes Buffer semantics', vector => {
  const key = conversationKey(secret(3), messages.creator);
  expect(decrypt(vector.ciphertext, key)).toBe(vector.plaintext);
  expect(encrypt(vector.plaintext, key, Buffer.from(vector.nonce, 'hex'))).toBe(vector.ciphertext);
});

test('processes actual Kotlin welcome, pool messages and replay rejection with Hermes Buffer semantics', () => {
  const inbox = new MessageInbox(messages.creator, messages.pool, secret(3), 10000);
  try {
    messages.messages.forEach((v, i) => {
      expect(inbox.receive(v.event, 10000).body).toEqual(v.body);
      if (i === 0) inbox.installPoolSecret(secret(2));
    });
    expect(() => inbox.receive(messages.messages[1].event, 10000)).toThrow('Replayed message');
  } finally {
    inbox.close();
  }
});

test.each(sessions)('actual Kotlin startup reaches voting for $terms.script/$mixes.length outputs under Hermes semantics', async v => {
  const terms = v.terms as Terms;
  const seat = parseSeat(v.rawSeat, terms);
  const now = v.startedAt + 2;
  const round = await Round.join('synthetic', terms.id, seat.coins.map(outpoint), now + 7200, now, { save: async () => {} });
  const session = new ParticipantSession(terms, seat, secret(7), v.mixes, 10000, round, {
    now: () => now,
    random: length => new Uint8Array(length).fill(37),
    saveEncrypted: async () => {},
    walletOutpoints: () => new Set(seat.coins.map(outpoint)),
    observe: async (coins: Coin[]) =>
      new Map(coins.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: now }])),
    publish: async () => {
      throw new Error('Offline startup must not publish');
    },
  });
  await session.receive(v.events[0] as NostrEvent);
  expect(session.snapshot().phase).toBe('open');
  for (const event of v.events.slice(1).reverse()) await session.receive(event as NostrEvent);
  expect(session.snapshot().phase).toBe('voting');
  expect(session.snapshot().seats).toHaveLength(terms.max_peers);
  expect(Object.keys(session.snapshot().signatures)).toHaveLength(0);
});

// Authenticated malformed plaintext: exercise UTF-8 and padding checks after a
// valid MAC, rather than merely detecting ciphertext corruption before decoding.
function authenticatedPayload(content: number[], dirtyPadding = false): { payload: string; key: Buffer } {
  const key = Buffer.alloc(32, 11);
  const nonce = Buffer.alloc(32, 12);
  const parts: Buffer[] = [];
  let previous: Buffer = Buffer.alloc(0);
  for (let i = 1; i <= 3; i++) {
    previous = mac(key, Buffer.concat([previous, nonce, Buffer.from([i])]));
    parts.push(previous);
  }
  const keys = Buffer.concat(parts);
  const padded = Buffer.alloc(34);
  padded.writeUInt16BE(content.length);
  padded.set(content, 2);
  if (dirtyPadding) padded[33] = 1;
  const ciphertext = chacha20(keys.subarray(0, 32), keys.subarray(32, 44), padded);
  const tag = mac(keys.subarray(44, 76), Buffer.concat([nonce, ciphertext]));
  return { key, payload: Buffer.concat([Buffer.from([2]), nonce, ciphertext, tag]).toString('base64') };
}

test.each([[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82]])('rejects authenticated invalid UTF-8 %j', (...bytes) => {
  const v = authenticatedPayload(bytes);
  expect(() => decrypt(v.payload, v.key)).toThrow('Invalid UTF8');
});

test('retains MAC, padding and payload checks under Hermes Buffer semantics', () => {
  const v = authenticatedPayload([65]);
  const corrupted = Buffer.from(v.payload, 'base64');
  corrupted[40] = (corrupted[40] + 1) % 256;
  expect(() => decrypt(corrupted.toString('base64'), v.key)).toThrow('Invalid NIP44 MAC');
  const dirty = authenticatedPayload([65], true);
  expect(() => decrypt(dirty.payload, dirty.key)).toThrow('Invalid NIP44 padding');
  expect(() => decrypt('A'.repeat(90000), v.key)).toThrow('Invalid NIP44 payload');
});

test('round-trips multibyte text without altering authenticated bytes', () => {
  const text = 'Welcome — café 🚀';
  const key = Buffer.alloc(32, 13);
  expect(decrypt(encrypt(text, key, Buffer.alloc(32, 14)), key)).toBe(text);
});

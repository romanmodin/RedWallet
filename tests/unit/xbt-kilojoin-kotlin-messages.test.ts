import vectors from './fixtures/kilojoin-kotlin-messages.json';
import { conversationKey, decrypt, encrypt, verifyEvent } from '../../class/xbt/kilojoin/crypto';
import { MessageInbox } from '../../class/xbt/kilojoin/messages';
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

test.each(vectors.encryption)('matches actual Kotlin NIP44 at $length bytes in both directions', vector => {
  const sender = conversationKey(secret(1), vectors.join);
  const recipient = conversationKey(secret(3), vectors.creator);
  expect(sender.toString('hex')).toBe(vector.key);
  expect(recipient).toEqual(sender);
  expect(decrypt(vector.ciphertext, recipient)).toBe(vector.plaintext);
  // Exact equality also means Kotlin's independently verified decrypt accepts our bytes.
  expect(encrypt(vector.plaintext, sender, Buffer.from(vector.nonce, 'hex'))).toBe(vector.ciphertext);
});

test('accepts actual Kotlin signed direct welcome and subsequent creator pool envelopes', () => {
  const receiver = new MessageInbox(vectors.creator, vectors.pool, secret(3), 10000);
  vectors.messages.forEach((vector, index) => {
    expect(verifyEvent(vector.event)).toBe(true);
    const message = receiver.receive(vector.event, 10000);
    expect(message.body).toEqual(vector.body);
    expect(message.authority).toBe('creator');
    expect(message.channel).toBe(index === 0 ? 'direct' : 'pool');
    if (index === 0) receiver.installPoolSecret(secret(2));
  });
  receiver.close();
});

test('rejects tampering and replay of actual Kotlin messages', () => {
  const receiver = new MessageInbox(vectors.creator, vectors.pool, secret(3), 10000);
  const { event } = vectors.messages[0];
  expect(() => receiver.receive({ ...event, content: event.content + 'A' }, 10000)).toThrow();
  receiver.receive(event, 10000);
  expect(() => receiver.receive(event, 10000)).toThrow('Replayed message');
  receiver.close();
});

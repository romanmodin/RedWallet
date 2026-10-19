import ecc from '../../blue_modules/noble_ecc';
import { MessageInbox } from '../../class/xbt/kilojoin/messages';
import { conversationKey, encrypt, signEvent } from '../../class/xbt/kilojoin/crypto';
import { memberMac } from '../../class/xbt/kilojoin/protocol';
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const pub = (s: Buffer) => Buffer.from(ecc.pointFromScalar(s, true)!.slice(1)).toString('hex');
const creator = secret(1),
  pool = secret(2),
  join = secret(3),
  stranger = secret(4);
const start = 10000;
const inbox = () => new MessageInbox(pub(creator), pub(pool), join, start);
const event = (sender: Buffer, recipient: string, body: unknown, at = start, tags = [['p', recipient]]) =>
  signEvent(
    {
      kind: 2023,
      created_at: at,
      tags,
      content: encrypt(JSON.stringify(body), conversationKey(sender, recipient), Buffer.alloc(32, 7)),
    },
    sender,
    Buffer.alloc(32, 8),
  );

describe('Kilojoin participant message boundary', () => {
  test('accepts creator welcome only on fresh join identity, then creator roster on pool channel', () => {
    const receiver = inbox();
    expect(receiver.receive(event(creator, pub(join), { type: 'welcome' }), start)).toMatchObject({
      authority: 'creator',
      channel: 'direct',
    });
    receiver.installPoolSecret(pool);
    expect(receiver.receive(event(creator, pub(pool), { type: 'roster', seq: 1 }), start)).toMatchObject({
      authority: 'creator',
      channel: 'pool',
    });
    expect(() => receiver.receive(event(creator, pub(join), { type: 'welcome' }, start + 1), start + 1)).toThrow('route');
  });
  test.each(['roster', 'closing', 'outputs', 'abort', 'blind_sig', 'vote_open', 'reopen'])('shared pool key cannot issue %s', type => {
    const receiver = inbox();
    receiver.installPoolSecret(pool);
    expect(() => receiver.receive(event(pool, pub(pool), { type }), start)).toThrow('Unauthorized message type');
  });
  test('shared-key signatures are classified as membership, never individual authorship', () => {
    const receiver = inbox();
    receiver.installPoolSecret(pool);
    expect(receiver.receive(event(pool, pub(pool), { type: 'sig' }), start).authority).toBe('member');
  });
  test('rejects stranger, ambiguous recipient, tampering, and wrong pool secret', () => {
    const receiver = inbox();
    expect(() => receiver.installPoolSecret(stranger)).toThrow('secret');
    expect(() => receiver.receive(event(stranger, pub(join), { type: 'welcome' }), start)).toThrow('route');
    expect(() =>
      receiver.receive(
        event(creator, pub(join), { type: 'welcome' }, start, [
          ['p', pub(join)],
          ['p', pub(pool)],
        ]),
        start,
      ),
    ).toThrow('recipient');
    const signed = event(creator, pub(join), { type: 'welcome' });
    expect(() => receiver.receive({ ...signed, content: signed.content + 'A' }, start)).toThrow('Invalid');
  });
  test('rejects replay, stale and future events without poisoning a later valid event', () => {
    const receiver = inbox();
    const signed = event(creator, pub(join), { type: 'welcome' });
    expect(() => receiver.receive(signed, start + 2101)).toThrow('stale');
    expect(() => receiver.receive(event(creator, pub(join), { type: 'welcome' }, start + 61), start)).toThrow('stale');
    receiver.receive(signed, start);
    expect(() => receiver.receive(signed, start)).toThrow('Replayed');
  });
  test('rejects malformed and wrong-channel bodies, closes permanently without mutating caller keys', () => {
    const receiver = inbox();
    for (const body of [null, [], 'welcome', { type: 'roster' }])
      expect(() => receiver.receive(event(creator, pub(join), body), start)).toThrow();
    receiver.installPoolSecret(pool);
    receiver.close();
    expect(() => receiver.receive(event(creator, pub(pool), { type: 'roster' }), start)).toThrow('closed');
    expect(() => receiver.installPoolSecret(pool)).toThrow();
    expect(join).toEqual(secret(3));
    expect(pool).toEqual(secret(2));
  });
  test('vote MAC encodes booleans as upstream lowercase true/false', () => {
    expect(memberMac('token', 'vote', 'id', true)).toBe(memberMac('token', 'vote', 'id', 'true'));
    expect(memberMac('token', 'vote', 'id', false)).not.toBe(memberMac('token', 'vote', 'id', true));
  });
});

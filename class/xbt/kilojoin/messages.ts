/** Participant-side authenticated envelope boundary. Kilombino v3, Apache-2.0.
 * No sockets, wallet keys or transaction signing. State handlers must validate bodies.
 */
import ecc from '../../../blue_modules/noble_ecc';
import { conversationKey, decrypt, hex, NostrEvent, verifyEvent } from './crypto';

export type Message = Readonly<{
  eventId: string;
  createdAt: number;
  authority: 'creator' | 'member';
  channel: 'direct' | 'pool';
  body: Readonly<Record<string, unknown>>;
}>;
const creatorTypes = new Set(['roster', 'vote_open', 'reopen', 'closing', 'blind_sig', 'outputs', 'abort']);
const memberTypes = new Set(['close_request', 'vote', 'blind', 'sig', 'tx', 'leave']);
const pub = (secret: Uint8Array): string => {
  if (!ecc.isPrivate(secret)) throw new Error('Invalid session secret');
  return Buffer.from(ecc.pointFromScalar(secret, true)!.slice(1)).toString('hex');
};

export class MessageInbox {
  private readonly seen = new Set<string>();
  private readonly joinSecret: Buffer;
  private readonly joinPub: string;
  private poolSecret?: Buffer;
  private closed = false;

  constructor(
    private readonly creator: string,
    private readonly pool: string,
    joinSecret: Uint8Array,
    private readonly startedAt: number,
  ) {
    hex(creator, 32);
    hex(pool, 32);
    this.joinSecret = Buffer.from(joinSecret);
    this.joinPub = pub(this.joinSecret);
    if (new Set([creator, pool, this.joinPub]).size !== 3 || !Number.isSafeInteger(startedAt) || startedAt < 0)
      throw new Error('Invalid session identity/time');
  }

  // Invoke only AFTER validating and durably persisting the creator's welcome.
  installPoolSecret(secret: Uint8Array): void {
    if (this.closed || this.poolSecret || pub(secret) !== this.pool) throw new Error('Invalid pool secret transition');
    this.poolSecret = Buffer.from(secret);
  }

  receive(event: NostrEvent, now: number): Message {
    if (this.closed) throw new Error('Session closed');
    if (
      !Number.isSafeInteger(now) ||
      now < this.startedAt ||
      !verifyEvent(event) ||
      event.kind !== 2023 ||
      event.created_at < this.startedAt - 60 ||
      event.created_at < now - 2100 ||
      event.created_at > now + 60
    )
      throw new Error('Invalid or stale message');
    if (this.seen.has(event.id)) throw new Error('Replayed message');
    // Fail closed rather than evict replay records and permit old messages again.
    if (this.seen.size >= 4096) throw new Error('Session message limit');
    const recipients = event.tags.filter(tag => tag[0] === 'p');
    if (recipients.length !== 1 || recipients[0].length !== 2) throw new Error('Ambiguous message recipient');
    const recipient = recipients[0][1];
    const isCreator = event.pubkey === this.creator;
    let key: Buffer;
    let channel: 'direct' | 'pool';
    if (recipient === this.joinPub && isCreator && !this.poolSecret) {
      channel = 'direct';
      key = conversationKey(this.joinSecret, this.creator);
    } else if (recipient === this.pool && this.poolSecret && (isCreator || event.pubkey === this.pool)) {
      channel = 'pool';
      key = conversationKey(this.poolSecret, event.pubkey);
    } else throw new Error('Unauthorized message route');
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(decrypt(event.content, key));
    } finally {
      key.fill(0);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.type !== 'string') throw new Error('Invalid message body');
    if (channel === 'direct') {
      if (!['welcome', 'reject'].includes(body.type)) throw new Error('Invalid direct message type');
    } else if (!(isCreator ? creatorTypes : memberTypes).has(body.type)) {
      throw new Error('Unauthorized message type');
    }
    // Shared pool keys prove membership, NOT the identity of a particular member.
    // Member MAC / input-signature validation remains mandatory in state handlers.
    this.seen.add(event.id);
    return Object.freeze({
      eventId: event.id,
      createdAt: event.created_at,
      authority: isCreator ? 'creator' : 'member',
      channel,
      body: Object.freeze(body),
    });
  }

  close(): void {
    this.closed = true;
    this.joinSecret.fill(0);
    this.poolSecret?.fill(0);
    this.seen.clear();
  }
}

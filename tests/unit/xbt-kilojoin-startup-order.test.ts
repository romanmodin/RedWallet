import { randomBytes } from 'crypto';
import ecc from '../../blue_modules/noble_ecc';
import vectors from './fixtures/kilojoin-kotlin-session.json';
import { ParticipantSession, SessionEnvironment } from '../../class/xbt/kilojoin/session';
import { KilojoinRelay } from '../../class/xbt/kilojoin/relay';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms, changeMessage } from '../../class/xbt/kilojoin/protocol';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { coinScript, outpoint } from '../../class/xbt/kilojoin/transaction';
import { conversationKey, decrypt, encrypt, NostrEvent, signEvent } from '../../class/xbt/kilojoin/crypto';

// Only disposable reference-code fixtures. Real relay/session code, no sockets,
// real coins, spending signatures, or broadcaster. The startup callback mirrors
// MixingClient's welcome -> pool subscription transition.
type StartupFixture = {
  terms: (typeof vectors)[number]['terms'];
  rawSeat: (typeof vectors)[number]['rawSeat'];
  startedAt: number;
  mixes: string[];
  events: NostrEvent[];
};
async function fixture(v: StartupFixture) {
  const now = v.startedAt + 2;
  const terms = v.terms as Terms;
  const own = parseSeat(v.rawSeat, terms);
  const socket = {
    onopen: undefined as undefined | (() => void),
    onmessage: undefined as undefined | ((event: { data: string }) => void),
    onerror: undefined as undefined | (() => void),
    onclose: undefined as undefined | (() => void),
    send: jest.fn(),
    close: jest.fn(),
  };
  const errors: { message: string; phase: string; seats: number }[] = [];
  const updates: { phase: string; seats: number }[] = [];
  const observe = jest.fn(
    async (coins: Parameters<SessionEnvironment['observe']>[0]) =>
      new Map(
        coins.map(c => [
          outpoint(c),
          {
            value: c.value,
            script: coinScript(c).toString('hex'),
            unspent: true,
            checkedAt: now,
          },
        ]),
      ),
  );
  const saveEncrypted = jest.fn(async () => {});
  const round = await Round.join('synthetic-startup', terms.id, own.coins.map(outpoint), now + 7200, now, { save: async () => {} });
  const session = new ParticipantSession(terms, own, Buffer.from('07'.padStart(64, '0'), 'hex'), v.mixes, 10000, round, {
    now: () => now,
    random: randomBytes,
    saveEncrypted,
    observe,
    walletOutpoints: () => new Set(own.coins.map(outpoint)),
    publish: e => relay.publish(e),
  });
  const view = () => ({
    phase: session.snapshot().phase,
    seats: session.snapshot().seats.length,
  });
  const relay = new KilojoinRelay(
    async e => {
      const before = session.snapshot().phase;
      await session.receive(e);
      if (before === 'joining' && session.snapshot().phase === 'open')
        relay.subscribe([terms.creator, terms.public_key], [terms.public_key], v.startedAt - 60);
      updates.push(view());
    },
    e => errors.push({ message: e.message, ...view() }),
    () => socket as unknown as WebSocket,
  );
  const connection = relay.connect();
  socket.onopen!();
  await connection;
  relay.subscribe([terms.creator], [own.join_pub], v.startedAt - 60);
  const deliver = (event: NostrEvent, sub = 'kilojoin-participant-2') => socket.onmessage!({ data: JSON.stringify(['EVENT', sub, event]) });
  const drain = async () => {
    // Bounded event-loop turns, no delay/retry of wallet actions.
    for (let i = 0; i < 12; i++) await new Promise<void>(resolve => setImmediate(resolve));
  };
  return {
    session,
    round,
    socket,
    relay,
    errors,
    updates,
    observe,
    saveEncrypted,
    deliver,
    drain,
    welcome: async () => {
      deliver(v.events[0] as NostrEvent, 'kilojoin-participant-1');
      await drain();
    },
    sendJoin: () =>
      session.sendJoin(
        Buffer.from(
          ecc.signDER(changeMessage(terms.id, own.coins, own.change_script, own.change_value), Buffer.from('01'.padStart(64, '0'), 'hex')),
        ).toString('hex'),
      ),
  };
}

test.each(vectors)('upstream replay burst is harmless for $terms.script / $terms.max_peers / $mixes.length', async v => {
  const creator = Buffer.from('08'.padStart(64, '0'), 'hex');
  const pool = Buffer.from('02'.padStart(64, '0'), 'hex');
  // Re-sign the public Kotlin payloads with a disposable known creator key,
  // leaving every seat proof and pool identity unchanged.
  const creatorPub = Buffer.from(ecc.pointFromScalar(creator, true)!.slice(1)).toString('hex');
  const events = v.events.map(event => {
    const recipient = event.tags.find(tag => tag[0] === 'p')![1];
    const receiver = recipient === v.terms.public_key ? pool : Buffer.from('07'.padStart(64, '0'), 'hex');
    const body = decrypt(event.content, conversationKey(receiver, v.terms.creator));
    return signEvent(
      {
        kind: 2023,
        created_at: event.created_at,
        tags: event.tags,
        content: encrypt(body, conversationKey(creator, recipient), randomBytes(32)),
      },
      creator,
      randomBytes(32),
    );
  });
  const f = await fixture({ ...v, terms: { ...v.terms, creator: creatorPub }, events });
  const key = conversationKey(pool, v.terms.creator);
  const roster = JSON.parse(decrypt(v.events[1].content, key));
  const envelope = (body: unknown, sender = creator, plaintext?: string, at = v.startedAt + 2) =>
    signEvent(
      {
        kind: 2023,
        created_at: at,
        tags: [['p', v.terms.public_key]],
        content: encrypt(plaintext ?? JSON.stringify(body), conversationKey(sender, v.terms.public_key), randomBytes(32)),
      },
      sender,
      randomBytes(32),
    );
  try {
    await f.welcome();
    for (const type of ['vote_open', 'reopen', 'closing', 'blind_sig', 'outputs', 'abort']) {
      f.deliver(envelope({ type }, creator, undefined, v.startedAt - 1));
    }
    f.deliver(envelope({ type: 'roster', seq: 0, seats: [] }, creator, undefined, v.startedAt - 7200));
    for (const type of ['join', 'close_request', 'vote', 'leave', 'blind', 'sig', 'tx', 'abort']) {
      f.deliver(envelope({ type }, pool));
    }
    f.deliver(envelope(null, creator, '{not json'));
    f.deliver(envelope({ type: 'roster' }, Buffer.from('06'.padStart(64, '0'), 'hex')));
    f.deliver(events[2] as NostrEvent);
    f.deliver(events[2] as NostrEvent);
    f.deliver(events[1] as NostrEvent);
    f.deliver(events[1] as NostrEvent);
    f.deliver(envelope(roster)); // Same seq, different signed event ID.
    f.deliver(envelope({ type: 'blind_sig', round_id: '11'.repeat(8), token_hash: '22'.repeat(32) }));
    f.deliver(envelope({ type: 'outputs', round_id: '11'.repeat(8), scripts: [] }));
    await f.drain();
    expect(f.errors).toEqual([]);
    expect(f.session.snapshot().phase).toBe('voting');
    expect(f.session.snapshot().seats).toHaveLength(v.terms.max_peers);
    expect(f.observe).toHaveBeenCalledTimes(1);
    expect(f.round.snapshot()).toMatchObject({ phase: 'joined', reserved: v.rawSeat.coins.map(c => `${c.txid}:${c.vout}`) });
    expect(f.socket.send.mock.calls.map(([text]) => JSON.parse(text)).filter(frame => frame[0] === 'EVENT')).toEqual([]);
  } finally {
    key.fill(0);
    f.relay.close();
  }
});

test.each(vectors)('startup burst with real Kotlin $terms.script / $terms.max_peers seats / $mixes.length outputs succeeds', async v => {
  const f = await fixture(v);
  try {
    await f.welcome();
    for (const e of v.events.slice(1)) f.deliver(e as NostrEvent);
    await f.drain();
    expect(f.errors).toEqual([]);
    expect(f.session.snapshot().phase).toBe('voting');
    expect(f.session.snapshot().seats).toHaveLength(v.terms.max_peers);
    expect(f.round.snapshot().phase).toBe('joined');
    expect(f.round.snapshot().reserved).toHaveLength(v.rawSeat.coins.length);
  } finally {
    f.relay.close();
  }
});

test.each(vectors)(
  'defers vote-before-roster until the initial roster is verified for actual $terms.script / $terms.max_peers seats / $mixes.length outputs',
  async v => {
    const f = await fixture(v);
    try {
      await f.welcome();
      f.deliver(v.events[2] as NostrEvent);
      f.deliver(v.events[1] as NostrEvent);
      await f.drain();
      expect(f.errors).toEqual([]);
      expect(f.session.snapshot().phase).toBe('voting');
      expect(f.session.snapshot().seats).toHaveLength(v.terms.max_peers);
      // Applying the deferred vote never approves or signs the transaction.
      expect(f.round.snapshot().phase).toBe('joined');
      expect(f.round.snapshot().reserved).toHaveLength(v.rawSeat.coins.length);
    } finally {
      f.relay.close();
    }
  },
);

test.each(vectors)('records NIP-01 timestamp/id history order outcome for $terms.script / $terms.max_peers / $mixes.length', async v => {
  const f = await fixture(v);
  try {
    await f.welcome();
    const history = [...v.events.slice(1)].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    history.forEach(e => f.deliver(e as NostrEvent));
    await f.drain();
    expect(f.errors).toEqual([]);
    expect(f.session.snapshot().phase).toBe('voting');
    expect(f.session.snapshot().seats).toHaveLength(v.terms.max_peers);
  } finally {
    f.relay.close();
  }
});

test('duplicate roster is ignored after participants appear, without resetting the accepted session', async () => {
  const v = vectors.find(item => item.terms.max_peers === 5 && item.mixes.length === 5)!;
  const f = await fixture(v);
  try {
    await f.welcome();
    f.deliver(v.events[1] as NostrEvent);
    f.deliver(v.events[1] as NostrEvent);
    await f.drain();
    expect(f.updates).toContainEqual({ phase: 'open', seats: 5 });
    expect(f.errors).toEqual([]);
    expect(f.session.snapshot().phase).toBe('open');
    expect(f.session.snapshot().seats).toHaveLength(5);
    expect(f.observe).toHaveBeenCalledTimes(1);
  } finally {
    f.relay.close();
  }
});

test('welcome persistence failure has the reported joining/zero-participants fingerprint', async () => {
  const f = await fixture(vectors[0]);
  try {
    f.saveEncrypted.mockRejectedValueOnce(new Error('synthetic storage failure'));
    await f.welcome();
    expect(f.errors).toEqual([
      {
        message: 'Participant message rejected [KJ-STORAGE]',
        phase: 'joining',
        seats: 0,
      },
    ]);
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.round.snapshot().phase).toBe('joined');
  } finally {
    f.relay.close();
  }
});

test('peer backend failure has open/zero-participants state and cannot reset a welcomed session to joining', async () => {
  const v = vectors[0];
  const f = await fixture(v);
  try {
    await f.welcome();
    f.observe.mockRejectedValueOnce(new Error('Missing, stale or mismatched chain observation'));
    f.deliver(v.events[1] as NostrEvent);
    await f.drain();
    expect(f.errors).toEqual([
      {
        message: 'Participant message rejected [KJ-CHAIN]',
        phase: 'open',
        seats: 0,
      },
    ]);
    expect(f.session.snapshot().phase).toBe('open');
    expect(f.round.snapshot().reserved).toHaveLength(v.rawSeat.coins.length);
  } finally {
    f.relay.close();
  }
});

test('immediate welcome waits safely for delayed join acknowledgment before switching subscriptions', async () => {
  const v = vectors[0];
  const f = await fixture(v);
  try {
    const joining = f.sendJoin();
    await f.drain();
    const published = f.socket.send.mock.calls.map(([text]) => JSON.parse(text)).find(frame => frame[0] === 'EVENT');
    expect(published).toBeDefined();
    f.deliver(v.events[0] as NostrEvent, 'kilojoin-participant-1');
    await f.drain();
    expect(f.session.snapshot().phase).toBe('joining');
    expect(f.errors).toEqual([]);
    f.socket.onmessage!({
      data: JSON.stringify(['OK', published[1].id, true, '']),
    });
    await joining;
    await f.drain();
    for (const e of v.events.slice(1)) f.deliver(e as NostrEvent);
    await f.drain();
    expect(f.errors).toEqual([]);
    expect(f.session.snapshot().phase).toBe('voting');
  } finally {
    f.relay.close();
  }
});
